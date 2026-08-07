import { sql } from 'kysely';
import { loadEnv, type Env } from '../../src/config/env.js';
import { createDb, createPool, type DB } from '../../src/db/index.js';
import { runMigrations } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';
import { buildServer, type BuiltServer } from '../../src/server.js';

/**
 * Environnement de test d'intégration.
 *
 * Les tests s'exécutent contre un vrai PostgreSQL : une machine à états, des
 * contraintes d'unicité partielles et un grand livre comptable ne se vérifient
 * pas sérieusement contre une base simulée.
 *
 * Base utilisée : TEST_DATABASE_URL, à défaut DATABASE_URL. Si aucune n'est
 * définie, les tests d'intégration sont ignorés plutôt qu'en échec, afin que la
 * suite unitaire reste exécutable sans infrastructure.
 */

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgres://mobilite:mobilite@127.0.0.1:5432/mobilite_test';

export const integrationEnabled = process.env.SKIP_INTEGRATION !== '1';

export function testEnv(): Env {
  return loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    JWT_SECRET: 'secret-de-test-uniquement-0123456789abcdef',
    OTP_DEBUG_RETURN: 'true',
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: 'http://localhost:5173',
    DISPATCH_OFFER_TTL_SECONDS: '20',
    ROUTING_DETOUR_FACTOR: '1.35',
    ROUTING_AVERAGE_SPEED_KMH: '25',
  } as NodeJS.ProcessEnv);
}

/** Tables vidées entre deux tests, dans l'ordre inverse des dépendances. */
const TRANSIENT_TABLES = [
  'audit_logs',
  'notifications',
  'support_ticket_messages',
  'support_tickets',
  'reviews',
  'wallet_transactions',
  'withdrawals',
  'driver_wallets',
  'refunds',
  'payments',
  'promotion_redemptions',
  'promotions',
  'ride_offers',
  'ride_locations',
  'ride_events',
  'rides',
  // Les grilles tarifaires sont recréées par le jeu de données : sans cela, une
  // grille créée par un test fausserait les montants attendus du suivant.
  'pricing_rules',
  'driver_locations',
  'driver_documents',
  'vehicles',
  'drivers',
  'users',
  'refresh_tokens',
  'otp_codes',
];

export async function resetTransientData(db: DB): Promise<void> {
  await sql.raw(`TRUNCATE TABLE ${TRANSIENT_TABLES.join(', ')} CASCADE`).execute(db);
}

export interface TestHarness extends BuiltServer {
  db: DB;
  env: Env;
}

export async function createTestHarness(): Promise<TestHarness> {
  const env = testEnv();

  await runMigrations(env.DATABASE_URL);

  const pool = createPool({ connectionString: env.DATABASE_URL, max: 5 });
  const db = createDb(pool);

  await resetTransientData(db);
  await seed(db, { withDemoData: false });

  const server = await buildServer({ env, db });

  return {
    ...server,
    db,
    env,
    close: async () => {
      await server.app.close();
      await db.destroy();
    },
  };
}

/** Raccourci d'appel HTTP typé sur l'instance Fastify (inject, sans réseau). */
export async function call(
  harness: TestHarness,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    token?: string;
    payload?: unknown;
  },
): Promise<{ status: number; body: any }> {
  const response = await harness.app.inject({
    method: options.method,
    url: options.url,
    ...(options.token ? { headers: { authorization: `Bearer ${options.token}` } } : {}),
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
  });

  let body: unknown;
  try {
    body = response.body ? JSON.parse(response.body) : null;
  } catch {
    body = response.body;
  }

  return { status: response.statusCode, body };
}

/** Inscrit et authentifie un client via le parcours OTP réel. */
export async function loginClient(
  harness: TestHarness,
  phone: string,
  profile: { firstName?: string; lastName?: string } = {},
): Promise<{ token: string; id: string }> {
  const request = await call(harness, {
    method: 'POST',
    url: '/v1/auth/otp/request',
    payload: { phone, accountType: 'client' },
  });

  const verify = await call(harness, {
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: { phone, accountType: 'client', code: request.body.code, ...profile },
  });

  if (verify.status !== 200) {
    throw new Error(`Connexion client impossible : ${JSON.stringify(verify.body)}`);
  }

  return { token: verify.body.accessToken, id: verify.body.account.id };
}

/** Inscrit un chauffeur, le valide, lui attribue un véhicule et le met en ligne. */
export async function createApprovedDriver(
  harness: TestHarness,
  params: {
    phone: string;
    firstName: string;
    lastName: string;
    latitude: number;
    longitude: number;
    categoryCode?: string;
  },
): Promise<{ token: string; id: string; vehicleId: string }> {
  const request = await call(harness, {
    method: 'POST',
    url: '/v1/auth/otp/request',
    payload: { phone: params.phone, accountType: 'driver' },
  });

  const verify = await call(harness, {
    method: 'POST',
    url: '/v1/auth/otp/verify',
    payload: {
      phone: params.phone,
      accountType: 'driver',
      code: request.body.code,
      firstName: params.firstName,
      lastName: params.lastName,
    },
  });

  if (verify.status !== 200) {
    throw new Error(`Inscription chauffeur impossible : ${JSON.stringify(verify.body)}`);
  }

  const driverId: string = verify.body.account.id;
  const token: string = verify.body.accessToken;

  const category = await harness.db
    .selectFrom('vehicle_categories')
    .select('id')
    .where('code', '=', params.categoryCode ?? 'eco')
    .executeTakeFirstOrThrow();

  const vehicle = await call(harness, {
    method: 'POST',
    url: '/v1/driver/vehicles',
    token,
    payload: {
      vehicleCategoryId: category.id,
      make: 'Toyota',
      model: 'Corolla',
      plateNumber: `${params.phone.slice(-4)}-CI`,
    },
  });

  if (vehicle.status !== 201) {
    throw new Error(`Création véhicule impossible : ${JSON.stringify(vehicle.body)}`);
  }

  // Validation directe en base : le parcours d'administration est éprouvé
  // séparément, il n'a pas à alourdir chaque préparation de test.
  await harness.db
    .updateTable('drivers')
    .set({ status: 'approved', approved_at: new Date() })
    .where('id', '=', driverId)
    .execute();

  await harness.db
    .insertInto('driver_wallets')
    .values({ driver_id: driverId, currency: 'XOF' })
    .onConflict((oc) => oc.column('driver_id').doNothing())
    .execute();

  await call(harness, {
    method: 'POST',
    url: '/v1/driver/availability',
    token,
    payload: { online: true },
  });

  await call(harness, {
    method: 'POST',
    url: '/v1/driver/location',
    token,
    payload: { latitude: params.latitude, longitude: params.longitude },
  });

  return { token, id: driverId, vehicleId: vehicle.body.vehicle.id };
}

/** Authentifie le compte d'administration créé par le jeu de données initial. */
export async function loginAdmin(harness: TestHarness): Promise<string> {
  const response = await call(harness, {
    method: 'POST',
    url: '/v1/admin/auth/login',
    payload: { email: 'admin@plateforme.local', password: 'AdminPlateforme2026!' },
  });

  if (response.status !== 200) {
    throw new Error(`Connexion administrateur impossible : ${JSON.stringify(response.body)}`);
  }

  return response.body.accessToken;
}

export const ABIDJAN = { latitude: 5.3364, longitude: -4.0267 };
export const COCODY = { latitude: 5.3599, longitude: -3.9906 };
