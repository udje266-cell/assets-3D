import { sql } from 'kysely';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { accountId } from '../plugins/auth.js';
import { computeKpis, dailySeries, liveSnapshot } from '../services/analytics.js';
import { recordAudit } from '../services/audit.js';
import { TEMPLATES } from '../services/notifications.js';
import { cancelRide, getRideDetail } from '../services/rides.js';
import { ensureWallet, postLedgerEntry } from '../services/wallet.js';

/**
 * Interface d'administration — §14 et §15 du cahier des charges.
 *
 * Chaque action modifiant un état sensible est tracée dans `audit_logs` (§12).
 * Les rôles limitent les actions : `viewer` consulte, `support` traite les
 * litiges, `finance` gère paiements et retraits, `operations` valide les
 * chauffeurs et les tarifs, `super_admin` a tous les droits.
 */
export async function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const readOnly = { onRequest: [app.requireAdmin] };
  const operations = { onRequest: [app.requireAdminRole(['operations'])] };
  const finance = { onRequest: [app.requireAdminRole(['finance'])] };
  const support = { onRequest: [app.requireAdminRole(['support', 'operations'])] };

  const pagination = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(25),
    offset: z.coerce.number().int().min(0).default(0),
  });

  const periodQuery = z.object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  });

  function resolvePeriod(query: z.infer<typeof periodQuery>) {
    return {
      from: query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000),
      to: query.to ? new Date(query.to) : new Date(),
    };
  }

  // -------------------------------------------------------------------------
  // Tableau de bord (§14) et indicateurs (§24)
  // -------------------------------------------------------------------------

  app.get('/v1/admin/dashboard', readOnly, async (request) => {
    const period = resolvePeriod(periodQuery.parse(request.query));
    const [snapshot, kpis, series] = await Promise.all([
      liveSnapshot(ctx.db),
      computeKpis(ctx.db, period, ctx.env.CURRENCY),
      dailySeries(ctx.db, period),
    ]);

    return { instantane: snapshot, kpis, serie: series };
  });

  app.get('/v1/admin/kpis', readOnly, async (request) => {
    const period = resolvePeriod(periodQuery.parse(request.query));
    return computeKpis(ctx.db, period, ctx.env.CURRENCY);
  });

  // -------------------------------------------------------------------------
  // Chauffeurs (§14 : validation, suspension, documents, courses, revenus)
  // -------------------------------------------------------------------------

  app.get('/v1/admin/drivers', readOnly, async (request) => {
    const query = pagination
      .extend({
        status: z.enum(['pending', 'approved', 'rejected', 'suspended']).optional(),
        search: z.string().max(80).optional(),
      })
      .parse(request.query);

    let builder = ctx.db.selectFrom('drivers').selectAll().where('deleted_at', 'is', null);

    if (query.status) builder = builder.where('status', '=', query.status);
    if (query.search) {
      const pattern = `%${query.search.toLowerCase()}%`;
      builder = builder.where(
        sql<boolean>`lower(first_name || ' ' || last_name || ' ' || phone) LIKE ${pattern}`,
      );
    }

    const [items, count] = await Promise.all([
      builder.orderBy('created_at', 'desc').limit(query.limit).offset(query.offset).execute(),
      ctx.db
        .selectFrom('drivers')
        .select(({ fn }) => fn.countAll<number>().as('total'))
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow(),
    ]);

    return { items, total: Number(count.total), limit: query.limit, offset: query.offset };
  });

  app.get('/v1/admin/drivers/:id', readOnly, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const driver = await ctx.db
      .selectFrom('drivers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!driver) throw notFound('Chauffeur');

    const [vehicles, documents, wallet, rides, reviews] = await Promise.all([
      ctx.db.selectFrom('vehicles').selectAll().where('driver_id', '=', id).execute(),
      ctx.db.selectFrom('driver_documents').selectAll().where('driver_id', '=', id).execute(),
      ctx.db.selectFrom('driver_wallets').selectAll().where('driver_id', '=', id).executeTakeFirst(),
      ctx.db
        .selectFrom('rides')
        .selectAll()
        .where('driver_id', '=', id)
        .orderBy('created_at', 'desc')
        .limit(20)
        .execute(),
      ctx.db
        .selectFrom('reviews')
        .selectAll()
        .where('subject_type', '=', 'driver')
        .where('subject_id', '=', id)
        .orderBy('created_at', 'desc')
        .limit(20)
        .execute(),
    ]);

    return { driver, vehicles, documents, wallet: wallet ?? null, rides, reviews };
  });

  app.post('/v1/admin/drivers/:id/status', operations, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['approved', 'rejected', 'suspended', 'pending']),
        reason: z.string().max(500).optional(),
      })
      .parse(request.body);

    const driver = await ctx.db
      .selectFrom('drivers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!driver) throw notFound('Chauffeur');

    // Un chauffeur en course ne peut pas être suspendu sans clore la course :
    // le client resterait sans information.
    if (body.status !== 'approved' && driver.availability === 'on_ride') {
      throw conflict(
        'driver_on_ride',
        'Ce chauffeur est en course. Clôturez ou réattribuez la course avant de modifier son statut.',
      );
    }

    if (body.status === 'approved' && !body.reason && driver.status === 'pending') {
      // Validation : les documents obligatoires doivent avoir été examinés.
      const pendingDocs = await ctx.db
        .selectFrom('driver_documents')
        .select(({ fn }) => fn.countAll<number>().as('total'))
        .where('driver_id', '=', id)
        .where('status', '=', 'pending')
        .executeTakeFirstOrThrow();

      if (Number(pendingDocs.total) > 0) {
        throw unprocessable(
          'documents_pending',
          'Des documents de ce chauffeur sont encore en attente d’examen.',
        );
      }
    }

    const updated = await ctx.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable('drivers')
        .set({
          status: body.status,
          status_reason: body.reason ?? null,
          ...(body.status === 'approved'
            ? { approved_at: new Date(), approved_by: accountId(request) }
            : {}),
          ...(body.status !== 'approved' ? { availability: 'offline' as const } : {}),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (body.status === 'approved') {
        await ensureWallet(trx, id, ctx.env.CURRENCY);
      }

      return result;
    });

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: `driver.${body.status}`,
      entityType: 'driver',
      entityId: id,
      before: { status: driver.status },
      after: { status: body.status, reason: body.reason ?? null },
      ip: request.ip,
    });

    if (body.status !== 'approved' && body.reason) {
      const message = TEMPLATES.account_warning({ reason: body.reason });
      await ctx.notifications.notify(ctx.db, {
        recipientType: 'driver',
        recipientId: id,
        template: 'account_warning',
        title: message.title,
        body: message.body,
      });
    }

    return { driver: updated };
  });

  app.post('/v1/admin/documents/:id/review', operations, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['approved', 'rejected', 'expired']),
        note: z.string().max(500).optional(),
      })
      .parse(request.body);

    const document = await ctx.db
      .updateTable('driver_documents')
      .set({
        status: body.status,
        review_note: body.note ?? null,
        reviewed_by: accountId(request),
        reviewed_at: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!document) throw notFound('Document');

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: `document.${body.status}`,
      entityType: 'driver_document',
      entityId: id,
      after: { status: body.status },
      ip: request.ip,
    });

    return { document };
  });

  // -------------------------------------------------------------------------
  // Clients (§14)
  // -------------------------------------------------------------------------

  app.get('/v1/admin/users', readOnly, async (request) => {
    const query = pagination.extend({ search: z.string().max(80).optional() }).parse(request.query);

    let builder = ctx.db.selectFrom('users').selectAll().where('deleted_at', 'is', null);

    if (query.search) {
      const pattern = `%${query.search.toLowerCase()}%`;
      builder = builder.where(
        sql<boolean>`lower(coalesce(first_name,'') || ' ' || coalesce(last_name,'') || ' ' || phone) LIKE ${pattern}`,
      );
    }

    const items = await builder
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    return { items, limit: query.limit, offset: query.offset };
  });

  app.post('/v1/admin/users/:id/suspension', support, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ suspended: z.boolean(), reason: z.string().max(500).optional() })
      .parse(request.body);

    const user = await ctx.db
      .updateTable('users')
      .set({
        suspended_at: body.suspended ? new Date() : null,
        suspension_reason: body.suspended ? (body.reason ?? null) : null,
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!user) throw notFound('Client');

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: body.suspended ? 'user.suspend' : 'user.restore',
      entityType: 'user',
      entityId: id,
      after: { reason: body.reason ?? null },
      ip: request.ip,
    });

    return { user };
  });

  // -------------------------------------------------------------------------
  // Courses (§14)
  // -------------------------------------------------------------------------

  app.get('/v1/admin/rides', readOnly, async (request) => {
    const query = pagination
      .extend({
        status: z.string().optional(),
        reference: z.string().max(40).optional(),
        driverId: z.string().uuid().optional(),
        userId: z.string().uuid().optional(),
      })
      .parse(request.query);

    let builder = ctx.db.selectFrom('rides').selectAll();

    if (query.status) builder = builder.where('status', '=', query.status as never);
    if (query.reference) builder = builder.where('reference', '=', query.reference.toUpperCase());
    if (query.driverId) builder = builder.where('driver_id', '=', query.driverId);
    if (query.userId) builder = builder.where('user_id', '=', query.userId);

    const items = await builder
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    return { items, limit: query.limit, offset: query.offset };
  });

  app.get('/v1/admin/rides/:id', readOnly, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const detail = await getRideDetail(ctx.db, id);

    const trace = await ctx.db
      .selectFrom('ride_locations')
      .select(['latitude', 'longitude', 'recorded_at'])
      .where('ride_id', '=', id)
      .orderBy('recorded_at')
      .execute();

    const offers = await ctx.db
      .selectFrom('ride_offers')
      .selectAll()
      .where('ride_id', '=', id)
      .orderBy('created_at')
      .execute();

    return { ...detail, trace, offers };
  });

  app.post('/v1/admin/rides/:id/cancel', support, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(255) }).parse(request.body);

    const ride = await cancelRide(ctx, {
      rideId: id,
      actorType: 'admin',
      actorId: accountId(request),
      reason: body.reason,
    });

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: 'ride.cancel',
      entityType: 'ride',
      entityId: id,
      after: { reason: body.reason },
      ip: request.ip,
    });

    return { ride };
  });

  // -------------------------------------------------------------------------
  // Tarification (§7) — configurable sans mise à jour applicative
  // -------------------------------------------------------------------------

  app.get('/v1/admin/vehicle-categories', readOnly, async () => {
    const items = await ctx.db
      .selectFrom('vehicle_categories')
      .selectAll()
      .orderBy('sort_order')
      .execute();
    return { items };
  });

  app.post('/v1/admin/vehicle-categories', operations, async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(2).max(30),
        label: z.string().min(2).max(60),
        description: z.string().max(255).optional(),
        seats: z.number().int().min(1).max(9).default(4),
        sortOrder: z.number().int().default(0),
      })
      .parse(request.body);

    const category = await ctx.db
      .insertInto('vehicle_categories')
      .values({
        code: body.code.toLowerCase(),
        label: body.label,
        description: body.description ?? null,
        seats: body.seats,
        sort_order: body.sortOrder,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return reply.status(201).send({ category });
  });

  app.get('/v1/admin/pricing-rules', readOnly, async () => {
    const items = await ctx.db
      .selectFrom('pricing_rules')
      .innerJoin('vehicle_categories', 'vehicle_categories.id', 'pricing_rules.vehicle_category_id')
      .selectAll('pricing_rules')
      .select(['vehicle_categories.label as category_label', 'vehicle_categories.code as category_code'])
      .orderBy('vehicle_categories.sort_order')
      .orderBy('pricing_rules.effective_from', 'desc')
      .execute();

    return { items };
  });

  const pricingBody = z.object({
    vehicleCategoryId: z.string().uuid(),
    zoneCode: z.string().max(40).default('default'),
    baseFare: z.number().int().min(0),
    perKm: z.number().int().min(0),
    perMinute: z.number().int().min(0),
    minimumFare: z.number().int().min(0),
    bookingFee: z.number().int().min(0).default(0),
    cancellationFee: z.number().int().min(0).default(0),
    surgeBps: z.number().int().min(10_000).max(50_000).default(10_000),
    commissionBps: z.number().int().min(0).max(10_000),
    roundToNearest: z.number().int().min(1).max(1000).default(5),
    currency: z.string().length(3).default('XOF'),
  });

  app.post('/v1/admin/pricing-rules', operations, async (request, reply) => {
    const body = pricingBody.parse(request.body);

    // Nouvelle grille : l'ancienne est close à l'instant présent plutôt que
    // supprimée, afin que toute course déjà facturée reste justifiable (§15).
    const rule = await ctx.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('pricing_rules')
        .set({ effective_to: new Date(), is_active: false })
        .where('vehicle_category_id', '=', body.vehicleCategoryId)
        .where('zone_code', '=', body.zoneCode)
        .where('is_active', '=', true)
        .where('effective_to', 'is', null)
        .execute();

      return trx
        .insertInto('pricing_rules')
        .values({
          vehicle_category_id: body.vehicleCategoryId,
          zone_code: body.zoneCode,
          base_fare: body.baseFare,
          per_km: body.perKm,
          per_minute: body.perMinute,
          minimum_fare: body.minimumFare,
          booking_fee: body.bookingFee,
          cancellation_fee: body.cancellationFee,
          surge_bps: body.surgeBps,
          commission_bps: body.commissionBps,
          round_to_nearest: body.roundToNearest,
          currency: body.currency,
          effective_from: new Date(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: 'pricing.create',
      entityType: 'pricing_rule',
      entityId: rule.id,
      after: body as unknown as Record<string, unknown>,
      ip: request.ip,
    });

    return reply.status(201).send({ rule });
  });

  // -------------------------------------------------------------------------
  // Promotions (§13)
  // -------------------------------------------------------------------------

  app.get('/v1/admin/promotions', readOnly, async () => {
    const items = await ctx.db
      .selectFrom('promotions')
      .selectAll()
      .orderBy('created_at', 'desc')
      .execute();
    return { items };
  });

  app.post('/v1/admin/promotions', operations, async (request, reply) => {
    const body = z
      .object({
        code: z.string().min(3).max(40),
        label: z.string().min(3).max(120),
        description: z.string().max(500).optional(),
        type: z.enum(['percentage', 'fixed']),
        value: z.number().int().positive(),
        maxDiscount: z.number().int().positive().optional(),
        minFare: z.number().int().min(0).default(0),
        maxRedemptions: z.number().int().positive().optional(),
        maxPerUser: z.number().int().positive().default(1),
        firstRideOnly: z.boolean().default(false),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
      })
      .parse(request.body);

    if (body.type === 'percentage' && body.value > 10_000) {
      throw unprocessable('invalid_value', 'Un pourcentage ne peut pas dépasser 100 % (10000 bps).');
    }

    const promotion = await ctx.db
      .insertInto('promotions')
      .values({
        code: body.code.toUpperCase(),
        label: body.label,
        description: body.description ?? null,
        type: body.type,
        value: body.value,
        max_discount: body.maxDiscount ?? null,
        min_fare: body.minFare,
        max_redemptions: body.maxRedemptions ?? null,
        max_per_user: body.maxPerUser,
        first_ride_only: body.firstRideOnly,
        starts_at: body.startsAt ? new Date(body.startsAt) : new Date(),
        ends_at: body.endsAt ? new Date(body.endsAt) : null,
        created_by: accountId(request),
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: 'promotion.create',
      entityType: 'promotion',
      entityId: promotion.id,
      after: { code: promotion.code },
      ip: request.ip,
    });

    return reply.status(201).send({ promotion });
  });

  app.patch('/v1/admin/promotions/:id', operations, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        isActive: z.boolean().optional(),
        endsAt: z.string().datetime().nullable().optional(),
        maxRedemptions: z.number().int().positive().nullable().optional(),
      })
      .parse(request.body);

    const promotion = await ctx.db
      .updateTable('promotions')
      .set({
        ...(body.isActive !== undefined ? { is_active: body.isActive } : {}),
        ...(body.endsAt !== undefined ? { ends_at: body.endsAt ? new Date(body.endsAt) : null } : {}),
        ...(body.maxRedemptions !== undefined ? { max_redemptions: body.maxRedemptions } : {}),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!promotion) throw notFound('Promotion');
    return { promotion };
  });

  // -------------------------------------------------------------------------
  // Paiements, remboursements et retraits (§9, §10, §15)
  // -------------------------------------------------------------------------

  app.get('/v1/admin/payments', readOnly, async (request) => {
    const query = pagination
      .extend({ status: z.string().optional(), method: z.string().optional() })
      .parse(request.query);

    let builder = ctx.db.selectFrom('payments').selectAll();
    if (query.status) builder = builder.where('status', '=', query.status as never);
    if (query.method) builder = builder.where('method', '=', query.method as never);

    const items = await builder
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    return { items };
  });

  app.post('/v1/admin/payments/:id/refund', finance, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        amount: z.number().int().positive(),
        reason: z.string().min(3).max(500),
        /** Impute le remboursement au chauffeur lorsqu'il en est la cause. */
        chargeToDriver: z.boolean().default(false),
      })
      .parse(request.body);

    const payment = await ctx.db
      .selectFrom('payments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!payment) throw notFound('Paiement');
    if (payment.status !== 'succeeded') {
      throw conflict('payment_not_refundable', 'Seul un paiement abouti peut être remboursé.');
    }
    if (body.amount + payment.refunded_amount > payment.amount) {
      throw unprocessable(
        'amount_exceeds_payment',
        'Le remboursement dépasse le montant encaissé.',
      );
    }

    const provider = ctx.payments.resolve(payment.method);
    const result = await provider.refund({
      providerReference: payment.provider_reference ?? '',
      amount: body.amount,
      currency: payment.currency,
      reason: body.reason,
    });

    const refund = await ctx.db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('refunds')
        .values({
          payment_id: payment.id,
          ride_id: payment.ride_id,
          amount: body.amount,
          reason: body.reason,
          status: result.status === 'succeeded' ? 'refunded' : 'pending',
          issued_by: accountId(request),
          provider_reference: result.providerReference,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      if (result.status === 'succeeded') {
        const totalRefunded = payment.refunded_amount + body.amount;
        await trx
          .updateTable('payments')
          .set({
            refunded_amount: totalRefunded,
            status: totalRefunded >= payment.amount ? 'refunded' : payment.status,
          })
          .where('id', '=', payment.id)
          .execute();

        if (body.chargeToDriver && payment.driver_id) {
          await postLedgerEntry(trx, {
            driverId: payment.driver_id,
            entryType: 'refund_deduction',
            amount: -body.amount,
            rideId: payment.ride_id,
            paymentId: payment.id,
            description: `Remboursement client : ${body.reason}`,
            createdBy: accountId(request),
          });
        }
      }

      return created;
    });

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: 'payment.refund',
      entityType: 'payment',
      entityId: payment.id,
      after: { amount: body.amount, reason: body.reason, statut: result.status },
      ip: request.ip,
    });

    return { refund, providerStatus: result.status, failureReason: result.failureReason };
  });

  app.get('/v1/admin/withdrawals', readOnly, async (request) => {
    const query = pagination.extend({ status: z.string().optional() }).parse(request.query);

    let builder = ctx.db
      .selectFrom('withdrawals')
      .innerJoin('drivers', 'drivers.id', 'withdrawals.driver_id')
      .selectAll('withdrawals')
      .select(['drivers.first_name', 'drivers.last_name', 'drivers.phone']);

    if (query.status) builder = builder.where('withdrawals.status', '=', query.status as never);

    const items = await builder
      .orderBy('withdrawals.created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    return { items };
  });

  app.post('/v1/admin/withdrawals/:id/status', finance, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['approved', 'processing', 'paid', 'rejected', 'failed']),
        reference: z.string().max(120).optional(),
        reason: z.string().max(500).optional(),
      })
      .parse(request.body);

    const withdrawal = await ctx.db.transaction().execute(async (trx) => {
      const current = await trx
        .selectFrom('withdrawals')
        .selectAll()
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();

      if (!current) throw notFound('Retrait');
      if (['paid', 'rejected', 'failed'].includes(current.status)) {
        throw conflict('withdrawal_closed', 'Ce retrait est déjà clôturé.');
      }

      const updated = await trx
        .updateTable('withdrawals')
        .set({
          status: body.status,
          provider_reference: body.reference ?? current.provider_reference,
          failure_reason: body.reason ?? null,
          reviewed_by: accountId(request),
          reviewed_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      // Un retrait refusé ou échoué restitue le montant débité à la demande.
      if (body.status === 'rejected' || body.status === 'failed') {
        await postLedgerEntry(trx, {
          driverId: current.driver_id,
          entryType: 'withdrawal_reversal',
          amount: current.amount,
          withdrawalId: current.id,
          description: `Retrait ${body.status === 'rejected' ? 'refusé' : 'échoué'} : ${body.reason ?? 'sans motif'}`,
          createdBy: accountId(request),
        });
      }

      return updated;
    });

    if (body.status === 'paid') {
      const { formatAmount } = await import('../domain/money.js');
      const message = TEMPLATES.withdrawal_paid({
        amount: formatAmount(withdrawal.amount, withdrawal.currency),
      });
      await ctx.notifications.notify(ctx.db, {
        recipientType: 'driver',
        recipientId: withdrawal.driver_id,
        template: 'withdrawal_paid',
        title: message.title,
        body: message.body,
      });
    }

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: `withdrawal.${body.status}`,
      entityType: 'withdrawal',
      entityId: id,
      after: { status: body.status, reference: body.reference ?? null },
      ip: request.ip,
    });

    return { withdrawal };
  });

  app.post('/v1/admin/drivers/:id/wallet-adjustment', finance, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        amount: z.number().int().refine((v) => v !== 0, 'Le montant ne peut pas être nul.'),
        reason: z.string().min(3).max(500),
      })
      .parse(request.body);

    const result = await ctx.db.transaction().execute((trx) =>
      postLedgerEntry(trx, {
        driverId: id,
        entryType: body.amount > 0 ? 'bonus' : 'adjustment',
        amount: body.amount,
        description: body.reason,
        createdBy: accountId(request),
        currency: ctx.env.CURRENCY,
      }),
    );

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: 'wallet.adjustment',
      entityType: 'driver',
      entityId: id,
      after: { montant: body.amount, motif: body.reason },
      ip: request.ip,
    });

    return result;
  });

  // -------------------------------------------------------------------------
  // Litiges (§15)
  // -------------------------------------------------------------------------

  app.get('/v1/admin/tickets', readOnly, async (request) => {
    const query = pagination
      .extend({ status: z.string().optional(), category: z.string().optional() })
      .parse(request.query);

    let builder = ctx.db.selectFrom('support_tickets').selectAll();
    if (query.status) builder = builder.where('status', '=', query.status as never);
    if (query.category) builder = builder.where('category', '=', query.category);

    const items = await builder
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    return { items };
  });

  app.get('/v1/admin/tickets/:id', readOnly, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const ticket = await ctx.db
      .selectFrom('support_tickets')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!ticket) throw notFound('Ticket');

    const messages = await ctx.db
      .selectFrom('support_ticket_messages')
      .selectAll()
      .where('ticket_id', '=', id)
      .orderBy('created_at')
      .execute();

    // Le §15 exige de pouvoir « consulter les informations de la course et des
    // événements associés » : le dossier est livré complet avec le ticket.
    const ride = ticket.ride_id ? await getRideDetail(ctx.db, ticket.ride_id) : null;

    return { ticket, messages, ride };
  });

  app.post('/v1/admin/tickets/:id/messages', support, async (request, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({ body: z.string().min(1).max(4000), internal: z.boolean().default(false) })
      .parse(request.body);

    const message = await ctx.db
      .insertInto('support_ticket_messages')
      .values({
        ticket_id: id,
        author_type: 'admin',
        author_id: accountId(request),
        body: body.body,
        is_internal: body.internal,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    await ctx.db
      .updateTable('support_tickets')
      .set({ status: 'in_progress', assigned_to: accountId(request) })
      .where('id', '=', id)
      .where('status', '=', 'open')
      .execute();

    return reply.status(201).send({ message });
  });

  app.post('/v1/admin/tickets/:id/status', support, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        status: z.enum(['open', 'in_progress', 'waiting_user', 'resolved', 'closed']),
        resolution: z.string().max(2000).optional(),
        priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      })
      .parse(request.body);

    const ticket = await ctx.db
      .updateTable('support_tickets')
      .set({
        status: body.status,
        ...(body.priority ? { priority: body.priority } : {}),
        ...(body.resolution ? { resolution: body.resolution } : {}),
        ...(body.status === 'resolved' || body.status === 'closed'
          ? { resolved_at: new Date() }
          : {}),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();

    if (!ticket) throw notFound('Ticket');

    await recordAudit(ctx.db, {
      actorType: 'admin',
      actorId: accountId(request),
      action: `ticket.${body.status}`,
      entityType: 'support_ticket',
      entityId: id,
      after: { status: body.status },
      ip: request.ip,
    });

    return { ticket };
  });

  // -------------------------------------------------------------------------
  // Journal d'audit (§12)
  // -------------------------------------------------------------------------

  app.get('/v1/admin/audit-logs', { onRequest: [app.requireAdminRole([])] }, async (request) => {
    const query = pagination
      .extend({ entityType: z.string().optional(), action: z.string().optional() })
      .parse(request.query);

    let builder = ctx.db.selectFrom('audit_logs').selectAll();
    if (query.entityType) builder = builder.where('entity_type', '=', query.entityType);
    if (query.action) builder = builder.where('action', '=', query.action);

    const items = await builder
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    return { items };
  });
}
