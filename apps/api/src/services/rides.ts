import { sql } from 'kysely';
import type { AppContext } from '../context.js';
import type { DBTransaction, Queryable } from '../db/index.js';
import type { ActorType, PaymentMethod, Ride, RideStatus } from '../db/types.js';
import { splitFare, walletEffectForRide } from '../domain/commission.js';
import type { Coordinates } from '../domain/geo.js';
import { formatAmount } from '../domain/money.js';
import {
  computeFare,
  pricingSnapshot,
  toPricingParameters,
  type FareBreakdown,
  type PricingParameters,
} from '../domain/pricing.js';
import { computeDiscount, evaluatePromotion, toPromotionRules } from '../domain/promotions.js';
import {
  cancellationIsChargeable,
  checkTransition,
  RIDE_STATUS_LABELS,
} from '../domain/ride-state.js';
import { conflict, notFound, unprocessable } from '../lib/errors.js';
import { generateRideReference } from '../lib/identifiers.js';
import { TEMPLATES } from './notifications.js';
import { postLedgerEntry } from './wallet.js';

/**
 * Cycle de vie d'une course — §6 du cahier des charges.
 *
 * Toute transition passe par `transitionRide`, qui :
 *   1. verrouille la course,
 *   2. vérifie la transition auprès de la machine à états (module pur),
 *   3. écrit le nouvel état ET l'événement correspondant dans la même
 *      transaction — l'exigence du §6 (« chaque changement d'état doit être
 *      enregistré côté serveur ») ne peut donc pas être contournée.
 */

export interface RidePlace extends Coordinates {
  address?: string | null;
}

// ---------------------------------------------------------------------------
// Tarification applicable
// ---------------------------------------------------------------------------

export async function resolvePricingRule(
  db: Queryable,
  params: { vehicleCategoryId: string; zoneCode?: string; at?: Date },
) {
  const at = params.at ?? new Date();
  const zone = params.zoneCode ?? 'default';

  // Grille de la zone demandée, sinon repli sur la grille par défaut.
  const rule = await db
    .selectFrom('pricing_rules')
    .selectAll()
    .where('vehicle_category_id', '=', params.vehicleCategoryId)
    .where('is_active', '=', true)
    .where('zone_code', 'in', zone === 'default' ? ['default'] : [zone, 'default'])
    .where('effective_from', '<=', at)
    .where((eb) => eb.or([eb('effective_to', 'is', null), eb('effective_to', '>', at)]))
    // La grille spécifique à la zone prime sur la grille par défaut.
    .orderBy(sql`case when zone_code = ${zone} then 0 else 1 end`)
    .orderBy('effective_from', 'desc')
    .executeTakeFirst();

  if (!rule) {
    throw unprocessable(
      'no_pricing_rule',
      'Aucune grille tarifaire active pour cette catégorie de véhicule.',
    );
  }

  return rule;
}

export interface RideEstimate {
  vehicleCategoryId: string;
  vehicleCategoryCode: string;
  vehicleCategoryLabel: string;
  pricingRuleId: string;
  distanceMeters: number;
  durationSeconds: number;
  fare: FareBreakdown;
}

/**
 * Estimation affichée avant commande (§3 : « estimation du prix, temps estimé »).
 * Une estimation est produite pour chaque catégorie active, ce qui alimente
 * directement l'écran de choix de véhicule.
 */
export async function estimateRide(
  ctx: AppContext,
  params: { pickup: Coordinates; dropoff: Coordinates; vehicleCategoryId?: string },
): Promise<RideEstimate[]> {
  const route = await ctx.routing.estimateRoute(params.pickup, params.dropoff);

  let categoriesQuery = ctx.db
    .selectFrom('vehicle_categories')
    .selectAll()
    .where('is_active', '=', true);

  if (params.vehicleCategoryId) {
    categoriesQuery = categoriesQuery.where('id', '=', params.vehicleCategoryId);
  }

  const categories = await categoriesQuery.orderBy('sort_order').execute();
  if (categories.length === 0) {
    throw notFound('Catégorie de véhicule');
  }

  const estimates: RideEstimate[] = [];
  for (const category of categories) {
    const rule = await resolvePricingRule(ctx.db, { vehicleCategoryId: category.id });
    const params_ = toPricingParameters(rule);
    estimates.push({
      vehicleCategoryId: category.id,
      vehicleCategoryCode: category.code,
      vehicleCategoryLabel: category.label,
      pricingRuleId: rule.id,
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      fare: computeFare(
        { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds },
        params_,
      ),
    });
  }

  return estimates;
}

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export interface RequestRideInput {
  userId: string;
  pickup: RidePlace;
  dropoff: RidePlace;
  vehicleCategoryId: string;
  paymentMethod: PaymentMethod;
  promotionCode?: string | null;
}

