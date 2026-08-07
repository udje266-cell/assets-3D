import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { generateTicketReference } from '../lib/identifiers.js';
import { dispatchRide } from '../services/dispatch.js';
import {
  cancelRide,
  estimateRide,
  getRideDetail,
  requestRide,
  settleRide,
  transitionRide,
} from '../services/rides.js';
import { submitReview } from '../services/reviews.js';
import { accountId } from '../plugins/auth.js';

const coordinates = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  address: z.string().max(255).optional(),
});

/** Application client — §3 du cahier des charges. */
export async function registerClientRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const auth = { onRequest: [app.requireClient] };

  app.get('/v1/client/me', auth, async (request) => {
    const user = await ctx.db
      .selectFrom('users')
      .selectAll()
      .where('id', '=', accountId(request))
      .executeTakeFirst();

    if (!user) throw notFound('Client');

    return {
      id: user.id,
      phone: user.phone,
      firstName: user.first_name,
      lastName: user.last_name,
      email: user.email,
      rating: Number(user.rating_average),
      ridesCount: user.rides_count,
      suspended: user.suspended_at !== null,
      createdAt: user.created_at,
    };
  });

  app.patch('/v1/client/me', auth, async (request) => {
    const body = z
      .object({
        firstName: z.string().min(1).max(80).optional(),
        lastName: z.string().min(1).max(80).optional(),
        email: z.string().email().nullable().optional(),
        pushToken: z.string().max(255).nullable().optional(),
        locale: z.string().min(2).max(8).optional(),
      })
      .parse(request.body);

    await ctx.db
      .updateTable('users')
      .set({
        ...(body.firstName !== undefined ? { first_name: body.firstName } : {}),
        ...(body.lastName !== undefined ? { last_name: body.lastName } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.pushToken !== undefined ? { push_token: body.pushToken } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
      })
      .where('id', '=', accountId(request))
      .execute();

    return { ok: true };
  });

  /** Catégories disponibles à la commande. */
  app.get('/v1/client/vehicle-categories', auth, async () => {
    const categories = await ctx.db
      .selectFrom('vehicle_categories')
      .selectAll()
      .where('is_active', '=', true)
      .orderBy('sort_order')
      .execute();

    return categories.map((c) => ({
      id: c.id,
      code: c.code,
      label: c.label,
      description: c.description,
      seats: c.seats,
    }));
  });

  /** Estimation avant commande (§3). */
  app.post('/v1/client/rides/estimate', auth, async (request) => {
    const body = z
      .object({
        pickup: coordinates,
        dropoff: coordinates,
        vehicleCategoryId: z.string().uuid().optional(),
      })
      .parse(request.body);

    const estimates = await estimateRide(ctx, {
      pickup: body.pickup,
      dropoff: body.dropoff,
      ...(body.vehicleCategoryId ? { vehicleCategoryId: body.vehicleCategoryId } : {}),
    });

    return {
      distanceMeters: estimates[0]?.distanceMeters ?? 0,
      durationSeconds: estimates[0]?.durationSeconds ?? 0,
      options: estimates.map((estimate) => ({
        vehicleCategoryId: estimate.vehicleCategoryId,
        code: estimate.vehicleCategoryCode,
        label: estimate.vehicleCategoryLabel,
        currency: estimate.fare.currency,
        total: estimate.fare.total,
        detail: estimate.fare,
      })),
    };
  });

  /** Commande d'une course (§3 : départ → destination → catégorie → confirmation). */
  app.post('/v1/client/rides', auth, async (request, reply) => {
    const body = z
      .object({
        pickup: coordinates,
        dropoff: coordinates,
        vehicleCategoryId: z.string().uuid(),
        paymentMethod: z.enum(['cash', 'mobile_money', 'card', 'wallet']),
        promotionCode: z.string().max(40).optional(),
      })
      .parse(request.body);

    const ride = await requestRide(ctx, {
      userId: accountId(request),
      pickup: body.pickup,
      dropoff: body.dropoff,
      vehicleCategoryId: body.vehicleCategoryId,
      paymentMethod: body.paymentMethod,
      promotionCode: body.promotionCode ?? null,
    });

    // La recherche de chauffeur démarre immédiatement (§19).
    const dispatch = await dispatchRide(ctx, ride.id);

    return reply.status(201).send({
      ride: serializeRide(ride),
      dispatch: {
        status: dispatch.status,
        candidats: dispatch.candidatesCount,
      },
    });
  });

  app.get('/v1/client/rides', auth, async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
        status: z.string().optional(),
      })
      .parse(request.query);

    let builder = ctx.db
      .selectFrom('rides')
      .selectAll()
      .where('user_id', '=', accountId(request));

    if (query.status) {
      builder = builder.where('status', '=', query.status as never);
    }

    const rides = await builder
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    return { items: rides.map(serializeRide), limit: query.limit, offset: query.offset };
  });

  app.get('/v1/client/rides/:id', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const detail = await getRideDetail(ctx.db, id);

    if (detail.ride.user_id !== accountId(request)) throw forbidden();

    return {
      ride: serializeRide(detail.ride),
      driver: detail.driver
        ? {
            firstName: detail.driver.first_name,
            lastName: detail.driver.last_name,
            phone: detail.driver.phone,
            rating: Number(detail.driver.rating_average),
          }
        : null,
      vehicle: detail.vehicle,
      events: detail.events.map((e) => ({
        status: e.to_status,
        at: e.created_at,
        actor: e.actor_type,
      })),
      payments: detail.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        status: p.status,
        reference: p.provider_reference,
      })),
    };
  });

  /** Suivi temps réel du chauffeur (§4) — complément REST du canal WebSocket. */
  app.get('/v1/client/rides/:id/tracking', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const ride = await ctx.db
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!ride) throw notFound('Course');
    if (ride.user_id !== accountId(request)) throw forbidden();
    if (!ride.driver_id) return { status: ride.status, position: null };

    const position = await ctx.db
      .selectFrom('driver_locations')
      .selectAll()
      .where('driver_id', '=', ride.driver_id)
      .executeTakeFirst();

    return {
      status: ride.status,
      position: position
        ? {
            latitude: position.latitude,
            longitude: position.longitude,
            heading: position.heading,
            recordedAt: position.recorded_at,
          }
        : null,
    };
  });

  app.post('/v1/client/rides/:id/cancel', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(255) }).parse(request.body ?? {});

    const ride = await ctx.db
      .selectFrom('rides')
      .select(['user_id'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!ride) throw notFound('Course');
    if (ride.user_id !== accountId(request)) throw forbidden();

    const cancelled = await cancelRide(ctx, {
      rideId: id,
      actorType: 'client',
      actorId: accountId(request),
      reason: body.reason,
    });

    return {
      ride: serializeRide(cancelled),
      cancellationFee: cancelled.cancellation_fee,
    };
  });

  /** Règlement d'une course par un moyen électronique (§9). */
  app.post('/v1/client/rides/:id/pay', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ instrument: z.string().max(120).optional() }).parse(request.body ?? {});

    const ride = await ctx.db
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!ride) throw notFound('Course');
    if (ride.user_id !== accountId(request)) throw forbidden();
    if (ride.payment_method === 'cash') {
      throw conflict(
        'cash_payment',
        'Cette course se règle en espèces auprès du chauffeur.',
      );
    }

    const result = await settleRide(ctx, {
      rideId: id,
      actorType: 'client',
      actorId: accountId(request),
      instrument: body.instrument ?? null,
    });

    return {
      status: result.status,
      amount: result.amount,
      paymentId: result.paymentId,
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
    };
  });

  /** Évaluation du chauffeur (§11) — dernière étape du cycle de vie (§6). */
  app.post('/v1/client/rides/:id/review', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        rating: z.number().int().min(1).max(5),
        comment: z.string().max(1000).optional(),
        tags: z.array(z.string().max(40)).max(10).optional(),
      })
      .parse(request.body);

    const review = await submitReview(ctx, {
      rideId: id,
      authorType: 'client',
      authorId: accountId(request),
      rating: body.rating,
      comment: body.comment ?? null,
      tags: body.tags ?? [],
    });

    // La course passe à « évaluée », état final du §6.
    const ride = await ctx.db
      .selectFrom('rides')
      .select('status')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

    if (ride.status === 'paid') {
      await transitionRide(ctx, {
        rideId: id,
        to: 'rated',
        actorType: 'client',
        actorId: accountId(request),
        context: { note: body.rating },
      });
    }

    return { review };
  });

  /** Vérification d'un code promotionnel avant commande (§13). */
  app.post('/v1/client/promotions/check', auth, async (request) => {
    const body = z
      .object({ code: z.string().min(1).max(40), fare: z.number().int().min(0) })
      .parse(request.body);

    const { evaluatePromotion, toPromotionRules, computeDiscount } = await import(
      '../domain/promotions.js'
    );

    const promotion = await ctx.db
      .selectFrom('promotions')
      .selectAll()
      .where('code', '=', body.code.toUpperCase())
      .executeTakeFirst();

    if (!promotion) throw notFound('Code promotionnel');

    const redemptions = await ctx.db
      .selectFrom('promotion_redemptions')
      .select(({ fn }) => fn.countAll<number>().as('total'))
      .where('promotion_id', '=', promotion.id)
      .where('user_id', '=', accountId(request))
      .executeTakeFirstOrThrow();

    const user = await ctx.db
      .selectFrom('users')
      .select('rides_count')
      .where('id', '=', accountId(request))
      .executeTakeFirstOrThrow();

    const rules = toPromotionRules(promotion);
    const evaluation = evaluatePromotion(rules, {
      fare: body.fare,
      userRedemptions: Number(redemptions.total),
      userRidesCount: user.rides_count,
      now: new Date(),
    });

    return evaluation.eligible
      ? {
          eligible: true,
          code: promotion.code,
          label: promotion.label,
          discount: computeDiscount(rules, body.fare),
        }
      : { eligible: false, reason: evaluation.reason, code: evaluation.code };
  });

  /** Signalement et litiges (§11, §15). */
  app.post('/v1/client/support/tickets', auth, async (request, reply) => {
    const body = z
      .object({
        rideId: z.string().uuid().optional(),
        category: z.enum([
          'driver_no_show',
          'wrong_price',
          'payment',
          'lost_item',
          'incident',
          'vehicle',
          'other',
        ]),
        subject: z.string().min(3).max(160),
        description: z.string().min(3).max(4000),
      })
      .parse(request.body);

    if (body.rideId) {
      const ride = await ctx.db
        .selectFrom('rides')
        .select('user_id')
        .where('id', '=', body.rideId)
        .executeTakeFirst();
      if (!ride) throw notFound('Course');
      if (ride.user_id !== accountId(request)) throw forbidden();
    }

    const ticket = await ctx.db
      .insertInto('support_tickets')
      .values({
        reference: generateTicketReference(),
        ride_id: body.rideId ?? null,
        reporter_type: 'client',
        reporter_id: accountId(request),
        category: body.category,
        subject: body.subject,
        description: body.description,
        priority: body.category === 'incident' ? 'urgent' : 'normal',
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return reply.status(201).send({ ticket });
  });

  app.get('/v1/client/support/tickets', auth, async (request) => {
    const tickets = await ctx.db
      .selectFrom('support_tickets')
      .selectAll()
      .where('reporter_type', '=', 'client')
      .where('reporter_id', '=', accountId(request))
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();

    return { items: tickets };
  });

  app.get('/v1/client/notifications', auth, async (request) => {
    const notifications = await ctx.db
      .selectFrom('notifications')
      .selectAll()
      .where('recipient_type', '=', 'client')
      .where('recipient_id', '=', accountId(request))
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();

    return { items: notifications };
  });
}

export function serializeRide(ride: {
  id: string;
  reference: string;
  status: string;
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address: string | null;
  dropoff_latitude: number;
  dropoff_longitude: number;
  dropoff_address: string | null;
  estimated_fare: number | null;
  final_fare: number | null;
  discount_amount: number;
  cancellation_fee: number;
  currency: string;
  payment_method: string;
  driver_id: string | null;
  created_at: Date;
  completed_at: Date | null;
}) {
  return {
    id: ride.id,
    reference: ride.reference,
    status: ride.status,
    pickup: {
      latitude: ride.pickup_latitude,
      longitude: ride.pickup_longitude,
      address: ride.pickup_address,
    },
    dropoff: {
      latitude: ride.dropoff_latitude,
      longitude: ride.dropoff_longitude,
      address: ride.dropoff_address,
    },
    estimatedFare: ride.estimated_fare,
    finalFare: ride.final_fare,
    discount: ride.discount_amount,
    cancellationFee: ride.cancellation_fee,
    amountDue:
      ride.final_fare !== null ? ride.final_fare - ride.discount_amount : ride.estimated_fare,
    currency: ride.currency,
    paymentMethod: ride.payment_method,
    driverId: ride.driver_id,
    createdAt: ride.created_at,
    completedAt: ride.completed_at,
  };
}
