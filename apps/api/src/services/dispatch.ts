import { sql } from 'kysely';
import type { AppContext } from '../context.js';
import type { Ride } from '../db/types.js';
import { rankCandidates, type DispatchCandidate } from '../domain/dispatch.js';
import { boundingBox, haversineMeters, type Coordinates } from '../domain/geo.js';
import { formatAmount } from '../domain/money.js';
import { DRIVER_BUSY_STATUSES } from '../domain/ride-state.js';
import { conflict, notFound } from '../lib/errors.js';
import { TEMPLATES } from './notifications.js';
import { transitionRide } from './rides.js';

/**
 * Attribution des courses — §19 du cahier des charges.
 *
 * Stratégie : offre **séquentielle**. Le meilleur candidat reçoit l'offre ;
 * s'il refuse ou ne répond pas dans le délai imparti, la course est proposée au
 * suivant. Cela évite qu'un même client mobilise dix chauffeurs à la fois et
 * rend le taux d'acceptation (§24) mesurable chauffeur par chauffeur.
 */

export interface DispatchResult {
  status: 'offered' | 'no_driver';
  offeredDriverId?: string;
  candidatesCount: number;
}

interface CandidateRow {
  driver_id: string;
  vehicle_id: string;
  latitude: number;
  longitude: number;
  location_age_seconds: number;
  rating_average: number;
  offers_received: number;
  offers_accepted: number;
}

/**
 * Chauffeurs éligibles : en ligne, validés, non occupés, catégorie de véhicule
 * demandée, position récente, dans le cadre englobant du rayon de recherche.
 *
 * Le préfiltre par rectangle est indexable ; la distance exacte est calculée
 * ensuite en mémoire sur un ensemble déjà réduit.
 */
export async function findCandidates(
  ctx: AppContext,
  params: { ride: Ride; excludeDriverIds?: readonly string[] },
): Promise<DispatchCandidate[]> {
  const pickup: Coordinates = {
    latitude: params.ride.pickup_latitude,
    longitude: params.ride.pickup_longitude,
  };
  const radiusMeters = ctx.env.DISPATCH_SEARCH_RADIUS_KM * 1000;
  const box = boundingBox(pickup, radiusMeters);
  const maxAge = ctx.env.DISPATCH_LOCATION_MAX_AGE_SECONDS;

  const rows = await sql<CandidateRow>`
    SELECT
      d.id                AS driver_id,
      v.id                AS vehicle_id,
      dl.latitude,
      dl.longitude,
      EXTRACT(EPOCH FROM (now() - dl.recorded_at))::double precision AS location_age_seconds,
      d.rating_average::double precision AS rating_average,
      d.offers_received,
      d.offers_accepted
    FROM drivers d
    JOIN driver_locations dl ON dl.driver_id = d.id
    JOIN vehicles v ON v.id = d.active_vehicle_id AND v.deleted_at IS NULL
    WHERE d.status = 'approved'
      AND d.availability = 'online'
      AND d.deleted_at IS NULL
      AND v.vehicle_category_id = ${params.ride.vehicle_category_id}
      AND dl.latitude BETWEEN ${box.minLat} AND ${box.maxLat}
      AND dl.longitude BETWEEN ${box.minLon} AND ${box.maxLon}
      AND dl.recorded_at > now() - make_interval(secs => ${maxAge})
      AND NOT EXISTS (
        SELECT 1 FROM ride_offers ro
        WHERE ro.ride_id = ${params.ride.id} AND ro.driver_id = d.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM rides r
        WHERE r.driver_id = d.id
          AND r.status = ANY(${sql.raw(`ARRAY[${DRIVER_BUSY_STATUSES.map((s) => `'${s}'`).join(',')}]::ride_status[]`)})
      )
    LIMIT 200
  `.execute(ctx.db);

  const excluded = new Set(params.excludeDriverIds ?? []);

  return rows.rows
    .filter((row) => !excluded.has(row.driver_id))
    .map((row) => {
      const distanceMeters = haversineMeters(pickup, {
        latitude: row.latitude,
        longitude: row.longitude,
      });
      return {
        driverId: row.driver_id,
        distanceMeters,
        etaSeconds: Math.round(
          (distanceMeters / 1000 / ctx.env.ROUTING_AVERAGE_SPEED_KMH) * 3600,
        ),
        rating: Number(row.rating_average),
        offersReceived: row.offers_received,
        offersAccepted: row.offers_accepted,
        locationAgeSeconds: Number(row.location_age_seconds),
      } satisfies DispatchCandidate;
    });
}

/**
 * Lance ou poursuit la recherche d'un chauffeur.
 *
 * Appelée à la création de la course, puis après chaque refus ou expiration
 * d'offre. Idempotente : si une offre est déjà en cours, elle ne fait rien.
 */