export async function requestRide(ctx: AppContext, input: RequestRideInput): Promise<Ride> {
  const user = await ctx.db
    .selectFrom('users')
    .selectAll()
    .where('id', '=', input.userId)
    .executeTakeFirst();

  if (!user || user.deleted_at) throw notFound('Client');
  if (user.suspended_at) {
    throw unprocessable('account_suspended', 'Votre compte est suspendu.');
  }

  const route = await ctx.routing.estimateRoute(input.pickup, input.dropoff);
  const rule = await resolvePricingRule(ctx.db, {
    vehicleCategoryId: input.vehicleCategoryId,
  });
  const pricing = toPricingParameters(rule);
  const fare = computeFare(
    { distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds },
    pricing,
  );

  // Le code promotionnel est vérifié dès la commande pour informer le client,
  // puis revalidé à la fin de course sur le prix réel (le prix estimé et le
  // prix final peuvent différer).
  let promotionId: string | null = null;
  if (input.promotionCode) {
    const promotion = await findEligiblePromotion(ctx, {
      code: input.promotionCode,
      userId: input.userId,
      fare: fare.total,
    });
    promotionId = promotion.id;
  }

  try {
    const ride = await ctx.db.transaction().execute(async (trx) => {
      const inserted = await trx
        .insertInto('rides')
        .values({
          reference: generateRideReference(),
          user_id: input.userId,
          vehicle_category_id: input.vehicleCategoryId,
          status: 'requested',
          pickup_latitude: input.pickup.latitude,
          pickup_longitude: input.pickup.longitude,
          pickup_address: input.pickup.address ?? null,
          dropoff_latitude: input.dropoff.latitude,
          dropoff_longitude: input.dropoff.longitude,
          dropoff_address: input.dropoff.address ?? null,
          estimated_distance_m: route.distanceMeters,
          estimated_duration_s: route.durationSeconds,
          pricing_rule_id: rule.id,
          pricing_snapshot: pricingSnapshot(pricing, fare),
          currency: pricing.currency,
          estimated_fare: fare.total,
          commission_bps: pricing.commissionBps,
          promotion_id: promotionId,
          payment_method: input.paymentMethod,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      await recordEvent(trx, {
        rideId: inserted.id,
        fromStatus: null,
        toStatus: 'requested',
        actorType: 'client',
        actorId: input.userId,
        location: input.pickup,
        context: { estimation: fare.total, itineraire: route.source },
      });

      return inserted;
    });

    return ride;
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('ride_already_active', 'Vous avez déjà une course en cours.');
    }
    throw error;
  }
}

async function findEligiblePromotion(
  ctx: AppContext,
  params: { code: string; userId: string; fare: number },
) {
  const row = await ctx.db
    .selectFrom('promotions')
    .selectAll()
    .where(sql<string>`upper(code)`, '=', params.code.toUpperCase())
    .executeTakeFirst();

  if (!row) throw notFound('Code promotionnel');

  const redemptions = await ctx.db
    .selectFrom('promotion_redemptions')
    .select(({ fn }) => fn.countAll<number>().as('total'))
    .where('promotion_id', '=', row.id)
    .where('user_id', '=', params.userId)
    .executeTakeFirstOrThrow();

  const user = await ctx.db
    .selectFrom('users')
    .select('rides_count')
    .where('id', '=', params.userId)
    .executeTakeFirstOrThrow();

  const evaluation = evaluatePromotion(toPromotionRules(row), {
    fare: params.fare,
    userRedemptions: Number(redemptions.total),
    userRidesCount: user.rides_count,
    now: new Date(),
  });

  if (!evaluation.eligible) {
    throw unprocessable(`promotion_${evaluation.code}`, evaluation.reason);
  }

  return { id: row.id, discount: evaluation.discount };
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

interface RecordEventInput {
  rideId: string;
  fromStatus: RideStatus | null;
  toStatus: RideStatus;
  actorType: ActorType;
  actorId?: string | null;
  location?: Coordinates | null;
  context?: Record<string, unknown>;
}

async function recordEvent(trx: DBTransaction, input: RecordEventInput): Promise<void> {
  await trx
    .insertInto('ride_events')
    .values({
      ride_id: input.rideId,
      from_status: input.fromStatus,
      to_status: input.toStatus,
      actor_type: input.actorType,
      actor_id: input.actorId ?? null,
      latitude: input.location?.latitude ?? null,
      longitude: input.location?.longitude ?? null,
      context: input.context ?? {},
    })
    .execute();
}

/** Horodatage métier associé à chaque état atteint. */
const TIMESTAMP_COLUMN: Partial<Record<RideStatus, keyof Ride>> = {
  driver_assigned: 'assigned_at',
  driver_arrived: 'arrived_at',
  in_progress: 'started_at',
  completed: 'completed_at',
  paid: 'paid_at',
};

export interface TransitionInput {
  rideId: string;
  to: RideStatus;
  actorType: ActorType;
  actorId?: string | null;
  location?: Coordinates | null;
  context?: Record<string, unknown>;
  /** Champs additionnels à écrire sur la course dans la même transaction. */
  patch?: Record<string, unknown>;
  /** Restreint la transition à ce chauffeur (contrôle d'appartenance). */
  expectDriverId?: string | null;
  /** Restreint la transition à ce client. */
  expectUserId?: string | null;
}

export async function transitionRide(ctx: AppContext, input: TransitionInput): Promise<Ride> {
  const ride = await ctx.db.transaction().execute(async (trx) => {
    const current = await trx
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', input.rideId)
      .forUpdate()
      .executeTakeFirst();

    if (!current) throw notFound('Course');

    if (input.expectDriverId && current.driver_id !== input.expectDriverId) {
      throw conflict('not_your_ride', 'Cette course n’est pas la vôtre.');
    }
    if (input.expectUserId && current.user_id !== input.expectUserId) {
      throw conflict('not_your_ride', 'Cette course n’est pas la vôtre.');
    }

    const check = checkTransition(current.status, input.to, input.actorType);
    if (!check.allowed) {
      throw conflict('invalid_transition', check.reason, {
        etat_actuel: current.status,
        etat_demande: input.to,
      });
    }

    const patch: Record<string, unknown> = { status: input.to, ...(input.patch ?? {}) };
    const timestampColumn = TIMESTAMP_COLUMN[input.to];
    if (timestampColumn && !(timestampColumn in patch)) {
      patch[timestampColumn] = new Date();
    }

    const updated = await trx
      .updateTable('rides')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .set(patch as any)
      .where('id', '=', input.rideId)
      .returningAll()
      .executeTakeFirstOrThrow();

    await recordEvent(trx, {
      rideId: input.rideId,
      fromStatus: current.status,
      toStatus: input.to,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      location: input.location ?? null,
      context: input.context ?? {},
    });

    // Disponibilité du chauffeur : occupé pendant la course, libéré ensuite.
    if (updated.driver_id) {
      if (input.to === 'driver_assigned') {
        await trx
          .updateTable('drivers')
          .set({ availability: 'on_ride' })
          .where('id', '=', updated.driver_id)
          .where('availability', '=', 'online')
          .execute();
      } else if (['completed', 'cancelled', 'expired'].includes(input.to)) {
        await trx
          .updateTable('drivers')
          .set({ availability: 'online' })
          .where('id', '=', updated.driver_id)
          .where('availability', '=', 'on_ride')
          .execute();
      }
    }

    return updated;
  });

  ctx.realtime.emitToRide(ride.id, 'ride:status', {
    rideId: ride.id,
    reference: ride.reference,
    status: ride.status,
    label: RIDE_STATUS_LABELS[ride.status],
    at: new Date().toISOString(),
  });

  return ride;
}

// ---------------------------------------------------------------------------
// Fin de course : prix réel, remise, commission
// ---------------------------------------------------------------------------

export interface CompleteRideInput {
  rideId: string;
  driverId: string;
  /** Distance réellement parcourue ; à défaut, la trace GPS est utilisée. */
  actualDistanceMeters?: number;
  actualDurationSeconds?: number;
  location?: Coordinates | null;
}

export interface CompletedRide {
  ride: Ride;
  fare: FareBreakdown;
  discount: number;
  platformAmount: number;
  driverAmount: number;
  amountDue: number;
}

export async function completeRide(
  ctx: AppContext,
  input: CompleteRideInput,
): Promise<CompletedRide> {
  const ride = await ctx.db
    .selectFrom('rides')
    .selectAll()
    .where('id', '=', input.rideId)
    .executeTakeFirst();

  if (!ride) throw notFound('Course');
  if (ride.driver_id !== input.driverId) {
    throw conflict('not_your_ride', 'Cette course n’est pas la vôtre.');
  }
  if (ride.status !== 'in_progress') {
    throw conflict('invalid_transition', 'Seule une course en cours peut être terminée.', {
      etat_actuel: ride.status,
    });
  }

  const measured = await measureRide(ctx, ride, input);
  const rule = ride.pricing_rule_id
    ? await ctx.db
        .selectFrom('pricing_rules')
        .selectAll()
        .where('id', '=', ride.pricing_rule_id)
        .executeTakeFirstOrThrow()
    : await resolvePricingRule(ctx.db, { vehicleCategoryId: ride.vehicle_category_id });

  const pricing: PricingParameters = toPricingParameters(rule);
  const fare = computeFare(
    { distanceMeters: measured.distanceMeters, durationSeconds: measured.durationSeconds },
    pricing,
  );

  const result = await ctx.db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', input.rideId)
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (locked.status !== 'in_progress') {
      throw conflict('invalid_transition', 'Cette course a déjà été clôturée.');
    }

    // Revalidation de la promotion sur le prix réel : une remise annoncée à la
    // commande peut ne plus être applicable (montant minimum, expiration).
    const discount = await applyPromotionAtCompletion(trx, {
      rideId: locked.id,
      userId: locked.user_id,
      promotionId: locked.promotion_id,
      fare: fare.total,
    });

    const split = splitFare(fare.total, pricing.commissionBps, discount);

    const updated = await trx
      .updateTable('rides')
      .set({
        status: 'awaiting_payment',
        actual_distance_m: measured.distanceMeters,
        actual_duration_s: measured.durationSeconds,
        final_fare: fare.total,
        discount_amount: discount,
        platform_amount: split.platformAmount,
        driver_amount: split.driverAmount,
        commission_bps: pricing.commissionBps,
        pricing_snapshot: pricingSnapshot(pricing, fare),
        completed_at: new Date(),
      })
      .where('id', '=', locked.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    // Deux transitions distinctes, toutes deux tracées : la course est terminée,
    // puis elle attend son règlement (§6 : « course terminée → paiement »).
    await recordEvent(trx, {
      rideId: locked.id,
      fromStatus: 'in_progress',
      toStatus: 'completed',
      actorType: 'driver',
      actorId: input.driverId,
      location: input.location ?? null,
      context: {
        distance_m: measured.distanceMeters,
        duree_s: measured.durationSeconds,
        source: measured.source,
        prix: fare.total,
      },
    });
    await recordEvent(trx, {
      rideId: locked.id,
      fromStatus: 'completed',
      toStatus: 'awaiting_payment',
      actorType: 'system',
      context: {
        remise: discount,
        montant_du: split.amountChargedToClient,
        commission: split.platformAmount,
        part_chauffeur: split.driverAmount,
      },
    });

    await trx
      .updateTable('drivers')
      .set({
        availability: 'online',
        rides_count: sql`rides_count + 1`,
      })
      .where('id', '=', input.driverId)
      .execute();

    await trx
      .updateTable('users')
      .set({ rides_count: sql`rides_count + 1` })
      .where('id', '=', locked.user_id)
      .execute();

    return { ride: updated, split, discount };
  });

  ctx.realtime.emitToRide(result.ride.id, 'ride:status', {
    rideId: result.ride.id,
    status: result.ride.status,
    label: RIDE_STATUS_LABELS[result.ride.status],
    montant_du: result.split.amountChargedToClient,
  });

  const message = TEMPLATES.ride_completed({
    amount: formatAmount(result.split.amountChargedToClient, result.ride.currency),
  });
  await ctx.notifications.notify(ctx.db, {
    recipientType: 'client',
    recipientId: result.ride.user_id,
    template: 'ride_completed',
    title: message.title,
    body: message.body,
    rideId: result.ride.id,
    data: { montant: result.split.amountChargedToClient },
  });

  return {
    ride: result.ride,
    fare,
    discount: result.discount,
    platformAmount: result.split.platformAmount,
    driverAmount: result.split.driverAmount,
    amountDue: result.split.amountChargedToClient,
  };
}

/**
 * Distance et durée réelles.
 *
 * Priorité à la mesure transmise par l'application chauffeur ; à défaut, la
 * trace GPS enregistrée pendant la course sert de source, puis l'estimation
 * initiale. Une course facturée doit toujours pouvoir justifier sa distance.
 */
async function measureRide(
  ctx: AppContext,
  ride: Ride,
  input: CompleteRideInput,
): Promise<{ distanceMeters: number; durationSeconds: number; source: string }> {
  const startedAt = ride.started_at ? new Date(ride.started_at) : null;
  const elapsedSeconds = startedAt
    ? Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 1000))
    : 0;

  if (input.actualDistanceMeters !== undefined) {
    return {
      distanceMeters: Math.max(0, Math.round(input.actualDistanceMeters)),
      durationSeconds: Math.max(
        0,
        Math.round(input.actualDurationSeconds ?? elapsedSeconds),
      ),
      source: 'application chauffeur',
    };
  }

  const trace = await ctx.db
    .selectFrom('ride_locations')
    .select(['latitude', 'longitude'])
    .where('ride_id', '=', ride.id)
    .orderBy('recorded_at')
    .execute();

  if (trace.length >= 2) {
    const { pathLengthMeters } = await import('../domain/geo.js');
    return {
      distanceMeters: pathLengthMeters(trace),
      durationSeconds: elapsedSeconds,
      source: 'trace GPS',
    };
  }

  return {
    distanceMeters: ride.estimated_distance_m ?? 0,
    durationSeconds: elapsedSeconds || (ride.estimated_duration_s ?? 0),
    source: 'estimation initiale',
  };
}

