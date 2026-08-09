import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import type { AccountType } from '../db/types.js';
import {
  describeOtpTarget,
  issueRefreshToken,
  otpFailureError,
  requestOtp,
  revokeAllSessions,
  rotateRefreshToken,
  verifyOtp,
  DEFAULT_OTP_CONFIG,
} from '../services/auth.js';
import { verifySecret } from '../lib/crypto.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { normalizePhone } from '../lib/identifiers.js';
import { routeRateLimit } from '../lib/rate-limit.js';
import { recordAudit } from '../services/audit.js';

/**
 * Authentification — §3 (client), §5 (chauffeur), §14 (administration).
 *
 * Les réponses ne révèlent jamais l'existence d'un compte pour un numéro donné,
 * et un échec de code renvoie toujours le même message quelle que soit la cause
 * (code faux, expiré, trop de tentatives).
 */
export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const otpConfig = {
    length: ctx.env.OTP_LENGTH,
    ttlSeconds: ctx.env.OTP_TTL_SECONDS,
    maxAttempts: ctx.env.OTP_MAX_ATTEMPTS,
    ...DEFAULT_OTP_CONFIG,
  };

  const requestSchema = z.object({
    phone: z.string().min(6),
    accountType: z.enum(['client', 'driver']),
  });

  app.post('/v1/auth/otp/request', {
    config: routeRateLimit(ctx.env, 10, '10 minutes'),
    handler: async (request, reply) => {
      const body = requestSchema.parse(request.body);
      const phone = normalizePhone(body.phone);

      const result = await requestOtp(ctx.db, {
        phone,
        accountType: body.accountType,
        config: otpConfig,
        requestIp: request.ip,
      });

      // En développement le code est journalisé et renvoyé pour permettre les
      // essais sans passerelle SMS ; interdit en production (config/env.ts).
      ctx.log.info(
        { cible: describeOtpTarget(phone, body.accountType) },
        ctx.env.OTP_DEBUG_RETURN ? `Code OTP : ${result.debugCode}` : 'Code OTP envoyé',
      );

      return reply.send({
        expiresAt: result.expiresAt.toISOString(),
        ...(ctx.env.OTP_DEBUG_RETURN ? { code: result.debugCode } : {}),
      });
    },
  });

  const verifySchema = z.object({
    phone: z.string().min(6),
    accountType: z.enum(['client', 'driver']),
    code: z.string().min(4).max(8),
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    email: z.string().email().optional(),
  });

  app.post('/v1/auth/otp/verify', {
    config: routeRateLimit(ctx.env, 20, '10 minutes'),
    handler: async (request, reply) => {
      const body = verifySchema.parse(request.body);
      const phone = normalizePhone(body.phone);

      const verification = await verifyOtp(ctx.db, {
        phone,
        accountType: body.accountType,
        code: body.code,
        maxAttempts: otpConfig.maxAttempts,
      });

      if (!verification.ok) throw otpFailureError();

      const profile = {
        phone,
        ...(body.firstName ? { firstName: body.firstName } : {}),
        ...(body.lastName ? { lastName: body.lastName } : {}),
        ...(body.email ? { email: body.email } : {}),
      };

      const account =
        body.accountType === 'client'
          ? await upsertClient(ctx, profile)
          : await upsertDriver(ctx, profile);

      const session = await issueRefreshToken(ctx.db, {
        subjectId: account.id,
        accountType: body.accountType,
        ttlSeconds: ctx.env.JWT_REFRESH_TTL,
        userAgent: request.headers['user-agent'] ?? null,
        ip: request.ip,
      });

      return reply.send({
        accessToken: app.jwt.sign({ sub: account.id, type: body.accountType }),
        refreshToken: session.refreshToken,
        expiresIn: ctx.env.JWT_ACCESS_TTL,
        account,
        isNew: account.isNew,
      });
    },
  });

  app.post('/v1/auth/refresh', {
    config: routeRateLimit(ctx.env, 30, '10 minutes'),
    handler: async (request, reply) => {
      const body = z.object({ refreshToken: z.string().min(10) }).parse(request.body);

      const rotated = await rotateRefreshToken(ctx.db, {
        token: body.refreshToken,
        ttlSeconds: ctx.env.JWT_REFRESH_TTL,
        userAgent: request.headers['user-agent'] ?? null,
        ip: request.ip,
      });

      const role =
        rotated.accountType === 'admin'
          ? (
              await ctx.db
                .selectFrom('admin_users')
                .select('role')
                .where('id', '=', rotated.subjectId)
                .executeTakeFirst()
            )?.role
          : undefined;

      return reply.send({
        accessToken: app.jwt.sign({
          sub: rotated.subjectId,
          type: rotated.accountType,
          ...(role ? { role } : {}),
        }),
        refreshToken: rotated.session.refreshToken,
        expiresIn: ctx.env.JWT_ACCESS_TTL,
      });
    },
  });

  app.post('/v1/auth/logout', {
    onRequest: [app.authenticate],
    handler: async (request, reply) => {
      const account = request.account!;
      await revokeAllSessions(ctx.db, account.sub, account.type);
      return reply.send({ ok: true });
    },
  });

  // -------------------------------------------------------------------------
  // Administration (§14) — identifiants classiques, pas d'OTP
  // -------------------------------------------------------------------------
  app.post('/v1/admin/auth/login', {
    config: routeRateLimit(ctx.env, 10, '10 minutes'),
    handler: async (request, reply) => {
      const body = z
        .object({ email: z.string().email(), password: z.string().min(8) })
        .parse(request.body);

      const admin = await ctx.db
        .selectFrom('admin_users')
        .selectAll()
        .where('email', '=', body.email.toLowerCase())
        .executeTakeFirst();

      // Le mot de passe est vérifié même sans compte correspondant, contre un
      // hachage factice, afin que le temps de réponse ne révèle pas l'existence
      // du compte.
      const passwordHash =
        admin?.password_hash ?? 'scrypt$00000000000000000000000000000000$00';
      const valid = await verifySecret(body.password, passwordHash);

      if (!admin || !valid) throw unauthorized('Identifiants invalides.');
      if (!admin.is_active) throw forbidden('Ce compte administrateur est désactivé.');

      const session = await issueRefreshToken(ctx.db, {
        subjectId: admin.id,
        accountType: 'admin',
        ttlSeconds: ctx.env.JWT_REFRESH_TTL,
        userAgent: request.headers['user-agent'] ?? null,
        ip: request.ip,
      });

      await ctx.db
        .updateTable('admin_users')
        .set({ last_login_at: new Date() })
        .where('id', '=', admin.id)
        .execute();

      await recordAudit(ctx.db, {
        actorType: 'admin',
        actorId: admin.id,
        action: 'admin.login',
        entityType: 'admin_user',
        entityId: admin.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });

      return reply.send({
        accessToken: app.jwt.sign({ sub: admin.id, type: 'admin', role: admin.role }),
        refreshToken: session.refreshToken,
        expiresIn: ctx.env.JWT_ACCESS_TTL,
        account: {
          id: admin.id,
          email: admin.email,
          fullName: admin.full_name,
          role: admin.role,
        },
      });
    },
  });
}

