/**
 * Types partagés entre l'application client, l'application chauffeur et l'API.
 *
 * Ils décrivent le contrat exposé par le backend (voir docs/api.md). Les noms
 * suivent la réponse HTTP, sans reformatage : ce que le serveur envoie est ce
 * que les applications lisent.
 */

export type AccountType = 'client' | 'driver';

/** États d'une course — §6 du cahier des charges. */
export type RideStatus =
  | 'requested'
  | 'searching'
  | 'driver_assigned'
  | 'driver_en_route'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'awaiting_payment'
  | 'paid'
  | 'rated'
  | 'cancelled'
  | 'expired';

export type PaymentMethod = 'cash' | 'mobile_money' | 'card' | 'wallet';

export type DriverStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type DriverAvailability = 'offline' | 'online' | 'on_ride';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface Place extends Coordinates {
  address?: string | null;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  account: { id: string; phone: string; type: AccountType; status?: DriverStatus };
  isNew: boolean;
}

export interface VehicleCategory {
  id: string;
  code: string;
  label: string;
  description: string | null;
  seats: number;
}

export interface FareBreakdown {
  baseFare: number;
  distanceAmount: number;
  timeAmount: number;
  subtotal: number;
  surgeAmount: number;
  minimumAdjustment: number;
  bookingFee: number;
  total: number;
  currency: string;
}

export interface EstimateOption {
  vehicleCategoryId: string;
  code: string;
  label: string;
  currency: string;
  total: number;
  detail: FareBreakdown;
}

export interface EstimateResponse {
  distanceMeters: number;
  durationSeconds: number;
  options: EstimateOption[];
}

export interface Ride {
  id: string;
  reference: string;
  status: RideStatus;
  pickup: Place;
  dropoff: Place;
  estimatedFare: number | null;
  finalFare: number | null;
  discount: number;
  cancellationFee: number;
  amountDue: number | null;
  currency: string;
  paymentMethod: PaymentMethod;
  driverId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RideDetail {
  ride: Ride;
  driver: { firstName: string; lastName: string; phone: string; rating: number } | null;
  vehicle: { make: string; model: string; color: string | null; plate_number: string } | null;
  events: Array<{ status: RideStatus; at: string; actor: string }>;
  payments: Array<{
    id: string;
    amount: number;
    method: PaymentMethod;
    status: string;
    reference: string | null;
  }>;
}

export interface ClientProfile {
  id: string;
  phone: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  rating: number;
  ridesCount: number;
  suspended: boolean;
  createdAt: string;
}

export interface DriverProfile {
  id: string;
  phone: string;
  firstName: string;
  lastName: string;
  status: DriverStatus;
  statusReason: string | null;
  availability: DriverAvailability;
  rating: number;
  ridesCount: number;
  acceptanceRate: number | null;
  activeVehicleId: string | null;
  wallet: { balance: number; currency: string } | null;
}

export interface RideOffer {
  offerId: string;
  rideId: string;
  reference: string;
  expiresAt: string;
  distanceMeters: number | null;
  etaSeconds: number | null;
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address: string | null;
  dropoff_latitude: number;
  dropoff_longitude: number;
  dropoff_address: string | null;
  estimated_fare: number | null;
  currency: string;
  payment_method: PaymentMethod;
}

export interface Wallet {
  driverId: string;
  balance: number;
  pendingBalance: number;
  totalEarned: number;
  totalCommission: number;
  totalWithdrawn: number;
  currency: string;
}

export interface WalletTransaction {
  id: string;
  entry_type: string;
  amount: number;
  balance_after: number;
  currency: string;
  description: string | null;
  created_at: string;
}

export interface Earnings {
  from: string;
  to: string;
  rides: number;
  grossFares: number;
  netEarnings: number;
  commission: number;
}

export interface Withdrawal {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  destination: string;
  created_at: string;
}

export interface SupportTicket {
  id: string;
  reference: string;
  category: string;
  subject: string;
  description: string;
  status: string;
  created_at: string;
}

export interface AppNotification {
  id: string;
  template: string;
  title: string;
  body: string;
  status: string;
  created_at: string;
  read_at: string | null;
}

export interface PromotionCheck {
  eligible: boolean;
  code?: string;
  label?: string;
  discount?: number;
  reason?: string;
}