async function applyPromotionAtCompletion(
  trx: DBTransaction,
  params: { rideId: string; userId: string; promotionId: string | null; fare: number },
): Promise<number> {
  if (!params.promotionId) return 0;

  const promotion = await trx
    .selectFrom('promotions')
    .selectAll()
    .where('id', '=', params.promotionId)
    .forUpdate()
    .executeTakeFirst();

  if (!promotion) return 0;

  const redemptions = await trx
    .selectFrom('promotion_redemptions')
    .select(({ fn }) => fn.countAll<number>().as('total'))
    .where('promotion_id', '=', promotion.id)
    .where('user_id', '=', params.userId)
    .executeTakeFirstOrThrow();

  const user = await trx
    .selectFrom('users')
    .select('rides_count')
    .where('id', '=', params.userId)
    .executeTakeFirstOrThrow();

  const evaluation = evaluatePromotion(toPromotionRules(promotion), {
    fare: params.fare,
    userRedemptions: Number(redemptions.total),
    userRidesCount: user.rides_count,
    now: new Date(),
  });

  // Une promotion devenue inapplicable ne fait pas échouer la course : le prix
  // est simplement facturé sans remise, et la course perd sa référence promo.
  if (!evaluation.eligible) {
    await trx
      .updateTable('rides')
      .set({ promotion_id: null })
      .where('id', '=', params.rideId)
      .execute();
    return 0;
  }

  const discount = computeDiscount(toPromotionRules(promotion), params.fare);

  await trx
    .insertInto('promotion_redemptions')
    .values({
      promotion_id: promotion.id,
      user_id: params.userId,
      ride_id: params.rideId,
      discount,
    })
    .execute();

  await trx
    .updateTable('promotions')
    .set({ redemptions_count: sql`redemptions_count + 1` })
    .where('id', '=', promotion.id)
    .execute();

  return discount;
}

