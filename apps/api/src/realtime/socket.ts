import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import type { AppContext, RealtimeGateway } from '../context.js';
import type { AccessTokenPayload } from '../plugins/auth.js';

/**
 * Passerelle temps réel (§4).
 *
 * Deux usages :
 *  - le chauffeur publie sa position pendant une course ;
 *  - le client reçoit les changements d'état et la position du chauffeur.
 *
 * Chaque connexion est authentifiée par le même jeton que l'API REST, et un
 * client ne peut rejoindre que les salles des courses qui le concernent : sans
 * ce contrôle, n'importe qui pourrait suivre n'importe quelle course.
 */

export interface SocketDeps {
  verifyToken: (token: string) => AccessTokenPayload;
}

const rideRoom = (rideId: string): string => `ride:${rideId}`;
const driverRoom = (driverId: string): string => `driver:${driverId}`;
const userRoom = (userId: string): string => `user:${userId}`;

export function createRealtimeGateway(
  httpServer: HttpServer,
  ctx: Omit<AppContext, 'realtime'>,
  deps: SocketDeps,
): { gateway: RealtimeGateway; io: SocketServer } {
  const io = new SocketServer(httpServer, {
    cors: { origin: ctx.env.corsOrigins, credentials: true },
    path: '/realtime',
  });

  io.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');

    if (!token) {
      next(new Error('Jeton d’accès requis.'));
      return;
    }

    try {
      const payload = deps.verifyToken(token);
      socket.data.account = payload;
      next();
    } catch {
      next(new Error('Jeton d’accès invalide.'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const account = socket.data.account as AccessTokenPayload;

    if (account.type === 'driver') socket.join(driverRoom(account.sub));
    if (account.type === 'client') socket.join(userRoom(account.sub));

    socket.on('ride:subscribe', async (payload: { rideId?: string }, ack?: (r: unknown) => void) => {
      const rideId = payload?.rideId;
      if (!rideId) {
        ack?.({ ok: false, error: 'rideId manquant' });
        return;
      }

      const ride = await ctx.db
        .selectFrom('rides')
        .select(['id', 'user_id', 'driver_id'])
        .where('id', '=', rideId)
        .executeTakeFirst();

      const allowed =
        ride !== undefined &&
        ((account.type === 'client' && ride.user_id === account.sub) ||
          (account.type === 'driver' && ride.driver_id === account.sub) ||
          account.type === 'admin');

      if (!allowed) {
        ack?.({ ok: false, error: 'Accès refusé à cette course.' });
        return;
      }

      await socket.join(rideRoom(rideId));
      ack?.({ ok: true });
    });

    socket.on('ride:unsubscribe', (payload: { rideId?: string }) => {
      if (payload?.rideId) void socket.leave(rideRoom(payload.rideId));
    });

    /**
     * Position publiée par l'application chauffeur. Elle est écrite en base
     * (dernière position connue) et, si une course est en cours, ajoutée à sa
     * trace puis diffusée au client.
     */
    socket.on(
      'driver:location',
      async (payload: {
        latitude?: number;
        longitude?: number;
        heading?: number;
        speedKmh?: number;
      }) => {
        if (account.type !== 'driver') return;
        const { latitude, longitude } = payload ?? {};
        if (
          typeof latitude !== 'number' ||
          typeof longitude !== 'number' ||
          latitude < -90 ||
          latitude > 90 ||
          longitude < -180 ||
          longitude > 180
        ) {
          return;
        }

        try {
          await ctx.db
            .insertInto('driver_locations')
            .values({
              driver_id: account.sub,
              latitude,
              longitude,
              heading: payload.heading ?? null,
              speed_kmh: payload.speedKmh ?? null,
              recorded_at: new Date(),
            })
            .onConflict((oc) =>
              oc.column('driver_id').doUpdateSet({
                latitude,
                longitude,
                heading: payload.heading ?? null,
                speed_kmh: payload.speedKmh ?? null,
                recorded_at: new Date(),
              }),
            )
            .execute();

          const activeRide = await ctx.db
            .selectFrom('rides')
            .select('id')
            .where('driver_id', '=', account.sub)
            .where('status', 'in', ['driver_en_route', 'driver_arrived', 'in_progress'])
            .executeTakeFirst();

          if (activeRide) {
            await ctx.db
              .insertInto('ride_locations')
              .values({
                ride_id: activeRide.id,
                driver_id: account.sub,
                latitude,
                longitude,
                heading: payload.heading ?? null,
                speed_kmh: payload.speedKmh ?? null,
              })
              .execute();

            io.to(rideRoom(activeRide.id)).emit('driver:location', {
              rideId: activeRide.id,
              latitude,
              longitude,
              heading: payload.heading ?? null,
              at: new Date().toISOString(),
            });
          }
        } catch (error) {
          ctx.log.warn(
            { driverId: account.sub, error: (error as Error).message },
            'Position chauffeur non enregistrée',
          );
        }
      },
    );
  });

  const gateway: RealtimeGateway = {
    emitToRide: (rideId, event, payload) => {
      io.to(rideRoom(rideId)).emit(event, payload);
    },
    emitToDriver: (driverId, event, payload) => {
      io.to(driverRoom(driverId)).emit(event, payload);
    },
    emitToUser: (userId, event, payload) => {
      io.to(userRoom(userId)).emit(event, payload);
    },
  };

  return { gateway, io };
}
