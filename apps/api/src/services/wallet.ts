import { sql } from 'kysely';
import type { DBTransaction } from '../db/index.js';
import type { WalletEntryType } from '../db/types.js';
import { conflict, unprocessable } from '../lib/errors.js';

/**
 * Portefeuille chauffeur — §10 du cahier des charges.
 *
 * Principe : `wallet_transactions` est un grand livre en **ajout seul**. Aucun
 * solde n'est modifié sans écriture correspondante, et chaque écriture porte le
 * solde résultant (`balance_after`). Cela rend les rapprochements comptables
 * possibles (§8) et permet de reconstruire un solde à n'importe quelle date.
 *
 * Toutes les fonctions exigent une transaction : un crédit sans son écriture,
 * ou l'inverse, corromprait la comptabilité.
 */

export interface LedgerEntryInput {
  driverId: string;
  entryType: WalletEntryType;
  /** Signé : positif = crédit, négatif = débit. */
  amount: number;
  rideId?: string | null;
  paymentId?: string | null;
  withdrawalId?: string | null;
  description?: string | null;
  createdBy?: string | null;
  currency?: string;
}

export interface WalletSnapshot {
  driverId: string;
  balance: number;
  pendingBalance: number;
  totalEarned: number;
  totalCommission: number;
  totalWithdrawn: number;
  currency: string;
}

/** Crée le portefeuille s'il n'existe pas encore (à la validation du chauffeur). */
export async function ensureWallet(
  trx: DBTransaction,
  driverId: string,
  currency: string,
): Promise<void> {
  await trx
    .insertInto('driver_wallets')
    .values({ driver_id: driverId, currency })
    .onConflict((oc) => oc.column('driver_id').doNothing())
    .execute();
}

/**
 * Écrit une ligne au grand livre et met à jour le solde, sous verrou de ligne.
 *
 * Le `SELECT ... FOR UPDATE` sérialise les écritures concurrentes sur un même
 * portefeuille : deux courses terminées simultanément ne peuvent pas lire le
 * même solde et en écraser une.
 */
export async function postLedgerEntry(
  trx: DBTransaction,
  input: LedgerEntryInput,
): Promise<{ transactionId: string; balanceAfter: number }> {
  if (!Number.isSafeInteger(input.amount)) {
    throw unprocessable('invalid_amount', 'Montant d’écriture invalide.');
  }

  const currency = input.currency ?? 'XOF';
  await ensureWallet(trx, input.driverId, currency);

  const wallet = await trx
    .selectFrom('driver_wallets')
    .selectAll()
    .where('driver_id', '=', input.driverId)
    .forUpdate()
    .executeTakeFirstOrThrow();

  const balanceAfter = wallet.balance + input.amount;

  let inserted: { id: string };
  try {
    inserted = await trx
      .insertInto('wallet_transactions')
      .values({
        driver_id: input.driverId,
        entry_type: input.entryType,
        amount: input.amount,
        balance_after: balanceAfter,
        currency,
        ride_id: input.rideId ?? null,
        payment_id: input.paymentId ?? null,
        withdrawal_id: input.withdrawalId ?? null,
        description: input.description ?? null,
        created_by: input.createdBy ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
  } catch (error) {
    // L'index unique (ride_id, entry_type) garantit l'idempotence comptable :
    // une seconde tentative de règlement d'une même course ne double pas le gain.
    if (isUniqueViolation(error)) {
      throw conflict(
        'ledger_entry_exists',
        'Une écriture de ce type existe déjà pour cette course.',
      );
    }
    throw error;
  }

  await trx
    .updateTable('driver_wallets')
    .set({
      balance: balanceAfter,
      total_earned:
        input.entryType === 'ride_earning' || input.entryType === 'bonus'
          ? wallet.total_earned + Math.max(0, input.amount)
          : wallet.total_earned,
      total_commission:
        input.entryType === 'commission' || input.entryType === 'cash_collected'
          ? wallet.total_commission + Math.max(0, -input.amount)
          : wallet.total_commission,
      total_withdrawn:
        input.entryType === 'withdrawal'
          ? wallet.total_withdrawn + Math.max(0, -input.amount)
          : input.entryType === 'withdrawal_reversal'
            ? Math.max(0, wallet.total_withdrawn - Math.max(0, input.amount))
            : wallet.total_withdrawn,
      updated_at: new Date(),
    })
    .where('driver_id', '=', input.driverId)
    .execute();

  return { transactionId: inserted.id, balanceAfter };
}

export async function getWallet(
  trx: DBTransaction,
  driverId: string,
): Promise<WalletSnapshot | null> {
  const row = await trx
    .selectFrom('driver_wallets')
    .selectAll()
    .where('driver_id', '=', driverId)
    .executeTakeFirst();

  if (!row) return null;

  return {
    driverId: row.driver_id,
    balance: row.balance,
    pendingBalance: row.pending_balance,
    totalEarned: row.total_earned,
    totalCommission: row.total_commission,
    totalWithdrawn: row.total_withdrawn,
    currency: row.currency,
  };
}

/**
 * Vérifie qu'un solde couvre un retrait. Les règles de retrait (montant minimum,
 * délai de carence) sont configurables en administration (§10) et lues depuis
 * `platform_settings`.
 */
export interface WithdrawalRules {
  minimumAmount: number;
  maximumAmount: number | null;
}

export const DEFAULT_WITHDRAWAL_RULES: WithdrawalRules = {
  minimumAmount: 1_000,
  maximumAmount: null,
};

export function assertWithdrawalAllowed(
  balance: number,
  amount: number,
  rules: WithdrawalRules,
): void {
  if (amount <= 0) {
    throw unprocessable('invalid_amount', 'Le montant du retrait doit être positif.');
  }
  if (amount < rules.minimumAmount) {
    throw unprocessable(
      'below_minimum',
      `Le retrait minimum est de ${rules.minimumAmount}.`,
    );
  }
  if (rules.maximumAmount !== null && amount > rules.maximumAmount) {
    throw unprocessable('above_maximum', `Le retrait maximum est de ${rules.maximumAmount}.`);
  }
  if (amount > balance) {
    throw unprocessable('insufficient_balance', 'Solde insuffisant pour ce retrait.');
  }
}

/** Recalcule le solde depuis le grand livre — utilisé pour les contrôles de cohérence. */
export async function recomputeBalance(trx: DBTransaction, driverId: string): Promise<number> {
  const row = await trx
    .selectFrom('wallet_transactions')
    .select(sql<number>`coalesce(sum(amount), 0)`.as('total'))
    .where('driver_id', '=', driverId)
    .executeTakeFirstOrThrow();
  return Number(row.total);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
