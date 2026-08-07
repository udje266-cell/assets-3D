import { loadEnv } from '../config/env.js';
import { splitFare } from '../domain/commission.js';
import { haversineMeters } from '../domain/geo.js';
import { computeFare, pricingSnapshot, toPricingParameters } from '../domain/pricing.js';
import { generateRideReference } from '../lib/identifiers.js';
import { createDb, createPool, type DB } from './index.js';
import { seed } from './seed.js';

/**
 * Historique de démonstration.
 *
 * Génère plusieurs semaines de courses réalistes afin d'évaluer le tableau de
 * bord, les indicateurs (§24) et les écrans d'exploitation sur des données non
 * triviales. Réservé au développement : le script refuse de s'exécuter en
 * production.
 *
 *   npm run demo --workspace apps/api
 */

const ABIDJAN = { latitude: 5.3364, longitude: -4.0267 };

/** Quelques quartiers d'Abidjan, pour des trajets plausibles. */
const PLACES = [
  { name: 'Plateau', latitude: 5.3264, longitude: -4.0223 },
  { name: 'Cocody', latitude: 5.3599, longitude: -3.9906 },
  { name: 'Yopougon', latitude: 5.3406, longitude: -4.0908 },
  { name: 'Marcory', latitude: 5.2949, longitude: -3.9922 },
  { name: 'Treichville', latitude: 5.2933, longitude: -4.0102 },
  { name: 'Abobo', latitude: 5.4324, longitude: -4.0197 },
  { name: 'Koumassi', latitude: 5.2966, longitude: -3.9481 },
];

const FIRST_NAMES = ['Kouassi', 'Aya', 'Ibrahim', 'Awa', 'Sekou', 'Marie', 'Yao', 'Fatou', 'Ali', 'Adjoua'];
const LAST_NAMES = ['Yao', 'Traoré', 'Coulibaly', 'Diabaté', 'Bamba', 'Koné', 'N’Guessan', 'Ouattara'];

