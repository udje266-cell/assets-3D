import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ABIDJAN,
  COCODY,
  call,
  createApprovedDriver,
  createTestHarness,
  loginClient,
  resetTransientData,
  type TestHarness,
} from '../helpers/app.js';
import { seed } from '../../src/db/seed.js';

/**
 * Parcours complet d'une course, du §3 au §11, contre une vraie base.
 *
 * Ce test est le garde-fou principal du projet : il exerce l'enchaînement
 * commande → attribution → déroulement → prix → commission → paiement →
 * portefeuille → notation, et vérifie que chaque changement d'état a bien été
 * enregistré côté serveur comme l'exige le §6.
 */
describe('cycle de vie complet d’une course', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetTransientData(harness.db);
    await seed(harness.db, { withDemoData: false });
  });

  it('mène une course de la commande au règlement en espèces', async () => {
    const client = await loginClient(harness, '+2250501010101', {
      firstName: 'Awa',
      lastName: 'Diabaté',
    });
    const driver = await createApprovedDriver(harness, {
      phone: '+2250701010101',
      firstName: 'Kouassi',
      lastName: 'Yao',
      latitude: ABIDJAN.latitude + 0.004,
      longitude: ABIDJAN.longitude + 0.003,
    });

    // --- Estimation avant commande (§3) ---------------------------------
    const estimate = await call(harness, {
      method: 'POST',
      url: '/v1/client/rides/estimate',
      token: client.token,
      payload: { pickup: ABIDJAN, dropoff: COCODY },
    });

    expect(estimate.status).toBe(200);
    expect(estimate.body.options.length).toBeGreaterThan(0);
    expect(estimate.body.distanceMeters).toBeGreaterThan(0);

    const eco = estimate.body.options.find((o: { code: string }) => o.code === 'eco');
    expect(eco.total).toBeGreaterThan(0);

    // --- Commande et attribution (§19) ----------------------------------
    const created = await call(harness, {
      method: 'POST',
      url: '/v1/client/rides',
      token: client.token,
      payload: {
        pickup: { ...ABIDJAN, address: 'Plateau, Abidjan' },
        dropoff: { ...COCODY, address: 'Cocody, Abidjan' },
        vehicleCategoryId: eco.vehicleCategoryId,
        paymentMethod: 'cash',
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.dispatch.status).toBe('offered');
    const rideId: string = created.body.ride.id;
    expect(created.body.ride.reference).toMatch(/^CRS-\d{8}-[A-Z0-9]{6}$/);

    // --- Le chauffeur reçoit et accepte l'offre --------------------------
    const offer = await call(harness, {
      method: 'GET',
      url: '/v1/driver/offers/current',
      token: driver.token,
    });

    expect(offer.body.offer).not.toBeNull();
    expect(offer.body.offer.rideId).toBe(rideId);

    const accepted = await call(harness, {
      method: 'POST',
      url: `/v1/driver/offers/${offer.body.offer.offerId}/accept`,
      token: driver.token,
    });

    expect(accepted.status).toBe(200);
    expect(accepted.body.ride.status).toBe('driver_assigned');

    // --- Déroulement (§6) ------------------------------------------------
    for (const [path, expected] of [
      ['en-route', 'driver_en_route'],
      ['arrived', 'driver_arrived'],
      ['start', 'in_progress'],
    ] as const) {
      const step = await call(harness, {
        method: 'POST',
        url: `/v1/driver/rides/${rideId}/${path}`,
        token: driver.token,
        payload: ABIDJAN,
      });

      expect(step.status, `étape ${path}`).toBe(200);
      expect(step.body.ride.status).toBe(expected);
    }

    // --- Fin de course : prix réel et commission (§7, §8) ----------------
    const completed = await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/complete`,
      token: driver.token,
      payload: { distanceMeters: 6_000, durationSeconds: 900 },
    });

    expect(completed.status).toBe(200);
    expect(completed.body.ride.status).toBe('awaiting_payment');

    // Grille « éco » du jeu de données : 500 + 6 × 250 + 15 × 25 = 2 375,
    // plus 100 de frais de réservation, arrondi au multiple de 5 → 2 475.
    expect(completed.body.fare.total).toBe(2_475);
    expect(completed.body.commission).toBe(495); // 20 %
    expect(completed.body.driverAmount).toBe(1_980);
    expect(completed.body.commission + completed.body.driverAmount).toBe(2_475);
    expect(completed.body.amountDue).toBe(2_475);

    // --- Encaissement en espèces (§9) et portefeuille (§10) --------------
    const settled = await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/collect-cash`,
      token: driver.token,
    });

    expect(settled.status).toBe(200);
    expect(settled.body.status).toBe('succeeded');

    const wallet = await call(harness, {
      method: 'GET',
      url: '/v1/driver/wallet',
      token: driver.token,
    });

    // Le chauffeur a encaissé 2 475 et a droit à 1 980 : il doit 495 à la plateforme.
    expect(wallet.body.wallet.balance).toBe(-495);

    const ledger = await call(harness, {
      method: 'GET',
      url: '/v1/driver/wallet/transactions',
      token: driver.token,
    });

    const types = ledger.body.items.map((t: { entry_type: string }) => t.entry_type).sort();
    expect(types).toEqual(['cash_collected', 'ride_earning']);

    // --- Notation (§11) et état final (§6) -------------------------------
    const review = await call(harness, {
      method: 'POST',
      url: `/v1/client/rides/${rideId}/review`,
      token: client.token,
      payload: { rating: 5, comment: 'Chauffeur ponctuel.' },
    });

    expect(review.status).toBe(200);

    const finalRide = await harness.db
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', rideId)
      .executeTakeFirstOrThrow();

    expect(finalRide.status).toBe('rated');

    const driverProfile = await harness.db
      .selectFrom('drivers')
      .selectAll()
      .where('id', '=', driver.id)
      .executeTakeFirstOrThrow();

    expect(Number(driverProfile.rating_average)).toBe(5);
    expect(driverProfile.rating_count).toBe(1);
    expect(driverProfile.rides_count).toBe(1);
    // Le chauffeur est de nouveau disponible après la course.
    expect(driverProfile.availability).toBe('online');

    // --- Journal des états (§6 : « enregistré côté serveur ») ------------
    const events = await harness.db
      .selectFrom('ride_events')
      .selectAll()
      .where('ride_id', '=', rideId)
      .orderBy('created_at')
      .orderBy('id')
      .execute();

    expect(events.map((e) => e.to_status)).toEqual([
      'requested',
      'searching',
      'driver_assigned',
      'driver_en_route',
      'driver_arrived',
      'in_progress',
      'completed',
      'awaiting_payment',
      'paid',
      'rated',
    ]);
  });

  it('règle une course par un moyen électronique et crédite le chauffeur', async () => {
    const client = await loginClient(harness, '+2250501010102');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250701010102',
      firstName: 'Aya',
      lastName: 'Traoré',
      latitude: ABIDJAN.latitude + 0.002,
      longitude: ABIDJAN.longitude,
    });

    const rideId = await runRideUntilCompletion(harness, client, driver, 'mobile_money');

    const paid = await call(harness, {
      method: 'POST',
      url: `/v1/client/rides/${rideId}/pay`,
      token: client.token,
      payload: { instrument: '+2250501010102' },
    });

    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe('succeeded');

    const wallet = await call(harness, {
      method: 'GET',
      url: '/v1/driver/wallet',
      token: driver.token,
    });

    // Paiement électronique : la plateforme encaisse, le chauffeur est crédité
    // de sa part et sera réglé par retrait.
    expect(wallet.body.wallet.balance).toBe(1_980);
    expect(wallet.body.wallet.totalEarned).toBe(1_980);

    const payment = await harness.db
      .selectFrom('payments')
      .selectAll()
      .where('ride_id', '=', rideId)
      .executeTakeFirstOrThrow();

    expect(payment.status).toBe('succeeded');
    expect(payment.provider_reference).toBeTruthy();
    expect(payment.platform_amount).toBe(495);
    expect(payment.driver_amount).toBe(1_980);
  });

  it('applique un code promotionnel sans pénaliser le chauffeur', async () => {
    const client = await loginClient(harness, '+2250501010103');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250701010103',
      firstName: 'Ibrahim',
      lastName: 'Coulibaly',
      latitude: ABIDJAN.latitude + 0.001,
      longitude: ABIDJAN.longitude,
    });

    const rideId = await runRideUntilCompletion(harness, client, driver, 'cash', 'BIENVENUE');

    const ride = await harness.db
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', rideId)
      .executeTakeFirstOrThrow();

    // 20 % de 2 475 = 495, sous le plafond de 1 000.
    expect(ride.discount_amount).toBe(495);
    expect(ride.final_fare).toBe(2_475);
    // La part du chauffeur est calculée sur le prix brut : la remise est
    // supportée par la plateforme (§8).
    expect(ride.driver_amount).toBe(1_980);
    expect(ride.platform_amount).toBe(495);

    const redemption = await harness.db
      .selectFrom('promotion_redemptions')
      .selectAll()
      .where('ride_id', '=', rideId)
      .executeTakeFirstOrThrow();

    expect(redemption.discount).toBe(495);

    // Le code est à usage unique : la deuxième course n'en bénéficie pas.
    const second = await call(harness, {
      method: 'POST',
      url: '/v1/client/promotions/check',
      token: client.token,
      payload: { code: 'BIENVENUE', fare: 3_000 },
    });

    expect(second.body.eligible).toBe(false);
  });

  it('refuse une transition d’état hors séquence', async () => {
    const client = await loginClient(harness, '+2250501010104');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250701010104',
      firstName: 'Sekou',
      lastName: 'Bamba',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });

    const { rideId } = await orderAndAccept(harness, client, driver, 'cash');

    // Le chauffeur vient d'accepter : il ne peut pas terminer une course qui
    // n'a pas commencé.
    const premature = await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/complete`,
      token: driver.token,
      payload: { distanceMeters: 5_000 },
    });

    expect(premature.status).toBe(409);
    expect(premature.body.error.code).toBe('invalid_transition');

    const ride = await harness.db
      .selectFrom('rides')
      .select('status')
      .where('id', '=', rideId)
      .executeTakeFirstOrThrow();

    // L'état n'a pas bougé et aucun montant n'a été écrit.
    expect(ride.status).toBe('driver_assigned');
  });

  it('empêche un client d’avoir deux courses en cours', async () => {
    const client = await loginClient(harness, '+2250501010105');
    await createApprovedDriver(harness, {
      phone: '+2250701010105',
      firstName: 'Marie',
      lastName: 'Kone',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });

    const category = await harness.db
      .selectFrom('vehicle_categories')
      .select('id')
      .where('code', '=', 'eco')
      .executeTakeFirstOrThrow();

    const payload = {
      pickup: ABIDJAN,
      dropoff: COCODY,
      vehicleCategoryId: category.id,
      paymentMethod: 'cash' as const,
    };

    const first = await call(harness, {
      method: 'POST',
      url: '/v1/client/rides',
      token: client.token,
      payload,
    });
    expect(first.status).toBe(201);

    const second = await call(harness, {
      method: 'POST',
      url: '/v1/client/rides',
      token: client.token,
      payload,
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ride_already_active');
  });

  it('facture des frais d’annulation lorsque le chauffeur est déjà sur place', async () => {
    const client = await loginClient(harness, '+2250501010106');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250701010106',
      firstName: 'Yao',
      lastName: 'N’Guessan',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });

    const { rideId } = await orderAndAccept(harness, client, driver, 'cash');

    await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/en-route`,
      token: driver.token,
    });

    // Annulation avant l'arrivée : gratuite.
    const beforeArrival = await call(harness, {
      method: 'POST',
      url: `/v1/client/rides/${rideId}/cancel`,
      token: client.token,
      payload: { reason: 'Changement de programme' },
    });

    expect(beforeArrival.status).toBe(200);
    expect(beforeArrival.body.cancellationFee).toBe(0);

    // Nouvelle course, annulée cette fois après l'arrivée du chauffeur.
    const encore = await orderAndAccept(harness, client, driver, 'cash');
    await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${encore.rideId}/en-route`,
      token: driver.token,
    });
    await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${encore.rideId}/arrived`,
      token: driver.token,
    });

    const afterArrival = await call(harness, {
      method: 'POST',
      url: `/v1/client/rides/${encore.rideId}/cancel`,
      token: client.token,
      payload: { reason: 'Je n’ai plus besoin de la course' },
    });

    expect(afterArrival.status).toBe(200);
    expect(afterArrival.body.cancellationFee).toBe(500);
  });

  it('propose la course au chauffeur suivant après un refus', async () => {
    const client = await loginClient(harness, '+2250501010107');
    const proche = await createApprovedDriver(harness, {
      phone: '+2250701010107',
      firstName: 'Proche',
      lastName: 'Chauffeur',
      latitude: ABIDJAN.latitude + 0.001,
      longitude: ABIDJAN.longitude,
    });
    const loin = await createApprovedDriver(harness, {
      phone: '+2250701010108',
      firstName: 'Loin',
      lastName: 'Chauffeur',
      latitude: ABIDJAN.latitude + 0.02,
      longitude: ABIDJAN.longitude,
    });

    const category = await harness.db
      .selectFrom('vehicle_categories')
      .select('id')
      .where('code', '=', 'eco')
      .executeTakeFirstOrThrow();

    const created = await call(harness, {
      method: 'POST',
      url: '/v1/client/rides',
      token: client.token,
      payload: {
        pickup: ABIDJAN,
        dropoff: COCODY,
        vehicleCategoryId: category.id,
        paymentMethod: 'cash',
      },
    });

    // Le plus proche reçoit l'offre en premier (§19).
    const firstOffer = await call(harness, {
      method: 'GET',
      url: '/v1/driver/offers/current',
      token: proche.token,
    });
    expect(firstOffer.body.offer).not.toBeNull();

    const rejected = await call(harness, {
      method: 'POST',
      url: `/v1/driver/offers/${firstOffer.body.offer.offerId}/reject`,
      token: proche.token,
      payload: { reason: 'Trop loin' },
    });

    expect(rejected.status).toBe(200);
    expect(rejected.body.reassigned).toBe(true);

    // La course est immédiatement proposée au suivant.
    const secondOffer = await call(harness, {
      method: 'GET',
      url: '/v1/driver/offers/current',
      token: loin.token,
    });

    expect(secondOffer.body.offer).not.toBeNull();
    expect(secondOffer.body.offer.rideId).toBe(created.body.ride.id);

    const offers = await harness.db
      .selectFrom('ride_offers')
      .selectAll()
      .where('ride_id', '=', created.body.ride.id)
      .execute();

    expect(offers).toHaveLength(2);
    expect(offers.filter((o) => o.status === 'rejected')).toHaveLength(1);
  });

  it('interdit à un chauffeur de manipuler la course d’un autre', async () => {
    const client = await loginClient(harness, '+2250501010109');
    const titulaire = await createApprovedDriver(harness, {
      phone: '+2250701010109',
      firstName: 'Titulaire',
      lastName: 'Chauffeur',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });
    const intrus = await createApprovedDriver(harness, {
      phone: '+2250701010110',
      firstName: 'Intrus',
      lastName: 'Chauffeur',
      latitude: ABIDJAN.latitude + 0.03,
      longitude: ABIDJAN.longitude,
    });

    const { rideId } = await orderAndAccept(harness, client, titulaire, 'cash');

    const tentative = await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/en-route`,
      token: intrus.token,
    });

    expect(tentative.status).toBe(409);
    expect(tentative.body.error.code).toBe('not_your_ride');
  });
});

// ---------------------------------------------------------------------------
// Utilitaires de parcours
// ---------------------------------------------------------------------------

async function orderAndAccept(
  harness: TestHarness,
  client: { token: string },
  driver: { token: string },
  paymentMethod: 'cash' | 'mobile_money',
  promotionCode?: string,
): Promise<{ rideId: string; offerId: string }> {
  const category = await harness.db
    .selectFrom('vehicle_categories')
    .select('id')
    .where('code', '=', 'eco')
    .executeTakeFirstOrThrow();

  const created = await call(harness, {
    method: 'POST',
    url: '/v1/client/rides',
    token: client.token,
    payload: {
      pickup: ABIDJAN,
      dropoff: COCODY,
      vehicleCategoryId: category.id,
      paymentMethod,
      ...(promotionCode ? { promotionCode } : {}),
    },
  });

  if (created.status !== 201) {
    throw new Error(`Commande impossible : ${JSON.stringify(created.body)}`);
  }

  const offer = await call(harness, {
    method: 'GET',
    url: '/v1/driver/offers/current',
    token: driver.token,
  });

  if (!offer.body.offer) throw new Error('Aucune offre reçue par le chauffeur.');

  const accepted = await call(harness, {
    method: 'POST',
    url: `/v1/driver/offers/${offer.body.offer.offerId}/accept`,
    token: driver.token,
  });

  if (accepted.status !== 200) {
    throw new Error(`Acceptation impossible : ${JSON.stringify(accepted.body)}`);
  }

  return { rideId: created.body.ride.id, offerId: offer.body.offer.offerId };
}

async function runRideUntilCompletion(
  harness: TestHarness,
  client: { token: string },
  driver: { token: string },
  paymentMethod: 'cash' | 'mobile_money',
  promotionCode?: string,
): Promise<string> {
  const { rideId } = await orderAndAccept(harness, client, driver, paymentMethod, promotionCode);

  for (const path of ['en-route', 'arrived', 'start']) {
    await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/${path}`,
      token: driver.token,
    });
  }

  const completed = await call(harness, {
    method: 'POST',
    url: `/v1/driver/rides/${rideId}/complete`,
    token: driver.token,
    payload: { distanceMeters: 6_000, durationSeconds: 900 },
  });

  if (completed.status !== 200) {
    throw new Error(`Clôture impossible : ${JSON.stringify(completed.body)}`);
  }

  if (paymentMethod === 'cash') {
    const settled = await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/collect-cash`,
      token: driver.token,
    });
    if (settled.status !== 200) {
      throw new Error(`Encaissement impossible : ${JSON.stringify(settled.body)}`);
    }
  }

  return rideId;
}
