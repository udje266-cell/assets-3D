import type {
  AccountType,
  AppNotification,
  ClientProfile,
  Coordinates,
  DriverProfile,
  Earnings,
  EstimateResponse,
  PaymentMethod,
  Place,
  PromotionCheck,
  Ride,
  RideDetail,
  RideOffer,
  Session,
  SupportTicket,
  VehicleCategory,
  Wallet,
  WalletTransaction,
  Withdrawal,
} from './types';

/**
 * Client d'API partagé par les deux applications mobiles.
 *
 * Trois principes :
 *  - le stockage des jetons est **injecté** (`TokenStorage`) : la bibliothèque
 *    ne dépend ni d'Expo ni de React Native, ce qui la rend testable en Node ;
 *  - le rafraîchissement du jeton d'accès est automatique et **mutualisé** :
 *    plusieurs requêtes qui reçoivent 401 en même temps ne déclenchent qu'une
 *    seule rotation ;
 *  - une erreur d'API arrive toujours sous forme d'`ApiError` portant le code
 *    stable du serveur, jamais une chaîne à analyser.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Vrai lorsque l'erreur vient du réseau et non d'une réponse du serveur. */
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export interface TokenStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Stockage en mémoire — utile pour les tests et comme repli. */
export class MemoryStorage implements TokenStorage {
  private readonly values = new Map<string, string>();
  async get(key: string) {
    return this.values.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.values.set(key, value);
  }
  async remove(key: string) {
    this.values.delete(key);
  }
}

const ACCESS_KEY = 'mobilite.access';
const REFRESH_KEY = 'mobilite.refresh';

export interface ApiClientOptions {
  baseUrl: string;
  storage: TokenStorage;
  /** Appelé lorsque la session devient définitivement invalide. */
  onSessionExpired?: () => void;
  /** Délai maximum d'une requête, en millisecondes. */
  timeoutMs?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Requête non authentifiée (connexion, rafraîchissement). */
  anonymous?: boolean;
  query?: Record<string, string | number | undefined>;
}

export class ApiClient {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshing: Promise<boolean> | null = null;
  private loaded = false;

  constructor(private readonly options: ApiClientOptions) {}

  // -------------------------------------------------------------------------
  // Session
  // -------------------------------------------------------------------------

  /** Recharge les jetons depuis le stockage persistant. À appeler au démarrage. */
  async restore(): Promise<boolean> {
    this.accessToken = await this.options.storage.get(ACCESS_KEY);
    this.refreshToken = await this.options.storage.get(REFRESH_KEY);
    this.loaded = true;
    return this.refreshToken !== null;
  }

  get hasSession(): boolean {
    return this.refreshToken !== null;
  }

  private async persist(access: string, refresh: string): Promise<void> {
    this.accessToken = access;
    this.refreshToken = refresh;
    await this.options.storage.set(ACCESS_KEY, access);
    await this.options.storage.set(REFRESH_KEY, refresh);
  }

  async clearSession(): Promise<void> {
    this.accessToken = null;
    this.refreshToken = null;
    await this.options.storage.remove(ACCESS_KEY);
    await this.options.storage.remove(REFRESH_KEY);
  }

