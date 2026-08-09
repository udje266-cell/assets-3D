import type { DB, Queryable } from '../db/index.js';
import type { AccountType } from '../db/types.js';
import { generateOtp, generateToken, hashSecret, hashToken, verifySecret } from '../lib/crypto.js';
import { maskPhone } from '../lib/identifiers.js';
import { tooManyRequests, unauthorized } from '../lib/errors.js';

/**
 * Authentification par téléphone et code à usage unique — §3, §5 et §12.
 *
 * Garde-fous appliqués :
 *  - le code n'est jamais stocké en clair ;
 *  - il expire (OTP_TTL_SECONDS) et n'est utilisable qu'une fois ;
 *  - le nombre de tentatives est plafonné, et une demande trop fréquente est
 *    refusée (§12 : « limitation des tentatives de connexion ») ;
 *  - la réponse ne révèle jamais si un compte existe pour ce numéro.
 */

export interface OtpConfig {
  length: number;
  ttlSeconds: number;
  maxAttempts: number;
  /** Délai minimum entre deux demandes pour un même numéro. */
  resendCooldownSeconds: number;
  /** Nombre maximum de demandes par numéro sur une heure glissante. */
  maxRequestsPerHour: number;
}

export const DEFAULT_OTP_CONFIG: Omit<OtpConfig, 'length' | 'ttlSeconds' | 'maxAttempts'> = {
  resendCooldownSeconds: 30,
  maxRequestsPerHour: 5,
};

export interface RequestOtpResult {
  expiresAt: Date;
  /** Renseigné uniquement si OTP_DEBUG_RETURN est actif (jamais en production). */
  debugCode?: string;
}

export async function requestOtp(
  db: DB,
  params: {
    phone: string;
    accountType: AccountType;
    config: OtpConfig;
    requestIp?: string | null;
    now?: Date;
  },
): Promise<RequestOtpResult> {
  const now = params.now ?? new Date();

  const recent = await db
    .selectFrom('otp_codes')
    .select(['created_at'])
    .where('phone', '=', params.phone)
    .where('account_type', '=', params.accountType)
    .where('created_at', '>', new Date(now.getTime() - 3_600_000))
    .orderBy('created_at', 'desc')
    .execute();

  if (recent.length >= params.config.maxRequestsPerHour) {
    throw tooManyRequests('Trop de demandes de code pour ce numéro. Réessayez dans une heure.');
  }

  const last = recent[0];
  if (
    last &&
    now.getTime() - new Date(last.created_at).getTime() <
      params.config.resendCooldownSeconds * 1000
  ) {
    throw tooManyRequests(
      `Un code vient d’être envoyé. Patientez ${params.config.resendCooldownSeconds} secondes.`,
    );
  }

  const code = generateOtp(params.config.length);
  const expiresAt = new Date(now.getTime() + params.config.ttlSeconds * 1000);

  // Les codes précédents encore valides sont invalidés : un seul code actif.
  await db
    .updateTable('otp_codes')
    .set({ consumed_at: now })
    .where('phone', '=', params.phone)
    .where('account_type', '=', params.accountType)
    .where('consumed_at', 'is', null)
    .execute();

  await db
    .insertInto('otp_codes')
    .values({
      phone: params.phone,
      account_type: params.accountType,
      code_hash: await hashSecret(code),
      expires_at: expiresAt,
      request_ip: params.requestIp ?? null,
    })
    .execute();

  return { expiresAt, debugCode: code };
}

export type OtpVerification =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'expired' | 'too_many_attempts' | 'mismatch' };

export async function verifyOtp(
  db: DB,
  params: {
    phone: string;
    accountType: AccountType;
    code: string;
    maxAttempts: number;
    now?: Date;
  },
): Promise<OtpVerification> {
  const now = params.now ?? new Date();

  const record = await db
    .selectFrom('otp_codes')
    .selectAll()
    .where('phone', '=', params.phone)
    .where('account_type', '=', params.accountType)
    .where('consumed_at', 'is', null)
    .orderBy('created_at', 'desc')
    .executeTakeFirst();

  if (!record) return { ok: false, reason: 'not_found' };

  if (new Date(record.expires_at) <= now) {
    await db.updateTable('otp_codes').set({ consumed_at: now }).where('id', '=', record.id).execute();
    return { ok: false, reason: 'expired' };
  }

  if (record.attempts >= params.maxAttempts) {
    await db.updateTable('otp_codes').set({ consumed_at: now }).where('id', '=', record.id).execute();
    return { ok: false, reason: 'too_many_attempts' };
  }

  const matches = await verifySecret(params.code, record.code_hash);

  if (!matches) {
    await db
      .updateTable('otp_codes')
      .set({ attempts: record.attempts + 1 })
      .where('id', '=', record.id)
      .execute();
    return { ok: false, reason: 'mismatch' };
  }

  await db.updateTable('otp_codes').set({ consumed_at: now }).where('id', '=', record.id).execute();
  return { ok: true };
}