interface UpsertInput {
  phone: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

async function upsertClient(ctx: AppContext, input: UpsertInput) {
  const existing = await ctx.db
    .selectFrom('users')
    .selectAll()
    .where('phone', '=', input.phone)
    .executeTakeFirst();

  if (existing) {
    if (existing.deleted_at) throw forbidden('Ce compte a été supprimé.');
    if (existing.suspended_at) throw forbidden('Ce compte est suspendu.');

    await ctx.db
      .updateTable('users')
      .set({
        phone_verified_at: new Date(),
        ...(input.firstName ? { first_name: input.firstName } : {}),
        ...(input.lastName ? { last_name: input.lastName } : {}),
        ...(input.email ? { email: input.email } : {}),
      })
      .where('id', '=', existing.id)
      .execute();

    return { id: existing.id, phone: existing.phone, type: 'client' as const, isNew: false };
  }

  const created = await ctx.db
    .insertInto('users')
    .values({
      phone: input.phone,
      first_name: input.firstName ?? null,
      last_name: input.lastName ?? null,
      email: input.email ?? null,
      phone_verified_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return { id: created.id, phone: created.phone, type: 'client' as const, isNew: true };
}

async function upsertDriver(ctx: AppContext, input: UpsertInput) {
  const existing = await ctx.db
    .selectFrom('drivers')
    .selectAll()
    .where('phone', '=', input.phone)
    .executeTakeFirst();

  if (existing) {
    if (existing.deleted_at) throw forbidden('Ce compte a été supprimé.');

    await ctx.db
      .updateTable('drivers')
      .set({ phone_verified_at: new Date() })
      .where('id', '=', existing.id)
      .execute();

    return {
      id: existing.id,
      phone: existing.phone,
      type: 'driver' as const,
      status: existing.status,
      isNew: false,
    };
  }

  // Un chauffeur est identifié nominativement dès la création : c'est la base
  // du dossier de vérification exigé au §5.
  if (!input.firstName || !input.lastName) {
    throw unauthorized('Nom et prénom sont requis pour créer un compte chauffeur.');
  }

  const created = await ctx.db
    .insertInto('drivers')
    .values({
      phone: input.phone,
      first_name: input.firstName,
      last_name: input.lastName,
      email: input.email ?? null,
      phone_verified_at: new Date(),
      status: 'pending',
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return {
    id: created.id,
    phone: created.phone,
    type: 'driver' as const,
    status: created.status,
    isNew: true,
  };
}

export type { AccountType };