/** Générateur pseudo-aléatoire déterministe : deux exécutions donnent le même jeu. */
function makeRandom(seedValue: number) {
  let state = seedValue;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

export async function generateDemoHistory(
  db: DB,
  options: { days: number; ridesPerDay: number; drivers: number; clients: number },
): Promise<{ rides: number; drivers: number; clients: number }> {
  const random = makeRandom(20_260_807);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;

  const category = await db
    .selectFrom('vehicle_categories')
    .select('id')
    .where('code', '=', 'eco')
    .executeTakeFirstOrThrow();

  const rule = await db
    .selectFrom('pricing_rules')
    .selectAll()
    .where('vehicle_category_id', '=', category.id)
    .where('is_active', '=', true)
    .executeTakeFirstOrThrow();

  const pricing = toPricingParameters(rule);

  // --- Chauffeurs ---------------------------------------------------------
  const driverIds: string[] = [];
  for (let i = 0; i < options.drivers; i += 1) {
    const phone = `+22507${String(20_000_000 + i).padStart(8, '0')}`;
    const existing = await db
      .selectFrom('drivers')
      .select('id')
      .where('phone', '=', phone)
      .executeTakeFirst();

    if (existing) {
      driverIds.push(existing.id);
      continue;
    }

    const driver = await db
      .insertInto('drivers')
      .values({
        phone,
        first_name: pick(FIRST_NAMES),
        last_name: pick(LAST_NAMES),
        status: 'approved',
        availability: random() > 0.4 ? 'online' : 'offline',
        phone_verified_at: new Date(),
        approved_at: new Date(),
        rating_average: Math.round((4 + random()) * 100) / 100,
        rating_count: Math.floor(random() * 60),
        offers_received: 0,
        offers_accepted: 0,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    const vehicle = await db
      .insertInto('vehicles')
      .values({
        driver_id: driver.id,
        vehicle_category_id: category.id,
        make: pick(['Toyota', 'Hyundai', 'Kia', 'Suzuki']),
        model: pick(['Corolla', 'Accent', 'Rio', 'Swift']),
        year: 2015 + Math.floor(random() * 9),
        color: pick(['Gris', 'Blanc', 'Noir', 'Bleu']),
        plate_number: `DM-${String(1000 + i)}-CI`,
        is_verified: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .updateTable('drivers')
      .set({ active_vehicle_id: vehicle.id })
      .where('id', '=', driver.id)
      .execute();

    const place = pick(PLACES);
    await db
      .insertInto('driver_locations')
      .values({
        driver_id: driver.id,
        latitude: place.latitude + (random() - 0.5) * 0.01,
        longitude: place.longitude + (random() - 0.5) * 0.01,
        recorded_at: new Date(),
      })
      .onConflict((oc) => oc.column('driver_id').doNothing())
      .execute();

    await db
      .insertInto('driver_wallets')
      .values({ driver_id: driver.id, currency: rule.currency })
      .onConflict((oc) => oc.column('driver_id').doNothing())
      .execute();

    driverIds.push(driver.id);
  }

  // --- Clients ------------------------------------------------------------
  const clientIds: string[] = [];
  for (let i = 0; i < options.clients; i += 1) {
    const phone = `+22505${String(20_000_000 + i).padStart(8, '0')}`;
    const existing = await db
      .selectFrom('users')
      .select('id')
      .where('phone', '=', phone)
      .executeTakeFirst();

    if (existing) {
      clientIds.push(existing.id);
      continue;
    }

    const user = await db
      .insertInto('users')
      .values({
        phone,
        first_name: pick(FIRST_NAMES),
        last_name: pick(LAST_NAMES),
        phone_verified_at: new Date(),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    clientIds.push(user.id);
  }

  // --- Courses ------------------------------------------------------------
  let created = 0;

  for (let day = options.days - 1; day >= 0; day -= 1) {
    // Le volume varie d'un jour à l'autre : une série plate n'apprend rien.
    const count = Math.max(1, Math.round(options.ridesPerDay * (0.55 + random() * 0.9)));

    for (let n = 0; n < count; n += 1) {
      const from = pick(PLACES);
      let to = pick(PLACES);
      while (to.name === from.name) to = pick(PLACES);

      const requestedAt = new Date(
        Date.now() - day * 86_400_000 - Math.floor(random() * 20 * 3_600_000),
      );

      const straight = haversineMeters(from, to);
      const distance = Math.round(straight * 1.35);
      const duration = Math.round((distance / 1000 / (18 + random() * 14)) * 3600);

      const fare = computeFare({ distanceMeters: distance, durationSeconds: duration }, pricing);
      const split = splitFare(fare.total, pricing.commissionBps);

      const roll = random();
      // Répartition volontairement réaliste : quelques annulations, de rares
      // expirations, la grande majorité des courses honorées.
      const status = roll < 0.08 ? 'cancelled' : roll < 0.11 ? 'expired' : 'rated';
      const paymentMethod = random() < 0.6 ? 'cash' : 'mobile_money';
      const driverId = pick(driverIds);
      const userId = pick(clientIds);

      const assignedAt = new Date(requestedAt.getTime() + 40_000 + random() * 90_000);
      const arrivedAt = new Date(assignedAt.getTime() + 120_000 + random() * 240_000);
      const startedAt = new Date(arrivedAt.getTime() + 30_000 + random() * 120_000);
      const completedAt = new Date(startedAt.getTime() + duration * 1000);

      const isFulfilled = status === 'rated';

      const ride = await db
        .insertInto('rides')
        .values({
          reference: generateRideReference(requestedAt),
          user_id: userId,
          driver_id: status === 'expired' ? null : driverId,
          vehicle_category_id: category.id,
          status,
          pickup_latitude: from.latitude,
          pickup_longitude: from.longitude,
          pickup_address: from.name,
          dropoff_latitude: to.latitude,
          dropoff_longitude: to.longitude,
          dropoff_address: to.name,
          estimated_distance_m: distance,
          estimated_duration_s: duration,
          actual_distance_m: isFulfilled ? distance : null,
          actual_duration_s: isFulfilled ? duration : null,
          pricing_rule_id: rule.id,
          pricing_snapshot: pricingSnapshot(pricing, fare),
          currency: rule.currency,
          estimated_fare: fare.total,
          final_fare: isFulfilled ? fare.total : null,
          platform_amount: isFulfilled ? split.platformAmount : 0,
          driver_amount: isFulfilled ? split.driverAmount : 0,
          commission_bps: pricing.commissionBps,
          payment_method: paymentMethod,
          requested_at: requestedAt,
          assigned_at: status === 'expired' ? null : assignedAt,
          arrived_at: isFulfilled ? arrivedAt : null,
          started_at: isFulfilled ? startedAt : null,
          completed_at: isFulfilled ? completedAt : null,
          paid_at: isFulfilled ? completedAt : null,
          cancelled_at: status === 'cancelled' ? arrivedAt : null,
          cancelled_by: status === 'cancelled' ? 'client' : null,
          cancellation_reason: status === 'cancelled' ? 'Changement de programme' : null,
          created_at: requestedAt,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      // Journal des états, exigé au §6 même pour des données de démonstration.
      const timeline: Array<[string, Date]> = [
        ['requested', requestedAt],
        ['searching', new Date(requestedAt.getTime() + 5_000)],
      ];
      if (status !== 'expired') timeline.push(['driver_assigned', assignedAt]);
      if (isFulfilled) {
        timeline.push(
          ['driver_en_route', new Date(assignedAt.getTime() + 20_000)],
          ['driver_arrived', arrivedAt],
          ['in_progress', startedAt],
          ['completed', completedAt],
          ['awaiting_payment', completedAt],
          ['paid', completedAt],
          ['rated', new Date(completedAt.getTime() + 60_000)],
        );
      } else if (status === 'cancelled') {
        timeline.push(['cancelled', arrivedAt]);
      } else {
        timeline.push(['expired', new Date(requestedAt.getTime() + 300_000)]);
      }

      for (let i = 0; i < timeline.length; i += 1) {
        const entry = timeline[i]!;
        await db
          .insertInto('ride_events')
          .values({
            ride_id: ride.id,
            from_status: i > 0 ? (timeline[i - 1]![0] as never) : null,
            to_status: entry[0] as never,
            actor_type: i <= 1 ? (i === 0 ? 'client' : 'system') : 'driver',
            created_at: entry[1],
          })
          .execute();
      }

      if (status !== 'expired') {
        await db
          .insertInto('ride_offers')
          .values({
            ride_id: ride.id,
            driver_id: driverId,
            rank: 0,
            distance_m: Math.round(random() * 3_000),
            eta_seconds: Math.round(120 + random() * 300),
            status: 'accepted',
            expires_at: new Date(requestedAt.getTime() + 20_000),
            responded_at: assignedAt,
            created_at: requestedAt,
          })
          .execute();

        await db
          .updateTable('drivers')
          .set((eb) => ({
            offers_received: eb('offers_received', '+', 1),
            offers_accepted: eb('offers_accepted', '+', 1),
          }))
          .where('id', '=', driverId)
          .execute();
      }

      if (isFulfilled) {
        const payment = await db
          .insertInto('payments')
          .values({
            ride_id: ride.id,
            user_id: userId,
            driver_id: driverId,
            amount: fare.total,
            currency: rule.currency,
            method: paymentMethod,
            status: 'succeeded',
            platform_amount: split.platformAmount,
            driver_amount: split.driverAmount,
            provider: paymentMethod === 'cash' ? 'cash' : 'mock',
            provider_reference: `demo_${ride.id.slice(0, 8)}`,
            captured_at: completedAt,
            created_at: completedAt,
          })
          .returning('id')
          .executeTakeFirstOrThrow();

        // Écritures au grand livre, cohérentes avec le §10.
        const entries: Array<[string, number]> = [['ride_earning', split.driverAmount]];
        if (paymentMethod === 'cash') entries.push(['cash_collected', -fare.total]);

        for (const [type, amount] of entries) {
          const wallet = await db
            .selectFrom('driver_wallets')
            .select('balance')
            .where('driver_id', '=', driverId)
            .executeTakeFirstOrThrow();

          await db
            .insertInto('wallet_transactions')
            .values({
              driver_id: driverId,
              entry_type: type as never,
              amount,
              balance_after: wallet.balance + amount,
              currency: rule.currency,
              ride_id: ride.id,
              payment_id: payment.id,
              created_at: completedAt,
            })
            .execute();

          await db
            .updateTable('driver_wallets')
            .set((eb) => ({
              balance: eb('balance', '+', amount),
              total_earned:
                type === 'ride_earning'
                  ? eb('total_earned', '+', Math.max(0, amount))
                  : eb.ref('total_earned'),
              total_commission:
                type === 'cash_collected'
                  ? eb('total_commission', '+', split.platformAmount)
                  : eb.ref('total_commission'),
            }))
            .where('driver_id', '=', driverId)
            .execute();
        }

        await db
          .insertInto('reviews')
          .values({
            ride_id: ride.id,
            author_type: 'client',
            author_id: userId,
            subject_type: 'driver',
            subject_id: driverId,
            rating: random() < 0.75 ? 5 : random() < 0.6 ? 4 : 3,
            created_at: new Date(completedAt.getTime() + 60_000),
          })
          .execute();

        await db
          .updateTable('drivers')
          .set((eb) => ({ rides_count: eb('rides_count', '+', 1) }))
          .where('id', '=', driverId)
          .execute();

        await db
          .updateTable('users')
          .set((eb) => ({ rides_count: eb('rides_count', '+', 1) }))
          .where('id', '=', userId)
          .execute();
      }

      created += 1;
    }
  }

  // Quelques litiges et demandes de retrait en attente de traitement.
  const recentRides = await db
    .selectFrom('rides')
    .select(['id', 'user_id'])
    .where('status', '=', 'rated')
    .orderBy('created_at', 'desc')
    .limit(3)
    .execute();

  const categories = ['wrong_price', 'lost_item', 'driver_no_show'];
  for (const [index, ride] of recentRides.entries()) {
    await db
      .insertInto('support_tickets')
      .values({
        reference: `TCK-DEMO-${index + 1}`,
        ride_id: ride.id,
        reporter_type: 'client',
        reporter_id: ride.user_id,
        category: categories[index] ?? 'other',
        subject: 'Signalement de démonstration',
        description: 'Ticket généré par le jeu de données de démonstration.',
        status: 'open',
        priority: index === 0 ? 'high' : 'normal',
      })
      .onConflict((oc) => oc.column('reference').doNothing())
      .execute();
  }

  for (const driverId of driverIds.slice(0, 2)) {
    const wallet = await db
      .selectFrom('driver_wallets')
      .select('balance')
      .where('driver_id', '=', driverId)
      .executeTakeFirst();

    if (!wallet || wallet.balance < 2_000) continue;

    await db
      .insertInto('withdrawals')
      .values({
        driver_id: driverId,
        amount: Math.floor(wallet.balance / 2 / 500) * 500,
        method: 'mobile_money',
        destination: '+2250700000000',
        status: 'requested',
      })
      .execute();
  }

  return { rides: created, drivers: driverIds.length, clients: clientIds.length };
}

// Exécution directe : npm run demo
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const env = loadEnv();

  if (env.NODE_ENV === 'production') {
    console.error('Le jeu de démonstration est interdit en production.');
    process.exit(1);
  }

  const pool = createPool({ connectionString: env.DATABASE_URL });
  const db = createDb(pool);

  seed(db, { withDemoData: false })
    .then(() => generateDemoHistory(db, { days: 21, ridesPerDay: 14, drivers: 12, clients: 40 }))
    .then(async (result) => {
      console.log(
        `Historique de démonstration : ${result.rides} courses, ` +
          `${result.drivers} chauffeurs, ${result.clients} clients.`,
      );
      await db.destroy();
      process.exit(0);
    })
    .catch(async (error: Error) => {
      console.error('Échec de la génération :', error.message);
      await db.destroy();
      process.exit(1);
    });
}

export { ABIDJAN };
