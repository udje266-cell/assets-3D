import type pg from 'pg';
import type { Env } from './config/env.js';
import type { DB } from './db/index.js';
import type { NotificationService } from './services/notifications.js';
import type { PaymentRouter } from './services/payments.js';
import type { RoutingProvider } from './services/routing.js';

/**
 * Diffusion temps réel (§4).
 *
 * Défini comme une interface pour que les services métier ne dépendent pas de
 * Socket.IO : en test, une implémentation muette suffit.
 */
export interface RealtimeGateway {
  /** Diffuse à tous les participants d'une course (client + chauffeur). */
  emitToRide(rideId: string, event: string, payload: unknown): void;
  /** Diffuse à un chauffeur précis (offre de course, avertissement). */
  emitToDriver(driverId: string, event: string, payload: unknown): void;
  /** Diffuse à un client précis. */
  emitToUser(userId: string, event: string, payload: unknown): void;
}

export class NoopRealtimeGateway implements RealtimeGateway {
  emitToRide(): void {}
  emitToDriver(): void {}
  emitToUser(): void {}
}

export interface AppContext {
  env: Env;
  pool: pg.Pool;
  db: DB;
  routing: RoutingProvider;
  notifications: NotificationService;
  payments: PaymentRouter;
  realtime: RealtimeGateway;
  log: {
    info: (payload: unknown, message?: string) => void;
    warn: (payload: unknown, message?: string) => void;
    error: (payload: unknown, message?: string) => void;
  };
}