export async function dispatchRide(ctx: AppContext, rideId: string): Promise<DispatchResult> {
  const ride = await ctx.db
    .selectFrom('rides')
    .selectAll()
    .where('id', '=', rideId)
    .executeTakeFirst();

  if (!ride) throw notFound('Course');

  if (ride.status === 'requested') {
    await transitionRide(ctx, { rideId, to: 'searching', actorType: 'system' });
  } else if (ride.status !== 'searching') {
    return { status: 'no_driver', candidatesCount: 0 };
  }

  const pending = await ctx.db
    .selectFrom('ride_offers')
    .select('driver_id')
    .where('ride_id', '=', rideId)
    .where('status', '=', 'offered')
    .where('expires_at', '>', new Date())
    .executeTakeFirst();

  if (pending) {
    return { status: 'offered', offeredDriverId: pending.driver_id, candidatesCount: 1 };
  }

  const candidates = await findCandidates(ctx, { ride });
  const ranked = rankCandidates(candidates, {
    radiusMeters: ctx.env.DISPATCH_SEARCH_RADIUS_KM * 1000,
    maxLocationAgeSeconds: ctx.env.DISPATCH_LOCATION_MAX_AGE_SECONDS,
    maxCandidates: ctx.env.DISPATCH_MAX_CANDIDATES,
  });

  const best = ranked[0];
  if (!best) {
    return { status: 'no_driver', candidatesCount: 0 };
  }

  const expiresAt = new Date(Date.now() + ctx.env.DISPATCH_OFFER_TTL_SECONDS * 1000);

  const offer = await ctx.db
    .insertInto('ride_offers')
    .values({
      ride_id: rideId,
      driver_id: best.driverId,
      rank: 0,
      distance_m: best.distanceMeters,
      eta_seconds: best.etaSeconds,
      score: best.score,
      status: 'offered',
      expires_at: expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  await ctx.db
    .updateTable('drivers')
    .set({ offers_received: sql`offers_received + 1` })
    .where('id', '=', best.driverId)
    .execute();

  const message = TEMPLATES.new_ride_offer({
    pickup: ride.pickup_address ?? 'Position du client',
    distance: `${(best.distanceMeters / 1000).toFixed(1)} km`,
    fare: formatAmount(ride.estimated_fare ?? 0, ride.currency),
  });

  await ctx.notifications.notify(ctx.db, {
    recipientType: 'driver',
    recipientId: best.driverId,
    template: 'new_ride_offer',
    title: message.title,
    body: message.body,
    rideId: ride.id,
    data: { offre_id: offer.id, expire_le: expiresAt.toISOString() },
  });

  ctx.realtime.emitToDriver(best.driverId, 'ride:offer', {
    offerId: offer.id,
    rideId: ride.id,
    reference: ride.reference,
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
    distanceToPickupMeters: best.distanceMeters,
    etaSeconds: best.etaSeconds,
    estimatedFare: ride.estimated_fare,
    currency: ride.currency,
    expiresAt: expiresAt.toISOString(),
  });

  return { status: 'offered', offeredDriverId: best.driverId, candidatesCount: ranked.length };
}

/** Acceptation d'une offre par un chauffeur (§5, §19). */
export async function acceptOffer(
  ctx: AppContext,
  params: { offerId: string; driverId: string },
): Promise<Ride> {
  const rideId = await ctx.db.transaction().execute(async (trx) => {
    const offer = await trx
      .selectFrom('ride_offers')
      .selectAll()
      .where('id', '=', params.offerId)
      .forUpdate()
      .executeTakeFirst();

    if (!offer) throw notFound('Offre de course');
    if (offer.driver_id !== params.driverId) {
      throw conflict('not_your_offer', 'Cette offre ne vous est pas destinée.');
    }
    if (offer.status !== 'offered') {
      throw conflict('offer_closed', 'Cette offre n’est plus disponible.');
    }
    if (new Date(offer.expires_at) <= new Date()) {
      await trx
        .updateTable('ride_offers')
        .set({ status: 'expired', responded_at: new Date() })
        .where('id', '=', offer.id)
        .execute();
      throw conflict('offer_expired', 'Cette offre a expiré.');
    }

    const driver = await trx
      .selectFrom('drivers')
      .selectAll()
      .where('id', '=', params.driverId)
      .executeTakeFirst();

    if (!driver) throw notFound('Chauffeur');
    if (driver.status !== 'approved') {
      throw conflict('driver_not_approved', 'Votre compte chauffeur n’est pas validé.');
    }
    if (!driver.active_vehicle_id) {
      throw conflict('no_active_vehicle', 'Aucun véhicule actif n’est associé à votre compte.');
    }

    await trx
      .updateTable('ride_offers')
      .set({ status: 'accepted', responded_at: new Date() })
      .where('id', '=', offer.id)
      .execute();

    await trx
      .updateTable('ride_offers')
      .set({ status: 'cancelled', responded_at: new Date() })
      .where('ride_id', '=', offer.ride_id)
      .where('status', '=', 'offered')
      .execute();

    await trx
      .updateTable('drivers')
      .set({ offers_accepted: sql`offers_accepted + 1` })
      .where('id', '=', params.driverId)
      .execute();

    return offer.ride_id;
  });

  const driver = await ctx.db
    .selectFrom('drivers')
    .selectAll()
    .where('id', '=', params.driverId)
    .executeTakeFirstOrThrow();

  let ride: Ride;
  try {
    ride = await transitionRide(ctx, {
      rideId,
      to: 'driver_assigned',
      actorType: 'driver',
      actorId: params.driverId,
      patch: { driver_id: params.driverId, vehicle_id: driver.active_vehicle_id },
    });
  } catch (error) {
    // Course déjà attribuée ou annulée entre-temps : l'offre acceptée est
    // annulée pour ne pas laisser croire au chauffeur qu'il a une course.
    await ctx.db
      .updateTable('ride_offers')
      .set({ status: 'cancelled' })
      .where('id', '=', params.offerId)
      .execute();
    throw error;
  }

  const vehicle = driver.active_vehicle_id
    ? await ctx.db
        .selectFrom('vehicles')
        .selectAll()
        .where('id', '=', driver.active_vehicle_id)
        .executeTakeFirst()
    : undefined;

  const offerRow = await ctx.db
    .selectFrom('ride_offers')
    .select('eta_seconds')
    .where('id', '=', params.offerId)
    .executeTakeFirst();

  const message = TEMPLATES.driver_found({
    driver: `${driver.first_name} ${driver.last_name}`,
    vehicle: vehicle ? `${vehicle.make} ${vehicle.model} (${vehicle.plate_number})` : 'véhicule',
    eta: offerRow?.eta_seconds ?? 300,
  });

  await ctx.notifications.notify(ctx.db, {
    recipientType: 'client',
    recipientId: ride.user_id,
    template: 'driver_found',
    title: message.title,
    body: message.body,
    rideId: ride.id,
  });

  return ride;
}

/** Refus d'une offre : la course repart immédiatement vers le candidat suivant. */
export async function rejectOffer(
  ctx: AppContext,
  params: { offerId: string; driverId: string; reason?: string },
): Promise<DispatchResult> {
  const offer = await ctx.db
    .selectFrom('ride_offers')
    .selectAll()
    .where('id', '=', params.offerId)
    .executeTakeFirst();

  if (!offer) throw notFound('Offre de course');
  if (offer.driver_id !== params.driverId) {
    throw conflict('not_your_offer', 'Cette offre ne vous est pas destinée.');
  }
  if (offer.status !== 'offered') {
    throw conflict('offer_closed', 'Cette offre n’est plus disponible.');
  }

  await ctx.db
    .updateTable('ride_offers')
    .set({ status: 'rejected', responded_at: new Date() })
    .where('id', '=', offer.id)
    .execute();

  return dispatchRide(ctx, offer.ride_id);
}

/**
 * Balayage périodique des offres expirées.
 *
 * Une offre sans réponse ne doit pas bloquer la course : elle est marquée
 * expirée et la recherche reprend. Appelée par la boucle de fond du serveur.
 */
export async function sweepExpiredOffers(ctx: AppContext): Promise<{ expired: number }> {
  const expired = await ctx.db
    .updateTable('ride_offers')
    .set({ status: 'expired', responded_at: new Date() })
    .where('status', '=', 'offered')
    .where('expires_at', '<=', new Date())
    .returning(['id', 'ride_id'])
    .execute();

  for (const offer of expired) {
    try {
      const result = await dispatchRide(ctx, offer.ride_id);
      if (result.status === 'no_driver') {
        await expireRideIfExhausted(ctx, offer.ride_id);
      }
    } catch (error) {
      ctx.log.warn(
        { rideId: offer.ride_id, error: (error as Error).message },
        'Reprise d’attribution impossible',
      );
    }
  }

  return { expired: expired.length };
}

/**
 * Passe une course en `expired` lorsque plus aucun chauffeur ne peut être
 * sollicité et que la recherche dure depuis trop longtemps.
 */
export async function expireRideIfExhausted(
  ctx: AppContext,
  rideId: string,
  maxSearchSeconds = 300,
): Promise<boolean> {
  const ride = await ctx.db
    .selectFrom('rides')
    .selectAll()
    .where('id', '=', rideId)
    .executeTakeFirst();

  if (!ride || ride.status !== 'searching') return false;

  const searchingSince = new Date(ride.requested_at).getTime();
  if (Date.now() - searchingSince < maxSearchSeconds * 1000) return false;

  await transitionRide(ctx, {
    rideId,
    to: 'expired',
    actorType: 'system',
    context: { motif: 'aucun chauffeur disponible' },
  });

  const message = TEMPLATES.ride_cancelled({
    reason: 'Aucun chauffeur n’est disponible pour le moment. Réessayez dans quelques minutes.',
  });
  await ctx.notifications.notify(ctx.db, {
    recipientType: 'client',
    recipientId: ride.user_id,
    template: 'ride_cancelled',
    title: message.title,
    body: message.body,
    rideId: ride.id,
  });

  return true;
}
