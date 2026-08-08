import { io, type Socket } from 'socket.io-client';
import type { Coordinates, RideStatus } from './types';

/**
 * Canal temps réel (§4).
 *
 * Enveloppe minimale autour de Socket.IO : connexion authentifiée par le même
 * jeton que l'API REST, abonnement à une course, réception des changements
 * d'état et des positions.
 *
 * Le suivi ne doit jamais dépendre du seul WebSocket : les écrans qui
 * l'utilisent conservent une interrogation périodique de repli, car un réseau
 * mobile coupe et un client qui ne voit plus son chauffeur n'a que faire de la
 * raison technique.
 */

export interface RideStatusEvent {
  rideId: string;
  reference?: string;
  status: RideStatus;
  label?: string;
  montant_du?: number;
  at?: string;
}

export interface DriverLocationEvent extends Coordinates {
  rideId: string;
  heading: number | null;
  at: string;
}

export interface RideOfferEvent {
  offerId: string;
  rideId: string;
  reference: string;
  pickup: { latitude: number; longitude: number; address: string | null };
  dropoff: { latitude: number; longitude: number; address: string | null };
  distanceToPickupMeters: number;
  etaSeconds: number;
  estimatedFare: number | null;
  currency: string;
  expiresAt: string;
}

export interface RealtimeHandlers {
  onRideStatus?: (event: RideStatusEvent) => void;
  onDriverLocation?: (event: DriverLocationEvent) => void;
  onRideOffer?: (event: RideOfferEvent) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export class RealtimeChannel {
  private socket: Socket | null = null;
  private subscribedRideId: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  connect(handlers: RealtimeHandlers): void {
    const token = this.getToken();
    if (!token || this.socket) return;

    this.socket = io(this.baseUrl, {
      path: '/realtime',
      transports: ['websocket'],
      auth: { token },
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 8_000,
    });

    this.socket.on('connect', () => {
      handlers.onConnectionChange?.(true);
      // Après une reconnexion, l'abonnement à la course doit être rétabli :
      // le serveur ne conserve pas l'appartenance aux salles.
      if (this.subscribedRideId) this.subscribeToRide(this.subscribedRideId);
    });

    this.socket.on('disconnect', () => handlers.onConnectionChange?.(false));
    this.socket.on('connect_error', () => handlers.onConnectionChange?.(false));

    if (handlers.onRideStatus) this.socket.on('ride:status', handlers.onRideStatus);
    if (handlers.onDriverLocation) this.socket.on('driver:location', handlers.onDriverLocation);
    if (handlers.onRideOffer) this.socket.on('ride:offer', handlers.onRideOffer);
  }

  subscribeToRide(rideId: string): void {
    this.subscribedRideId = rideId;
    this.socket?.emit('ride:subscribe', { rideId });
  }

  unsubscribeFromRide(rideId: string): void {
    if (this.subscribedRideId === rideId) this.subscribedRideId = null;
    this.socket?.emit('ride:unsubscribe', { rideId });
  }

  /** Publication de position par l'application chauffeur. */
  publishLocation(position: Coordinates & { heading?: number; speedKmh?: number }): void {
    this.socket?.emit('driver:location', position);
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  disconnect(): void {
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
    this.subscribedRideId = null;
  }
}