// ---------------------------------------------------------------------------
// Règlement (§9) et portefeuille (§10)
// ---------------------------------------------------------------------------

export interface SettleRideInput {
  rideId: string;
  actorType: ActorType;
  actorId?: string | null;
  /** Numéro mobile money ou jeton de carte, selon le moyen retenu. */
  instrument?: string | null;
}

export interface SettlementResult {
  ride: Ride;
  paymentId: string;
  status: 'succeeded' | 'processing' | 'failed';
  amount: number;
  failureReason?: string;
}

export async function settleRide(
  ctx: AppContext,
  input: SettleRideInput,
): Promise<SettlementResult> {
  const ride = await ctx.db
    .selectFrom('rides')
    .selectAll()
    .where('id', '=', input.rideId)
    .executeTakeFirst();

  if (!ride) throw notFound('Course');
  if (ride.status !== 'awaiting_payment') {
    throw conflict('invalid_transition', 'Cette course n’est pas en attente de paiement.', {
      etat_actuel: ride.status,
    });
  }

  const amount = (ride.final_fare ?? 0) - ride.discount_amount;

  // 1. Enregistrement de l'intention de paiement AVANT tout appel externe :
  //    si le prestataire répond mal ou pas du tout, la trace existe déjà.
  const payment = await ctx.db
    .insertInto('payments')
    .values({
      ride_id: ride.id,
      user_id: ride.user_id,
      driver_id: ride.driver_id,
      amount,
      currency: ride.currency,
      method: ride.payment_method,
      status: 'processing',
      platform_amount: ride.platform_amount,
      driver_amount: ride.driver_amount,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  // 2. Appel au prestataire, hors transaction : un appel réseau ne doit jamais
  //    tenir un verrou de base ouvert.
  const provider = ctx.payments.resolve(ride.payment_method);
  const charge = await provider.charge({
    idempotencyKey: payment.id,
    amount,
    currency: ride.currency,
    method: ride.payment_method,
    instrument: input.instrument ?? null,
    metadata: { ride_reference: ride.reference },
  });

  // 3. Application du résultat.
  if (charge.status === 'failed') {
    await ctx.db
      .updateTable('payments')
      .set({
        status: 'failed',
        provider: charge.provider,
        failure_reason: charge.failureReason ?? 'Paiement refusé.',
        provider_payload: charge.payload ?? null,
      })
      .where('id', '=', payment.id)
      .execute();

    return {
      ride,
      paymentId: payment.id,
      status: 'failed',
      amount,
      failureReason: charge.failureReason ?? 'Paiement refusé.',
    };
  }

  if (charge.status === 'processing') {
    await ctx.db
      .updateTable('payments')
      .set({
        status: 'processing',
        provider: charge.provider,
        provider_reference: charge.providerReference,
        provider_payload: charge.payload ?? null,
        authorized_at: new Date(),
      })
      .where('id', '=', payment.id)
      .execute();

    return { ride, paymentId: payment.id, status: 'processing', amount };
  }

  const settled = await ctx.db.transaction().execute(async (trx) => {
    const locked = await trx
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', ride.id)
      .forUpdate()
      .executeTakeFirstOrThrow();

    if (locked.status !== 'awaiting_payment') {
      throw conflict('already_settled', 'Cette course a déjà été réglée.');
    }

    await trx
      .updateTable('payments')
      .set({
        status: 'succeeded',
        provider: charge.provider,
        provider_reference: charge.providerReference,
        provider_payload: charge.payload ?? null,
        authorized_at: new Date(),
        captured_at: new Date(),
      })
      .where('id', '=', payment.id)
      .execute();

    const updated = await trx
      .updateTable('rides')
      .set({ status: 'paid', paid_at: new Date() })
      .where('id', '=', locked.id)
      .returningAll()
      .executeTakeFirstOrThrow();

    await recordEvent(trx, {
      rideId: locked.id,
      fromStatus: 'awaiting_payment',
      toStatus: 'paid',
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      context: {
        moyen: locked.payment_method,
        montant: amount,
        prestataire: charge.provider,
        reference: charge.providerReference,
      },
    });

    // Écritures au portefeuille du chauffeur (§10).
    if (locked.driver_id) {
      const split = splitFare(
        locked.final_fare ?? 0,
        locked.commission_bps ?? 0,
        locked.discount_amount,
      );
      for (const entry of walletEffectForRide(split, locked.payment_method)) {
        await postLedgerEntry(trx, {
          driverId: locked.driver_id,
          entryType: entry.entryType,
          amount: entry.amount,
          rideId: locked.id,
          paymentId: payment.id,
          description: entry.description,
          currency: locked.currency,
        });
      }
    }

    return updated;
  });

  const clientMessage = TEMPLATES.payment_received({
    amount: formatAmount(amount, settled.currency),
  });
  await ctx.notifications.notify(ctx.db, {
    recipientType: 'client',
    recipientId: settled.user_id,
    template: 'payment_received',
    title: clientMessage.title,
    body: clientMessage.body,
    rideId: settled.id,
  });

  if (settled.driver_id) {
    const driverMessage = TEMPLATES.driver_earning({
      amount: formatAmount(settled.driver_amount, settled.currency),
    });
    await ctx.notifications.notify(ctx.db, {
      recipientType: 'driver',
      recipientId: settled.driver_id,
      template: 'driver_earning',
      title: driverMessage.title,
      body: driverMessage.body,
      rideId: settled.id,
    });
  }

  ctx.realtime.emitToRide(settled.id, 'ride:status', {
    rideId: settled.id,
    status: settled.status,
    label: RIDE_STATUS_LABELS[settled.status],
  });

  return { ride: settled, paymentId: payment.id, status: 'succeeded', amount };
}

// ---------------------------------------------------------------------------
// Annulation
// ---------------------------------------------------------------------------

export interface CancelRideInput {
  rideId: string;
  actorType: ActorType;
  actorId?: string | null;
  reason: string;
  location?: Coordinates | null;
}

export async function cancelRide(ctx: AppContext, input: CancelRideInput): Promise<Ride> {
  const current = await ctx.db
    .selectFrom('rides')
    .selectAll()
    .where('id', '=', input.rideId)
    .executeTakeFirst();

  if (!current) throw notFound('Course');

  const chargeable = cancellationIsChargeable(current.status, input.actorType);
  let cancellationFee = 0;

  if (chargeable && current.pricing_rule_id) {
    const rule = await ctx.db
      .selectFrom('pricing_rules')
      .select('cancellation_fee')
      .where('id', '=', current.pricing_rule_id)
      .executeTakeFirst();
    cancellationFee = rule?.cancellation_fee ?? 0;
  }

  const ride = await transitionRide(ctx, {
    rideId: input.rideId,
    to: 'cancelled',
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    location: input.location ?? null,
    context: { motif: input.reason, frais: cancellationFee },
    patch: {
      cancelled_at: new Date(),
      cancelled_by: input.actorType,
      cancellation_reason: input.reason,
      cancellation_fee: cancellationFee,
    },
  });

  // Les offres encore ouvertes deviennent caduques.
  await ctx.db
    .updateTable('ride_offers')
    .set({ status: 'cancelled', responded_at: new Date() })
    .where('ride_id', '=', ride.id)
    .where('status', '=', 'offered')
    .execute();

  const message = TEMPLATES.ride_cancelled({ reason: input.reason });
  const recipients: Array<{ type: 'client' | 'driver'; id: string }> = [];
  if (input.actorType !== 'client') recipients.push({ type: 'client', id: ride.user_id });
  if (ride.driver_id && input.actorType !== 'driver') {
    recipients.push({ type: 'driver', id: ride.driver_id });
  }

  for (const recipient of recipients) {
    await ctx.notifications.notify(ctx.db, {
      recipientType: recipient.type,
      recipientId: recipient.id,
      template: 'ride_cancelled',
      title: message.title,
      body: message.body,
      rideId: ride.id,
    });
  }

  return ride;
}

// ---------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------

export async function getRideDetail(db: Queryable, rideId: string) {
  const ride = await db
    .selectFrom('rides')
    .selectAll('rides')
    .where('rides.id', '=', rideId)
    .executeTakeFirst();

  if (!ride) throw notFound('Course');

  const [events, driver, user, payments, vehicle] = await Promise.all([
    db.selectFrom('ride_events').selectAll().where('ride_id', '=', rideId).orderBy('created_at').execute(),
    ride.driver_id
      ? db
          .selectFrom('drivers')
          .select(['id', 'first_name', 'last_name', 'phone', 'rating_average'])
          .where('id', '=', ride.driver_id)
          .executeTakeFirst()
      : Promise.resolve(undefined),
    db
      .selectFrom('users')
      .select(['id', 'first_name', 'last_name', 'phone', 'rating_average'])
      .where('id', '=', ride.user_id)
      .executeTakeFirst(),
    db.selectFrom('payments').selectAll().where('ride_id', '=', rideId).execute(),
    ride.vehicle_id
      ? db
          .selectFrom('vehicles')
          .select(['id', 'make', 'model', 'color', 'plate_number'])
          .where('id', '=', ride.vehicle_id)
          .executeTakeFirst()
      : Promise.resolve(undefined),
  ]);

  return { ride, events, driver: driver ?? null, user: user ?? null, payments, vehicle: vehicle ?? null };
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