/** Message d'erreur unique côté client : ne pas indiquer laquelle des causes s'applique. */
export function otpFailureError(): ReturnType<typeof unauthorized> {
  return unauthorized('Code invalide ou expiré.');
}

export interface IssuedSession {
  refreshToken: string;
  refreshTokenId: string;
  expiresAt: Date;
}

/** Crée un jeton de rafraîchissement persistant (révocable). */
export async function issueRefreshToken(
  db: Queryable,
  params: {
    subjectId: string;
    accountType: AccountType;
    ttlSeconds: number;
    userAgent?: string | null;
    ip?: string | null;
    now?: Date;
  },
): Promise<IssuedSession> {
  const now = params.now ?? new Date();
  const token = generateToken();
  const expiresAt = new Date(now.getTime() + params.ttlSeconds * 1000);

  const inserted = await db
    .insertInto('refresh_tokens')
    .values({
      subject_id: params.subjectId,
      account_type: params.accountType,
      token_hash: hashToken(token),
      user_agent: params.userAgent ?? null,
      ip: params.ip ?? null,
      expires_at: expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { refreshToken: token, refreshTokenId: inserted.id, expiresAt };
}

/**
 * Rotation : un jeton de rafraîchissement ne sert qu'une fois. La réutilisation
 * d'un jeton déjà consommé est le signe d'un vol de session — toute la chaîne
 * de sessions du compte est alors révoquée.
 */
export async function rotateRefreshToken(
  db: DB,
  params: {
    token: string;
    ttlSeconds: number;
    userAgent?: string | null;
    ip?: string | null;
    now?: Date;
  },
): Promise<{ subjectId: string; accountType: AccountType; session: IssuedSession }> {
  const now = params.now ?? new Date();
  const tokenHash = hashToken(params.token);

  return db.transaction().execute(async (trx) => {
    const record = await trx
      .selectFrom('refresh_tokens')
      .selectAll()
      .where('token_hash', '=', tokenHash)
      .forUpdate()
      .executeTakeFirst();

    if (!record) throw unauthorized('Session invalide.');

    if (record.revoked_at !== null) {
      await trx
        .updateTable('refresh_tokens')
        .set({ revoked_at: now })
        .where('subject_id', '=', record.subject_id)
        .where('account_type', '=', record.account_type)
        .where('revoked_at', 'is', null)
        .execute();
      throw unauthorized('Session révoquée : reconnectez-vous.');
    }

    if (new Date(record.expires_at) <= now) {
      throw unauthorized('Session expirée : reconnectez-vous.');
    }

    const session = await issueRefreshToken(trx, {
      subjectId: record.subject_id,
      accountType: record.account_type,
      ttlSeconds: params.ttlSeconds,
      userAgent: params.userAgent ?? null,
      ip: params.ip ?? null,
      now,
    });

    await trx
      .updateTable('refresh_tokens')
      .set({ revoked_at: now, replaced_by: session.refreshTokenId })
      .where('id', '=', record.id)
      .execute();

    return { subjectId: record.subject_id, accountType: record.account_type, session };
  });
}

export async function revokeAllSessions(
  db: DB,
  subjectId: string,
  accountType: AccountType,
): Promise<void> {
  await db
    .updateTable('refresh_tokens')
    .set({ revoked_at: new Date() })
    .where('subject_id', '=', subjectId)
    .where('account_type', '=', accountType)
    .where('revoked_at', 'is', null)
    .execute();
}

/** Libellé de journalisation sans donnée personnelle en clair. */
export function describeOtpTarget(phone: string, accountType: AccountType): string {
  return `${accountType}:${maskPhone(phone)}`;
}
