import { Kysely, PostgresDialect, type Transaction } from 'kysely';
import pg from 'pg';
import type { Database } from './types.js';

/**
 * Connexion PostgreSQL.
 *
 * Deux réglages de parseurs sont volontaires :
 *  - int8 (BIGINT) est renvoyé en `number`. Tous les montants de la plateforme
 *    restent très en deçà de 2^53 (Number.MAX_SAFE_INTEGER ≈ 9,007 × 10^15,
 *    soit 9 millions de milliards de FCFA) ; travailler en `number` évite de
 *    répandre des `bigint` dans le code métier et la sérialisation JSON.
 *  - numeric est renvoyé en `number` pour les seules notes moyennes (0 à 5).
 */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Valeur BIGINT hors des entiers sûrs JavaScript : ${value}`);
  }
  return parsed;
});
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));

export type DB = Kysely<Database>;
export type DBTransaction = Transaction<Database>;
/** Accepte indifféremment la connexion racine ou une transaction en cours. */
export type Queryable = DB | DBTransaction;

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
}

export function createPool(options: CreateDbOptions): pg.Pool {
  return new pg.Pool({
    connectionString: options.connectionString,
    max: options.max ?? 10,
    // Une requête qui dépasse 15 s sur une plateforme temps réel est un bug,
    // pas une lenteur : mieux vaut échouer et libérer la connexion.
    statement_timeout: 15_000,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

export function createDb(pool: pg.Pool): DB {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool }),
  });
}
