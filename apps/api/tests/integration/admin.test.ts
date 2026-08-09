import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../../src/db/seed.js';
import {
  ABIDJAN,
  COCODY,
  call,
  createApprovedDriver,
  createTestHarness,
  loginAdmin,
  loginClient,
  resetTransientData,
  type TestHarness,
} from '../helpers/app.js';

/**
 * Administration (§14), litiges (§15), portefeuille (§10) et indicateurs (§24).
 */
describe('administration de la plateforme', () => {
  let harness: TestHarness;
  let adminToken: string;

  beforeAll(async () => {
    harness = await createTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(async () => {
    await resetTransientData(harness.db);
    await seed(harness.db, { withDemoData: false });
    adminToken = await loginAdmin(harness);
  });

  it('refuse l’accès sans jeton d’administration', async () => {
    const anonyme = await call(harness, { method: 'GET', url: '/v1/admin/dashboard' });
    expect(anonyme.status).toBe(401);

    const client = await loginClient(harness, '+2250502020201');
    const usurpation = await call(harness, {
      method: 'GET',
      url: '/v1/admin/dashboard',
      token: client.token,
    });
    expect(usurpation.status).toBe(403);
  });

  it('valide un chauffeur et lui ouvre un portefeuille', async () => {
    // Inscription d'un chauffeur qui reste en attente.
    const request = await call(harness, {
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: '+2250702020202', accountType: 'driver' },
    });
    const verify = await call(harness, {
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: {
        phone: '+2250702020202',
        accountType: 'driver',
        code: request.body.code,
        firstName: 'Nouveau',
        lastName: 'Chauffeur',
      },
    });

    const driverId: string = verify.body.account.id;
    const driverToken: string = verify.body.accessToken;

    // Tant qu'il n'est pas validé, il ne peut pas se mettre en ligne (§5).
    const refus = await call(harness, {
      method: 'POST',
      url: '/v1/driver/availability',
      token: driverToken,
      payload: { online: true },
    });
    expect(refus.status).toBe(403);

    const approved = await call(harness, {
      method: 'POST',
      url: `/v1/admin/drivers/${driverId}/status`,
      token: adminToken,
      payload: { status: 'approved' },
    });

    expect(approved.status).toBe(200);
    expect(approved.body.driver.status).toBe('approved');

    const wallet = await harness.db
      .selectFrom('driver_wallets')
      .selectAll()
      .where('driver_id', '=', driverId)
      .executeTakeFirst();

    expect(wallet).toBeDefined();
    expect(wallet?.balance).toBe(0);

    // L'action est tracée (§12).
    const audit = await harness.db
      .selectFrom('audit_logs')
      .selectAll()
      .where('action', '=', 'driver.approved')
      .where('entity_id', '=', driverId)
      .executeTakeFirst();

    expect(audit).toBeDefined();
  });

  it('bloque la validation tant que des documents sont en attente d’examen', async () => {
    const request = await call(harness, {
      method: 'POST',
      url: '/v1/auth/otp/request',
      payload: { phone: '+2250702020203', accountType: 'driver' },
    });
    const verify = await call(harness, {
      method: 'POST',
      url: '/v1/auth/otp/verify',
      payload: {
        phone: '+2250702020203',
        accountType: 'driver',
        code: request.body.code,
        firstName: 'Dossier',
        lastName: 'Incomplet',
      },
    });

    await call(harness, {
      method: 'POST',
      url: '/v1/driver/documents',
      token: verify.body.accessToken,
      payload: { docType: 'license', fileUrl: 'https://exemple.test/permis.pdf' },
    });

    const premature = await call(harness, {
      method: 'POST',
      url: `/v1/admin/drivers/${verify.body.account.id}/status`,
      token: adminToken,
      payload: { status: 'approved' },
    });

    expect(premature.status).toBe(422);
    expect(premature.body.error.code).toBe('documents_pending');

    // Après examen du document, la validation passe.
    const document = await harness.db
      .selectFrom('driver_documents')
      .selectAll()
      .where('driver_id', '=', verify.body.account.id)
      .executeTakeFirstOrThrow();

    const reviewed = await call(harness, {
      method: 'POST',
      url: `/v1/admin/documents/${document.id}/review`,
      token: adminToken,
      payload: { status: 'approved' },
    });
    expect(reviewed.status).toBe(200);

    const approved = await call(harness, {
      method: 'POST',
      url: `/v1/admin/drivers/${verify.body.account.id}/status`,
      token: adminToken,
      payload: { status: 'approved' },
    });
    expect(approved.status).toBe(200);
  });

  it('crée une nouvelle grille tarifaire sans réécrire les courses déjà facturées', async () => {
    const category = await harness.db
      .selectFrom('vehicle_categories')
      .select('id')
      .where('code', '=', 'eco')
      .executeTakeFirstOrThrow();

    const client = await loginClient(harness, '+2250502020204');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250702020204',
      firstName: 'Kouadio',
      lastName: 'Brou',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });

    const rideId = await completeOneRide(harness, client, driver);

    const before = await harness.db
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', rideId)
      .executeTakeFirstOrThrow();

    // Doublement du tarif kilométrique.
    const created = await call(harness, {
      method: 'POST',
      url: '/v1/admin/pricing-rules',
      token: adminToken,
      payload: {
        vehicleCategoryId: category.id,
        baseFare: 500,
        perKm: 500,
        perMinute: 25,
        minimumFare: 1_000,
        bookingFee: 100,
        cancellationFee: 500,
        commissionBps: 2_500,
      },
    });

    expect(created.status).toBe(201);

    const after = await harness.db
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', rideId)
      .executeTakeFirstOrThrow();

    // La course déjà facturée est intacte.
    expect(after.final_fare).toBe(before.final_fare);
    expect(after.platform_amount).toBe(before.platform_amount);

    // L'ancienne grille est close, pas supprimée : le montant reste justifiable.
    const rules = await harness.db
      .selectFrom('pricing_rules')
      .selectAll()
      .where('vehicle_category_id', '=', category.id)
      .execute();

    expect(rules).toHaveLength(2);
    expect(rules.filter((r) => r.is_active)).toHaveLength(1);

    // Une nouvelle estimation applique bien le nouveau tarif.
    const estimate = await call(harness, {
      method: 'POST',
      url: '/v1/client/rides/estimate',
      token: client.token,
      payload: { pickup: ABIDJAN, dropoff: COCODY, vehicleCategoryId: category.id },
    });

    expect(estimate.body.options[0].total).toBeGreaterThan(before.final_fare!);
  });

  it('instruit un retrait et restitue le montant en cas de refus', async () => {
    const client = await loginClient(harness, '+2250502020205');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250702020205',
      firstName: 'Retrait',
      lastName: 'Chauffeur',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });

    await completeOneRide(harness, client, driver, 'mobile_money');

    const wallet = await call(harness, {
      method: 'GET',
      url: '/v1/driver/wallet',
      token: driver.token,
    });
    const solde: number = wallet.body.wallet.balance;
    expect(solde).toBeGreaterThan(0);

    const requested = await call(harness, {
      method: 'POST',
      url: '/v1/driver/withdrawals',
      token: driver.token,
      payload: { amount: solde, method: 'mobile_money', destination: '+2250702020205' },
    });

    expect(requested.status).toBe(201);

    // Le solde est débité dès la demande : impossible de l'engager deux fois.
    const apresDemande = await call(harness, {
      method: 'GET',
      url: '/v1/driver/wallet',
      token: driver.token,
    });
    expect(apresDemande.body.wallet.balance).toBe(0);

    const secondeDemande = await call(harness, {
      method: 'POST',
      url: '/v1/driver/withdrawals',
      token: driver.token,
      payload: { amount: solde, method: 'mobile_money', destination: '+2250702020205' },
    });
    expect(secondeDemande.status).toBe(422);
    expect(secondeDemande.body.error.code).toBe('insufficient_balance');

    // Refus par la direction financière : le montant revient au solde.
    const rejected = await call(harness, {
      method: 'POST',
      url: `/v1/admin/withdrawals/${requested.body.withdrawal.id}/status`,
      token: adminToken,
      payload: { status: 'rejected', reason: 'Coordonnées incorrectes' },
    });

    expect(rejected.status).toBe(200);

    const apresRefus = await call(harness, {
      method: 'GET',
      url: '/v1/driver/wallet',
      token: driver.token,
    });
    expect(apresRefus.body.wallet.balance).toBe(solde);
  });

  it('rembourse un paiement et peut l’imputer au chauffeur', async () => {
    const client = await loginClient(harness, '+2250502020206');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250702020206',
      firstName: 'Litige',
      lastName: 'Chauffeur',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });

    const rideId = await completeOneRide(harness, client, driver, 'mobile_money');

    const payment = await harness.db
      .selectFrom('payments')
      .selectAll()
      .where('ride_id', '=', rideId)
      .executeTakeFirstOrThrow();

    const refund = await call(harness, {
      method: 'POST',
      url: `/v1/admin/payments/${payment.id}/refund`,
      token: adminToken,
      payload: { amount: 1_000, reason: 'Trajet non conforme', chargeToDriver: true },
    });

    expect(refund.status).toBe(200);
    expect(refund.body.providerStatus).toBe('succeeded');

    const updated = await harness.db
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', payment.id)
      .executeTakeFirstOrThrow();

    expect(updated.refunded_amount).toBe(1_000);

    const ledger = await harness.db
      .selectFrom('wallet_transactions')
      .selectAll()
      .where('driver_id', '=', driver.id)
      .where('entry_type', '=', 'refund_deduction')
      .executeTakeFirstOrThrow();

    expect(ledger.amount).toBe(-1_000);

    // Un remboursement supérieur au montant encaissé est refusé.
    const excessif = await call(harness, {
      method: 'POST',
      url: `/v1/admin/payments/${payment.id}/refund`,
      token: adminToken,
      payload: { amount: 999_999, reason: 'Test' },
    });

    expect(excessif.status).toBe(422);
  });

  it('traite un litige avec accès au dossier de la course (§15)', async () => {
    const client = await loginClient(harness, '+2250502020207');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250702020207',
      firstName: 'Dossier',
      lastName: 'Chauffeur',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });

    const rideId = await completeOneRide(harness, client, driver);

    const ticket = await call(harness, {
      method: 'POST',
      url: '/v1/client/support/tickets',
      token: client.token,
      payload: {
        rideId,
        category: 'wrong_price',
        subject: 'Prix supérieur à l’estimation',
        description: 'Le montant facturé ne correspond pas à ce qui m’a été annoncé.',
      },
    });

    expect(ticket.status).toBe(201);
    expect(ticket.body.ticket.reference).toMatch(/^TCK-/);

    const detail = await call(harness, {
      method: 'GET',
      url: `/v1/admin/tickets/${ticket.body.ticket.id}`,
      token: adminToken,
    });

    expect(detail.status).toBe(200);
    // Le dossier livre la course et son journal d'événements.
    expect(detail.body.ride.ride.id).toBe(rideId);
    expect(detail.body.ride.events.length).toBeGreaterThan(5);

    await call(harness, {
      method: 'POST',
      url: `/v1/admin/tickets/${ticket.body.ticket.id}/messages`,
      token: adminToken,
      payload: { body: 'Nous vérifions la distance enregistrée.' },
    });

    const resolved = await call(harness, {
      method: 'POST',
      url: `/v1/admin/tickets/${ticket.body.ticket.id}/status`,
      token: adminToken,
      payload: { status: 'resolved', resolution: 'Distance confirmée par la trace GPS.' },
    });

    expect(resolved.status).toBe(200);
    expect(resolved.body.ticket.resolved_at).toBeTruthy();
  });

  it('calcule les indicateurs clés de la période (§24)', async () => {
    const client = await loginClient(harness, '+2250502020208');
    const driver = await createApprovedDriver(harness, {
      phone: '+2250702020208',
      firstName: 'KPI',
      lastName: 'Chauffeur',
      latitude: ABIDJAN.latitude,
      longitude: ABIDJAN.longitude,
    });

    await completeOneRide(harness, client, driver);

    const dashboard = await call(harness, {
      method: 'GET',
      url: '/v1/admin/dashboard',
      token: adminToken,
    });

    expect(dashboard.status).toBe(200);

    const kpis = dashboard.body.kpis;
    expect(kpis.courses.total).toBe(1);
    expect(kpis.courses.honorees).toBe(1);
    expect(kpis.finances.gmv).toBe(2_475);
    expect(kpis.finances.commissions).toBe(495);
    expect(kpis.finances.revenuChauffeurs).toBe(1_980);
    expect(kpis.finances.revenuPlateforme).toBe(495);
    expect(kpis.finances.panierMoyen).toBe(2_475);
    expect(kpis.utilisateurs.clientsActifs).toBe(1);
    expect(kpis.utilisateurs.chauffeursActifs).toBe(1);
    expect(kpis.operations.tauxAcceptation).toBe(100);

    // Les coûts d'acquisition ne sont pas inventés : ils exigent le budget marketing.
    expect(kpis.acquisition.coutAcquisitionClient).toBeNull();

    expect(dashboard.body.instantane.chauffeursEnLigne).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.serie.length).toBeGreaterThan(0);
  });

  it('crée une promotion et la désactive', async () => {
    const created = await call(harness, {
      method: 'POST',
      url: '/v1/admin/promotions',
      token: adminToken,
      payload: {
        code: 'rentree2026',
        label: 'Rentrée 2026',
        type: 'fixed',
        value: 500,
        minFare: 1_000,
        maxPerUser: 2,
      },
    });

    expect(created.status).toBe(201);
    expect(created.body.promotion.code).toBe('RENTREE2026');

    const client = await loginClient(harness, '+2250502020209');
    const check = await call(harness, {
      method: 'POST',
      url: '/v1/client/promotions/check',
      token: client.token,
      payload: { code: 'RENTREE2026', fare: 3_000 },
    });

    expect(check.body.eligible).toBe(true);
    expect(check.body.discount).toBe(500);

    await call(harness, {
      method: 'PATCH',
      url: `/v1/admin/promotions/${created.body.promotion.id}`,
      token: adminToken,
      payload: { isActive: false },
    });

    const apres = await call(harness, {
      method: 'POST',
      url: '/v1/client/promotions/check',
      token: client.token,
      payload: { code: 'RENTREE2026', fare: 3_000 },
    });

    expect(apres.body.eligible).toBe(false);
  });

  it('suspend un client et l’empêche de commander', async () => {
    const client = await loginClient(harness, '+2250502020210');

    await call(harness, {
      method: 'POST',
      url: `/v1/admin/users/${client.id}/suspension`,
      token: adminToken,
      payload: { suspended: true, reason: 'Impayés répétés' },
    });

    const category = await harness.db
      .selectFrom('vehicle_categories')
      .select('id')
      .where('code', '=', 'eco')
      .executeTakeFirstOrThrow();

    const commande = await call(harness, {
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

    expect(commande.status).toBe(422);
    expect(commande.body.error.code).toBe('account_suspended');
  });
});

