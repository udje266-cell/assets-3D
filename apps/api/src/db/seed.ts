import { loadEnv } from '../config/env.js';
import { hashSecret } from '../lib/crypto.js';
import { createDb, createPool, type DB } from './index.js';

/**
 * Jeu de données initial.
 *
 * Contient le minimum nécessaire à l'exploitation (catégories de véhicules,
 * grilles tarifaires, compte d'administration) et, hors production, quelques
 * comptes de démonstration situés à Abidjan pour éprouver l'attribution.
 *
 * Idempotent : réexécuter le script ne duplique rien.
 */

/** Coordonnées de référence : Plateau, Abidjan. */
const ABIDJAN = { latitude: 5.3364, longitude: -4.0267 };

export interface SeedOptions {
  /** Ajoute des chauffeurs et clients de démonstration. */
  withDemoData: boolean;
  adminEmail?: string;
  adminPassword?: string;
}

export async function seed(db: DB, options: SeedOptions): Promise<void> {
  // -------------------------------------------------------------------------
  // Catégories de véhicules (§7)
  // -------------------------------------------------------------------------
  const categories = [
    { code: 'eco', label: 'Éco', description: 'Berline économique, 4 places', seats: 4, sort: 1 },
    { code: 'confort', label: 'Confort', description: 'Berline confort, 4 places', seats: 4, sort: 2 },
    { code: 'van', label: 'Van', description: 'Véhicule 6 places', seats: 6, sort: 3 },
  ];

  for (const category of categories) {
    await db
      .insertInto('vehicle_categories')
      .values({
        code: category.code,
        label: category.label,
        description: category.description,
        seats: category.seats,
        sort_order: category.sort,
      })
      .onConflict((oc) => oc.column('code').doNothing())
      .execute();
  }

  // -------------------------------------------------------------------------
  // Grilles tarifaires (§7) — valeurs de départ à ajuster selon l'étude de marché
  // -------------------------------------------------------------------------
  const tariffs: Record<string, { base: number; km: number; min: number; minimum: number }> = {
    eco: { base: 500, km: 250, min: 25, minimum: 1_000 },
    confort: { base: 800, km: 350, min: 40, minimum: 1_500 },
    van: { base: 1_200, km: 450, min: 50, minimum: 2_500 },
  };

  for (const [code, tariff] of Object.entries(tariffs)) {
    const category = await db
      .selectFrom('vehicle_categories')
      .select('id')
      .where('code', '=', code)
      .executeTakeFirst();

    if (!category) continue;

    const existing = await db
      .selectFrom('pricing_rules')
      .select('id')
      .where('vehicle_category_id', '=', category.id)
      .where('zone_code', '=', 'default')
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (existing) continue;

    await db
      .insertInto('pricing_rules')
      .values({
        vehicle_category_id: category.id,
        zone_code: 'default',
        base_fare: tariff.base,
        per_km: tariff.km,
        per_minute: tariff.min,
        minimum_fare: tariff.minimum,
        booking_fee: 100,
        cancellation_fee: 500,
        surge_bps: 10_000,
        commission_bps: 2_000, // 20 %, taux d'exemple du §8
        round_to_nearest: 5,
        currency: 'XOF',
      })
      .execute();
  }

  // -------------------------------------------------------------------------
  // Paramètres de plateforme
  // -------------------------------------------------------------------------
  const settings: Array<{ key: string; value: Record<string, unknown>; description: string }> = [
    {
      key: 'withdrawal.rules',
      value: { minimum_amount: 1_000, maximum_amount: null },
      description: 'Règles de retrait du portefeuille chauffeur (§10)',
    },
    {
      key: 'dispatch.weights',
      value: { distance: 0.5, eta: 0.25, rating: 0.15, acceptance: 0.1 },
      description: 'Poids de classement des chauffeurs (§19)',
    },
  ];

  for (const setting of settings) {
    await db
      .insertInto('platform_settings')
      .values({ key: setting.key, value: setting.value, description: setting.description })
      .onConflict((oc) => oc.column('key').doNothing())
      .execute();
  }

  // -------------------------------------------------------------------------
  // Compte d'administration (§14)
  // -------------------------------------------------------------------------
  const adminEmail = options.adminEmail ?? 'admin@plateforme.local';
  const adminPassword = options.adminPassword ?? 'AdminPlateforme2026!';

  const existingAdmin = await db
    .selectFrom('admin_users')
    .select('id')
    .where('email', '=', adminEmail)
    .executeTakeFirst();

  if (!existingAdmin) {
    await db
      .insertInto('admin_users')
      .values({
        email: adminEmail,
        full_name: 'Administrateur plateforme',
        password_hash: await hashSecret(adminPassword),
        role: 'super_admin',
      })
      .execute();
  }

  // -------------------------------------------------------------------------
  // Promotion d'exemple (§13 : « code BIENVENUE sur la première course »)
  // -------------------------------------------------------------------------
  await db
    .insertInto('promotions')
    .values({
      code: 'BIENVENUE',
      label: 'Bienvenue sur la plateforme',
      description: '20 % de réduction sur la première course, plafonnés à 1 000 FCFA.',
      type: 'percentage',
      value: 2_000,
      max_discount: 1_000,
      min_fare: 500,
      max_per_user: 1,
      first_ride_only: true,
    })
    .onConflict((oc) => oc.doNothing())
    .execute();

  if (!options.withDemoData) return;

  // -------------------------------------------------------------------------
  // Données de démonstration
  // -------------------------------------------------------------------------
  const category = await db
    .selectFrom('vehicle_categories')
    .select('id')
    .where('code', '=', 'eco')
    .executeTakeFirstOrThrow();

  const demoDrivers = [
    { phone: '+2250700000001', first: 'Kouassi', last: 'Yao', dLat: 0.004, dLon: 0.003, plate: 'AB-1234-CI' },
    { phone: '+2250700000002', first: 'Aya', last: 'Traoré', dLat: -0.006, dLon: 0.002, plate: 'AB-5678-CI' },
    { phone: '+2250700000003', first: 'Ibrahim', last: 'Coulibaly', dLat: 0.011, dLon: -0.009, plate: 'AB-9012-CI' },
  ];

  for (const demo of demoDrivers) {
    const existing = await db
      .selectFrom('drivers')
      .select('id')
      .where('phone', '=', demo.phone)
      .executeTakeFirst();

    if (existing) continue;

    const driver = await db
      .insertInto('drivers')
      .values({
        phone: demo.phone,
        first_name: demo.first,
        last_name: demo.last,
        status: 'approved',
        availability: 'online',
        phone_verified_at: new Date(),
        approved_at: new Date(),
        rating_average: 4.6,
        rating_count: 12,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const vehicle = await db
      .insertInto('vehicles')
      .values({
        driver_id: driver.id,
        vehicle_category_id: category.id,
        make: 'Toyota',
        model: 'Corolla',
        year: 2019,
        color: 'Gris',
        plate_number: demo.plate,
        is_verified: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .updateTable('drivers')
      .set({ active_vehicle_id: vehicle.id })
      .where('id', '=', driver.id)
      .execute();

    await db
      .insertInto('driver_locations')
      .values({
        driver_id: driver.id,
        latitude: ABIDJAN.latitude + demo.dLat,
        longitude: ABIDJAN.longitude + demo.dLon,
        recorded_at: new Date(),
      })
      .onConflict((oc) => oc.column('driver_id').doNothing())
      .execute();

    await db
      .insertInto('driver_wallets')
      .values({ driver_id: driver.id, currency: 'XOF' })
      .onConflict((oc) => oc.column('driver_id').doNothing())
      .execute();
  }

  await db
    .insertInto('users')
    .values({
      phone: '+2250500000001',
      first_name: 'Awa',
      last_name: 'Diabaté',
      phone_verified_at: new Date(),
    })
    .onConflict((oc) => oc.column('phone').doNothing())
    .execute();
}

// Exécution directe : npm run seed
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();
  const pool = createPool({ connectionString: env.DATABASE_URL });
  const db = createDb(pool);

  seed(db, { withDemoData: env.NODE_ENV !== 'production' })
    .then(async () => {
      console.log('Jeu de données initial appliqué.');
      if (env.NODE_ENV !== 'production') {
        console.log('Administration : admin@plateforme.local / AdminPlateforme2026!');
        console.log('Changez ce mot de passe avant toute mise en ligne.');
      }
      await db.destroy();
      process.exit(0);
    })
    .catch(async (error: Error) => {
      console.error('Échec du jeu de données :', error.message);
      await db.destroy();
      process.exit(1);
    });
}
