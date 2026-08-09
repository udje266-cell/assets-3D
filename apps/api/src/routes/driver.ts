import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { ACTIVE_STATUSES } from '../domain/ride-state.js';
import { conflict, forbidden, notFound, unprocessable } from '../lib/errors.js';
import { accountId } from '../plugins/auth.js';
import { acceptOffer, rejectOffer } from '../services/dispatch.js';
import { cancelRide, completeRide, getRideDetail, settleRide, transitionRide } from '../services/rides.js';
import { submitReview } from '../services/reviews.js';
import {
  assertWithdrawalAllowed,
  DEFAULT_WITHDRAWAL_RULES,
  getWallet,
  postLedgerEntry,
} from '../services/wallet.js';
import { serializeRide } from './client.js';

/** Application chauffeur — §5 du cahier des charges. */
export async function registerDriverRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const auth = { onRequest: [app.requireDriver] };

  /** Charge le chauffeur et refuse l'accès si son compte n'est pas exploitable. */
  async function loadDriver(driverId: string, requireApproved = true) {
    const driver = await ctx.db
      .selectFrom('drivers')
      .selectAll()
      .where('id', '=', driverId)
      .executeTakeFirst();

    if (!driver || driver.deleted_at) throw notFound('Chauffeur');
    if (requireApproved && driver.status !== 'approved') {
      throw forbidden(
        driver.status === 'suspended'
          ? 'Votre compte est suspendu.'
          : 'Votre compte n’est pas encore validé par la plateforme.',
      );
    }
    return driver;
  }

  app.get('/v1/driver/me', auth, async (request) => {
    const driver = await loadDriver(accountId(request), false);
    const wallet = await ctx.db
      .selectFrom('driver_wallets')
      .selectAll()
      .where('driver_id', '=', driver.id)
      .executeTakeFirst();

    return {
      id: driver.id,
      phone: driver.phone,
      firstName: driver.first_name,
      lastName: driver.last_name,
      status: driver.status,
      statusReason: driver.status_reason,
      availability: driver.availability,
      rating: Number(driver.rating_average),
      ridesCount: driver.rides_count,
      acceptanceRate:
        driver.offers_received > 0
          ? Math.round((driver.offers_accepted / driver.offers_received) * 100)
          : null,
      activeVehicleId: driver.active_vehicle_id,
      wallet: wallet ? { balance: wallet.balance, currency: wallet.currency } : null,
    };
  });

  app.patch('/v1/driver/me', auth, async (request) => {
    const body = z
      .object({
        email: z.string().email().nullable().optional(),
        nationalId: z.string().max(60).nullable().optional(),
        licenseNumber: z.string().max(60).nullable().optional(),
        pushToken: z.string().max(255).nullable().optional(),
      })
      .parse(request.body);

    await ctx.db
      .updateTable('drivers')
      .set({
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.nationalId !== undefined ? { national_id: body.nationalId } : {}),
        ...(body.licenseNumber !== undefined ? { license_number: body.licenseNumber } : {}),
        ...(body.pushToken !== undefined ? { push_token: body.pushToken } : {}),
      })
      .where('id', '=', accountId(request))
      .execute();

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // Véhicules et documents (§5)
  // -------------------------------------------------------------------------

  app.post('/v1/driver/vehicles', auth, async (request, reply) => {
    const driver = await loadDriver(accountId(request), false);
    const body = z
      .object({
        vehicleCategoryId: z.string().uuid(),
        make: z.string().min(1).max(60),
        model: z.string().min(1).max(60),
        year: z.number().int().min(1950).max(2100).optional(),
        color: z.string().max(40).optional(),
        plateNumber: z.string().min(3).max(20),
        seats: z.number().int().min(1).max(9).default(4),
      })
      .parse(request.body);

    const vehicle = await ctx.db
      .insertInto('vehicles')
      .values({
        driver_id: driver.id,
        vehicle_category_id: body.vehicleCategoryId,
        make: body.make,
        model: body.model,
        year: body.year ?? null,
        color: body.color ?? null,
        plate_number: body.plateNumber.toUpperCase(),
        seats: body.seats,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    // Premier véhicule : activé d'office pour que le dossier soit exploitable.
    if (!driver.active_vehicle_id) {
      await ctx.db
        .updateTable('drivers')
        .set({ active_vehicle_id: vehicle.id })
        .where('id', '=', driver.id)
        .execute();
    }

    return reply.status(201).send({ vehicle });
  });

  app.get('/v1/driver/vehicles', auth, async (request) => {
    const vehicles = await ctx.db
      .selectFrom('vehicles')
      .selectAll()
      .where('driver_id', '=', accountId(request))
      .where('deleted_at', 'is', null)
      .execute();

    return { items: vehicles };
  });

  app.post('/v1/driver/vehicles/:id/activate', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const vehicle = await ctx.db
      .selectFrom('vehicles')
      .selectAll()
      .where('id', '=', id)
      .where('driver_id', '=', accountId(request))
      .executeTakeFirst();

    if (!vehicle) throw notFound('Véhicule');

    await ctx.db
      .updateTable('drivers')
      .set({ active_vehicle_id: vehicle.id })
      .where('id', '=', accountId(request))
      .execute();

    return { ok: true };
  });

  app.post('/v1/driver/documents', auth, async (request, reply) => {
    const body = z
      .object({
        docType: z.string().min(2).max(60),
        fileUrl: z.string().url().max(500),
        vehicleId: z.string().uuid().optional(),
        number: z.string().max(80).optional(),
        issuedAt: z.string().date().optional(),
        expiresAt: z.string().date().optional(),
      })
      .parse(request.body);

    const document = await ctx.db
      .insertInto('driver_documents')
      .values({
        driver_id: accountId(request),
        vehicle_id: body.vehicleId ?? null,
        doc_type: body.docType,
        file_url: body.fileUrl,
        number: body.number ?? null,
        issued_at: body.issuedAt ?? null,
        expires_at: body.expiresAt ?? null,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return reply.status(201).send({ document });
  });

  app.get('/v1/driver/documents', auth, async (request) => {
    const documents = await ctx.db
      .selectFrom('driver_documents')
      .selectAll()
      .where('driver_id', '=', accountId(request))
      .orderBy('created_at', 'desc')
      .execute();

    return { items: documents };
  });

  // -------------------------------------------------------------------------
  // Disponibilité et position (§4, §5)
  // -------------------------------------------------------------------------

  app.post('/v1/driver/availability', auth, async (request) => {
    const driver = await loadDriver(accountId(request));
    const body = z.object({ online: z.boolean() }).parse(request.body);

    if (body.online && !driver.active_vehicle_id) {
      throw unprocessable(
        'no_active_vehicle',
        'Associez un véhicule à votre compte avant de vous mettre en ligne.',
      );
    }

    // Un chauffeur en course ne peut pas se déclarer simplement « en ligne » :
    // son état est piloté par le cycle de vie de la course.
    if (driver.availability === 'on_ride') {
      throw conflict('on_ride', 'Vous êtes actuellement en course.');
    }

    await ctx.db
      .updateTable('drivers')
      .set({ availability: body.online ? 'online' : 'offline' })
      .where('id', '=', driver.id)
      .execute();

    return { availability: body.online ? 'online' : 'offline' };
  });

  app.post('/v1/driver/location', auth, async (request) => {
    const driverId = accountId(request);
    const body = z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        heading: z.number().min(0).max(360).optional(),
        speedKmh: z.number().min(0).max(300).optional(),
        accuracyM: z.number().min(0).optional(),
      })
      .parse(request.body);

    await ctx.db
      .insertInto('driver_locations')
      .values({
        driver_id: driverId,
        latitude: body.latitude,
        longitude: body.longitude,
        heading: body.heading ?? null,
        speed_kmh: body.speedKmh ?? null,
        accuracy_m: body.accuracyM ?? null,
        recorded_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column('driver_id').doUpdateSet({
          latitude: body.latitude,
          longitude: body.longitude,
          heading: body.heading ?? null,
          speed_kmh: body.speedKmh ?? null,
          accuracy_m: body.accuracyM ?? null,
          recorded_at: new Date(),
        }),
      )
      .execute();

    // Pendant une course, la position alimente aussi la trace horodatée (§4),
    // qui sert au suivi client, au calcul de distance et aux litiges (§15).
    const activeRide = await ctx.db
      .selectFrom('rides')
      .select(['id'])
      .where('driver_id', '=', driverId)
      .where('status', 'in', ['driver_en_route', 'driver_arrived', 'in_progress'])
      .executeTakeFirst();

    if (activeRide) {
      await ctx.db
        .insertInto('ride_locations')
        .values({
          ride_id: activeRide.id,
          driver_id: driverId,
          latitude: body.latitude,
          longitude: body.longitude,
          heading: body.heading ?? null,
          speed_kmh: body.speedKmh ?? null,
        })
        .execute();

      ctx.realtime.emitToRide(activeRide.id, 'driver:location', {
        rideId: activeRide.id,
        latitude: body.latitude,
        longitude: body.longitude,
        heading: body.heading ?? null,
        at: new Date().toISOString(),
      });
    }

    return { ok: true, rideId: activeRide?.id ?? null };
  });

  // -------------------------------------------------------------------------
  // Offres et déroulement de la course (§6, §19)
  // -------------------------------------------------------------------------

  app.get('/v1/driver/offers/current', auth, async (request) => {
    const offer = await ctx.db
      .selectFrom('ride_offers')
      .innerJoin('rides', 'rides.id', 'ride_offers.ride_id')
      .select([
        'ride_offers.id as offerId',
        'ride_offers.expires_at as expiresAt',
        'ride_offers.distance_m as distanceMeters',
        'ride_offers.eta_seconds as etaSeconds',
        'rides.id as rideId',
        'rides.reference',
        'rides.pickup_latitude',
        'rides.pickup_longitude',
        'rides.pickup_address',
        'rides.dropoff_latitude',
        'rides.dropoff_longitude',
        'rides.dropoff_address',
        'rides.estimated_fare',
        'rides.currency',
        'rides.payment_method',
      ])
      .where('ride_offers.driver_id', '=', accountId(request))
      .where('ride_offers.status', '=', 'offered')
      .where('ride_offers.expires_at', '>', new Date())
      .orderBy('ride_offers.created_at', 'desc')
      .executeTakeFirst();

    return { offer: offer ?? null };
  });

  app.post('/v1/driver/offers/:id/accept', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await loadDriver(accountId(request));

    const ride = await acceptOffer(ctx, { offerId: id, driverId: accountId(request) });
    return { ride: serializeRide(ride) };
  });

  app.post('/v1/driver/offers/:id/reject', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().max(160).optional() }).parse(request.body ?? {});

    const result = await rejectOffer(ctx, {
      offerId: id,
      driverId: accountId(request),
      reason: body.reason,
    });

    return { reassigned: result.status === 'offered' };
  });

  const locationBody = z
    .object({
      latitude: z.number().min(-90).max(90).optional(),
      longitude: z.number().min(-180).max(180).optional(),
    })
    .optional();

  /** Fabrique les points d'accès de progression : en route, arrivé, démarrage. */
  const progressRoute = (path: string, to: 'driver_en_route' | 'driver_arrived' | 'in_progress') => {
    app.post(`/v1/driver/rides/:id/${path}`, auth, async (request) => {
      const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
      const body = locationBody.parse(request.body ?? {});
      await loadDriver(accountId(request));

      const ride = await transitionRide(ctx, {
        rideId: id,
        to,
        actorType: 'driver',
        actorId: accountId(request),
        expectDriverId: accountId(request),
        location:
          body?.latitude !== undefined && body?.longitude !== undefined
            ? { latitude: body.latitude, longitude: body.longitude }
            : null,
      });

      return { ride: serializeRide(ride) };
    });
  };

  progressRoute('en-route', 'driver_en_route');
  progressRoute('arrived', 'driver_arrived');
  progressRoute('start', 'in_progress');

  app.post('/v1/driver/rides/:id/complete', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z
      .object({
        distanceMeters: z.number().int().min(0).optional(),
        durationSeconds: z.number().int().min(0).optional(),
        latitude: z.number().min(-90).max(90).optional(),
        longitude: z.number().min(-180).max(180).optional(),
      })
      .parse(request.body ?? {});

    await loadDriver(accountId(request));

    const result = await completeRide(ctx, {
      rideId: id,
      driverId: accountId(request),
      ...(body.distanceMeters !== undefined ? { actualDistanceMeters: body.distanceMeters } : {}),
      ...(body.durationSeconds !== undefined
        ? { actualDurationSeconds: body.durationSeconds }
        : {}),
      location:
        body.latitude !== undefined && body.longitude !== undefined
          ? { latitude: body.latitude, longitude: body.longitude }
          : null,
    });

    return {
      ride: serializeRide(result.ride),
      fare: result.fare,
      discount: result.discount,
      amountDue: result.amountDue,
      commission: result.platformAmount,
      driverAmount: result.driverAmount,
    };
  });

  /** Confirmation d'un encaissement en espèces (§9, §10). */
  app.post('/v1/driver/rides/:id/collect-cash', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);

    const ride = await ctx.db
      .selectFrom('rides')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    if (!ride) throw notFound('Course');
    if (ride.driver_id !== accountId(request)) throw forbidden();
    if (ride.payment_method !== 'cash') {
      throw conflict('not_cash_ride', 'Cette course ne se règle pas en espèces.');
    }

    const result = await settleRide(ctx, {
      rideId: id,
      actorType: 'driver',
      actorId: accountId(request),
    });

    return { status: result.status, amount: result.amount };
  });

  app.post('/v1/driver/rides/:id/cancel', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(255) }).parse(request.body);

    const ride = await ctx.db
      .selectFrom('rides')
      .select('driver_id')
      .where('id', '=', id)
      .executeTakeFirst();

    if (!ride) throw notFound('Course');
    if (ride.driver_id !== accountId(request)) throw forbidden();

    const cancelled = await cancelRide(ctx, {
      rideId: id,
      actorType: 'driver',
      actorId: accountId(request),
      reason: body.reason,
    });

    return { ride: serializeRide(cancelled) };
  });

  app.get('/v1/driver/rides/current', auth, async (request) => {
    const ride = await ctx.db
      .selectFrom('rides')
      .selectAll()
      .where('driver_id', '=', accountId(request))
      .where('status', 'in', [...ACTIVE_STATUSES, 'awaiting_payment'])
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    return { ride: ride ? serializeRide(ride) : null };
  });

  app.get('/v1/driver/rides', auth, async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);

    const rides = await ctx.db
      .selectFrom('rides')
      .selectAll()
      .where('driver_id', '=', accountId(request))
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    // La part chauffeur est ajoutée à la liste : c'est le chiffre qui intéresse
    // le chauffeur dans son historique, davantage que le prix payé par le client.
    return {
      items: rides.map((ride) => ({
        ...serializeRide(ride),
        driverAmount: ride.driver_amount,
        platformAmount: ride.platform_amount,
      })),
    };
  });

  app.get('/v1/driver/rides/:id', auth, async (request) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    const detail = await getRideDetail(ctx.db, id);
    if (detail.ride.driver_id !== accountId(request)) throw forbidden();

    return {
      ride: serializeRide(detail.ride),
      client: detail.user
        ? {
            firstName: detail.user.first_name,
            lastName: detail.user.last_name,
            phone: detail.user.phone,
            rating: Number(detail.user.rating_average),
          }
        : null,
      events: detail.events.map((e) => ({ status: e.to_status, at: e.created_at })),
    };
  });

  app.post('/v1/driver/rides/:id/review', auth, async (request) => {
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
      authorType: 'driver',
      authorId: accountId(request),
      rating: body.rating,
      comment: body.comment ?? null,
      tags: body.tags ?? [],
    });

    return { review };
  });

  // -------------------------------------------------------------------------
  // Portefeuille et retraits (§10)
  // -------------------------------------------------------------------------

  app.get('/v1/driver/wallet', auth, async (request) => {
    const driverId = accountId(request);
    const wallet = await ctx.db.transaction().execute((trx) => getWallet(trx, driverId));

    return {
      wallet: wallet ?? {
        driverId,
        balance: 0,
        pendingBalance: 0,
        totalEarned: 0,
        totalCommission: 0,
        totalWithdrawn: 0,
        currency: ctx.env.CURRENCY,
      },
      rules: DEFAULT_WITHDRAWAL_RULES,
    };
  });

  app.get('/v1/driver/wallet/transactions', auth, async (request) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
      })
      .parse(request.query);

    const transactions = await ctx.db
      .selectFrom('wallet_transactions')
      .selectAll()
      .where('driver_id', '=', accountId(request))
      .orderBy('created_at', 'desc')
      .limit(query.limit)
      .offset(query.offset)
      .execute();

    return { items: transactions };
  });

  app.get('/v1/driver/earnings', auth, async (request) => {
    const query = z
      .object({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      })
      .parse(request.query);

    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86_400_000);
    const to = query.to ? new Date(query.to) : new Date();

    const summary = await ctx.db
      .selectFrom('rides')
      .select(({ fn }) => [
        fn.countAll<number>().as('rides'),
        fn.sum<number>('final_fare').as('gross'),
        fn.sum<number>('driver_amount').as('net'),
        fn.sum<number>('platform_amount').as('commission'),
      ])
      .where('driver_id', '=', accountId(request))
      .where('status', 'in', ['paid', 'rated'])
      .where('completed_at', '>=', from)
      .where('completed_at', '<=', to)
      .executeTakeFirstOrThrow();

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      rides: Number(summary.rides ?? 0),
      grossFares: Number(summary.gross ?? 0),
      netEarnings: Number(summary.net ?? 0),
      commission: Number(summary.commission ?? 0),
    };
  });

  app.post('/v1/driver/withdrawals', auth, async (request, reply) => {
    const driverId = accountId(request);
    await loadDriver(driverId);

    const body = z
      .object({
        amount: z.number().int().positive(),
        method: z.enum(['mobile_money', 'bank_transfer']),
        destination: z.string().min(4).max(120),
      })
      .parse(request.body);

    const withdrawal = await ctx.db.transaction().execute(async (trx) => {
      const wallet = await trx
        .selectFrom('driver_wallets')
        .selectAll()
        .where('driver_id', '=', driverId)
        .forUpdate()
        .executeTakeFirst();

      assertWithdrawalAllowed(wallet?.balance ?? 0, body.amount, DEFAULT_WITHDRAWAL_RULES);

      const created = await trx
        .insertInto('withdrawals')
        .values({
          driver_id: driverId,
          amount: body.amount,
          method: body.method,
          destination: body.destination,
          status: 'requested',
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      // Le montant est débité dès la demande : il ne doit pas pouvoir être
      // engagé deux fois pendant l'instruction du retrait.
      await postLedgerEntry(trx, {
        driverId,
        entryType: 'withdrawal',
        amount: -body.amount,
        withdrawalId: created.id,
        description: `Demande de retrait ${body.method}`,
      });

      return created;
    });

    return reply.status(201).send({ withdrawal });
  });

  app.get('/v1/driver/withdrawals', auth, async (request) => {
    const withdrawals = await ctx.db
      .selectFrom('withdrawals')
      .selectAll()
      .where('driver_id', '=', accountId(request))
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();

    return { items: withdrawals };
  });

  app.get('/v1/driver/notifications', auth, async (request) => {
    const notifications = await ctx.db
      .selectFrom('notifications')
      .selectAll()
      .where('recipient_type', '=', 'driver')
      .where('recipient_id', '=', accountId(request))
      .orderBy('created_at', 'desc')
      .limit(50)
      .execute();

    return { items: notifications };
  });
}