/** Déroule une course complète et renvoie son identifiant. */
async function completeOneRide(
  harness: TestHarness,
  client: { token: string },
  driver: { token: string },
  paymentMethod: 'cash' | 'mobile_money' = 'cash',
): Promise<string> {
  const category = await harness.db
    .selectFrom('vehicle_categories')
    .select('id')
    .where('code', '=', 'eco')
    .where('is_active', '=', true)
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
    },
  });

  const offer = await call(harness, {
    method: 'GET',
    url: '/v1/driver/offers/current',
    token: driver.token,
  });

  await call(harness, {
    method: 'POST',
    url: `/v1/driver/offers/${offer.body.offer.offerId}/accept`,
    token: driver.token,
  });

  const rideId: string = created.body.ride.id;

  for (const path of ['en-route', 'arrived', 'start']) {
    await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/${path}`,
      token: driver.token,
    });
  }

  await call(harness, {
    method: 'POST',
    url: `/v1/driver/rides/${rideId}/complete`,
    token: driver.token,
    payload: { distanceMeters: 6_000, durationSeconds: 900 },
  });

  if (paymentMethod === 'cash') {
    await call(harness, {
      method: 'POST',
      url: `/v1/driver/rides/${rideId}/collect-cash`,
      token: driver.token,
    });
  } else {
    await call(harness, {
      method: 'POST',
      url: `/v1/client/rides/${rideId}/pay`,
      token: client.token,
      payload: { instrument: '+2250000000000' },
    });
  }

  return rideId;
}