  /** Jeton d'accès courant — nécessaire pour authentifier la connexion WebSocket. */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  // -------------------------------------------------------------------------
  // Transport
  // -------------------------------------------------------------------------

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const url = `${this.options.baseUrl}${path}`;
    if (!query) return url;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const serialized = params.toString();
    return serialized ? `${url}?${serialized}` : url;
  }

  private async send<T>(path: string, options: RequestOptions): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);

    let response: Response;
    try {
      response = await fetch(this.buildUrl(path, options.query), {
        method: options.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(!options.anonymous && this.accessToken
            ? { Authorization: `Bearer ${this.accessToken}` }
            : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        signal: controller.signal,
      });
    } catch (error) {
      // Réseau mobile instable : le distinguer d'une erreur applicative permet
      // à l'interface de proposer « Réessayer » plutôt qu'un message d'échec.
      throw new ApiError(
        0,
        controller.signal.aborted ? 'timeout' : 'network_error',
        controller.signal.aborted
          ? 'Le serveur ne répond pas. Vérifiez votre connexion.'
          : 'Connexion impossible. Vérifiez votre réseau.',
        error,
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      const body = payload as { error?: { code: string; message: string; details?: unknown } };
      throw new ApiError(
        response.status,
        body?.error?.code ?? 'unknown',
        body?.error?.message ?? `Erreur ${response.status}`,
        body?.error?.details,
      );
    }

    return payload as T;
  }

  /** Requête authentifiée, avec une tentative de rafraîchissement sur 401. */
  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (!this.loaded) await this.restore();

    try {
      return await this.send<T>(path, options);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401 && !options.anonymous) {
        if (await this.refreshSession()) {
          return this.send<T>(path, options);
        }
        this.options.onSessionExpired?.();
      }
      throw error;
    }
  }

  private async refreshSession(): Promise<boolean> {
    if (!this.refreshToken) return false;

    // Les appels concurrents partagent la même rotation : le serveur révoque
    // toute la chaîne de sessions si un jeton de rafraîchissement est rejoué.
    this.refreshing ??= this.send<{ accessToken: string; refreshToken: string }>(
      '/v1/auth/refresh',
      { method: 'POST', body: { refreshToken: this.refreshToken }, anonymous: true },
    )
      .then(async (result) => {
        await this.persist(result.accessToken, result.refreshToken);
        return true;
      })
      .catch(async () => {
        await this.clearSession();
        return false;
      })
      .finally(() => {
        this.refreshing = null;
      });

    return this.refreshing;
  }

  // -------------------------------------------------------------------------
  // Authentification (§3, §5)
  // -------------------------------------------------------------------------

  /** Demande un code à usage unique. `code` n'est renseigné qu'en développement. */
  async requestOtp(
    phone: string,
    accountType: AccountType,
  ): Promise<{ expiresAt: string; code?: string }> {
    return this.send('/v1/auth/otp/request', {
      method: 'POST',
      body: { phone, accountType },
      anonymous: true,
    });
  }

  async verifyOtp(params: {
    phone: string;
    accountType: AccountType;
    code: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  }): Promise<Session> {
    const session = await this.send<Session>('/v1/auth/otp/verify', {
      method: 'POST',
      body: params,
      anonymous: true,
    });
    await this.persist(session.accessToken, session.refreshToken);
    return session;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/v1/auth/logout', { method: 'POST' });
    } finally {
      await this.clearSession();
    }
  }

  // -------------------------------------------------------------------------
  // Client (§3)
  // -------------------------------------------------------------------------

  clientProfile(): Promise<ClientProfile> {
    return this.request('/v1/client/me');
  }

  updateClientProfile(body: {
    firstName?: string;
    lastName?: string;
    email?: string | null;
    pushToken?: string | null;
  }): Promise<{ ok: boolean }> {
    return this.request('/v1/client/me', { method: 'PATCH', body });
  }

  vehicleCategories(): Promise<VehicleCategory[]> {
    return this.request('/v1/client/vehicle-categories');
  }

  estimate(body: {
    pickup: Coordinates;
    dropoff: Coordinates;
    vehicleCategoryId?: string;
  }): Promise<EstimateResponse> {
    return this.request('/v1/client/rides/estimate', { method: 'POST', body });
  }

  checkPromotion(code: string, fare: number): Promise<PromotionCheck> {
    return this.request('/v1/client/promotions/check', { method: 'POST', body: { code, fare } });
  }

  requestRide(body: {
    pickup: Place;
    dropoff: Place;
    vehicleCategoryId: string;
    paymentMethod: PaymentMethod;
    promotionCode?: string;
  }): Promise<{ ride: Ride; dispatch: { status: string; candidats: number } }> {
    return this.request('/v1/client/rides', { method: 'POST', body });
  }

  clientRides(query: { limit?: number; offset?: number } = {}): Promise<{ items: Ride[] }> {
    return this.request('/v1/client/rides', { query });
  }

  clientRide(rideId: string): Promise<RideDetail> {
    return this.request(`/v1/client/rides/${rideId}`);
  }

  tracking(rideId: string): Promise<{
    status: string;
    position: { latitude: number; longitude: number; heading: number | null } | null;
  }> {
    return this.request(`/v1/client/rides/${rideId}/tracking`);
  }

  cancelRideAsClient(
    rideId: string,
    reason: string,
  ): Promise<{ ride: Ride; cancellationFee: number }> {
    return this.request(`/v1/client/rides/${rideId}/cancel`, { method: 'POST', body: { reason } });
  }

  payRide(
    rideId: string,
    instrument?: string,
  ): Promise<{ status: string; amount: number; failureReason?: string }> {
    return this.request(`/v1/client/rides/${rideId}/pay`, {
      method: 'POST',
      body: instrument ? { instrument } : {},
    });
  }

  rateDriver(rideId: string, rating: number, comment?: string): Promise<unknown> {
    return this.request(`/v1/client/rides/${rideId}/review`, {
      method: 'POST',
      body: { rating, ...(comment ? { comment } : {}) },
    });
  }

  createTicket(body: {
    rideId?: string;
    category: string;
    subject: string;
    description: string;
  }): Promise<{ ticket: SupportTicket }> {
    return this.request('/v1/client/support/tickets', { method: 'POST', body });
  }

  clientTickets(): Promise<{ items: SupportTicket[] }> {
    return this.request('/v1/client/support/tickets');
  }

  clientNotifications(): Promise<{ items: AppNotification[] }> {
    return this.request('/v1/client/notifications');
  }

  // -------------------------------------------------------------------------
  // Chauffeur (§5)
  // -------------------------------------------------------------------------

  driverProfile(): Promise<DriverProfile> {
    return this.request('/v1/driver/me');
  }

  addVehicle(body: {
    vehicleCategoryId: string;
    make: string;
    model: string;
    year?: number;
    color?: string;
    plateNumber: string;
    seats?: number;
  }): Promise<{ vehicle: { id: string } }> {
    return this.request('/v1/driver/vehicles', { method: 'POST', body });
  }

  driverVehicles(): Promise<{ items: Array<{ id: string; make: string; model: string; plate_number: string }> }> {
    return this.request('/v1/driver/vehicles');
  }

  addDocument(body: {
    docType: string;
    fileUrl: string;
    number?: string;
    expiresAt?: string;
  }): Promise<{ document: { id: string; status: string } }> {
    return this.request('/v1/driver/documents', { method: 'POST', body });
  }

  driverDocuments(): Promise<{
    items: Array<{ id: string; doc_type: string; status: string; review_note: string | null }>;
  }> {
    return this.request('/v1/driver/documents');
  }

  setAvailability(online: boolean): Promise<{ availability: string }> {
    return this.request('/v1/driver/availability', { method: 'POST', body: { online } });
  }

  publishLocation(body: {
    latitude: number;
    longitude: number;
    heading?: number;
    speedKmh?: number;
    accuracyM?: number;
  }): Promise<{ ok: boolean; rideId: string | null }> {
    return this.request('/v1/driver/location', { method: 'POST', body });
  }

  currentOffer(): Promise<{ offer: RideOffer | null }> {
    return this.request('/v1/driver/offers/current');
  }

  acceptOffer(offerId: string): Promise<{ ride: Ride }> {
    return this.request(`/v1/driver/offers/${offerId}/accept`, { method: 'POST' });
  }

  rejectOffer(offerId: string, reason?: string): Promise<{ reassigned: boolean }> {
    return this.request(`/v1/driver/offers/${offerId}/reject`, {
      method: 'POST',
      body: reason ? { reason } : {},
    });
  }

  /** Étapes du §6 : « en route », « arrivé », « passager à bord ». */
  advanceRide(
    rideId: string,
    step: 'en-route' | 'arrived' | 'start',
    location?: Coordinates,
  ): Promise<{ ride: Ride }> {
    return this.request(`/v1/driver/rides/${rideId}/${step}`, {
      method: 'POST',
      body: location ?? {},
    });
  }

  completeRide(
    rideId: string,
    body: { distanceMeters?: number; durationSeconds?: number },
  ): Promise<{
    ride: Ride;
    amountDue: number;
    commission: number;
    driverAmount: number;
    discount: number;
  }> {
    return this.request(`/v1/driver/rides/${rideId}/complete`, { method: 'POST', body });
  }

  collectCash(rideId: string): Promise<{ status: string; amount: number }> {
    return this.request(`/v1/driver/rides/${rideId}/collect-cash`, { method: 'POST' });
  }

  cancelRideAsDriver(rideId: string, reason: string): Promise<{ ride: Ride }> {
    return this.request(`/v1/driver/rides/${rideId}/cancel`, { method: 'POST', body: { reason } });
  }

  currentDriverRide(): Promise<{ ride: Ride | null }> {
    return this.request('/v1/driver/rides/current');
  }

  driverRides(query: { limit?: number; offset?: number } = {}): Promise<{ items: Ride[] }> {
    return this.request('/v1/driver/rides', { query });
  }

  driverRide(rideId: string): Promise<{
    ride: Ride;
    client: { firstName: string | null; lastName: string | null; phone: string; rating: number } | null;
    events: Array<{ status: RideStatusLike; at: string }>;
  }> {
    return this.request(`/v1/driver/rides/${rideId}`);
  }

  rateClient(rideId: string, rating: number, comment?: string): Promise<unknown> {
    return this.request(`/v1/driver/rides/${rideId}/review`, {
      method: 'POST',
      body: { rating, ...(comment ? { comment } : {}) },
    });
  }

  wallet(): Promise<{ wallet: Wallet; rules: { minimumAmount: number; maximumAmount: number | null } }> {
    return this.request('/v1/driver/wallet');
  }

  walletTransactions(query: { limit?: number } = {}): Promise<{ items: WalletTransaction[] }> {
    return this.request('/v1/driver/wallet/transactions', { query });
  }

  earnings(query: { from?: string; to?: string } = {}): Promise<Earnings> {
    return this.request('/v1/driver/earnings', { query });
  }

  requestWithdrawal(body: {
    amount: number;
    method: 'mobile_money' | 'bank_transfer';
    destination: string;
  }): Promise<{ withdrawal: Withdrawal }> {
    return this.request('/v1/driver/withdrawals', { method: 'POST', body });
  }

  withdrawals(): Promise<{ items: Withdrawal[] }> {
    return this.request('/v1/driver/withdrawals');
  }

  driverNotifications(): Promise<{ items: AppNotification[] }> {
    return this.request('/v1/driver/notifications');
  }
}

type RideStatusLike = string;
