import type { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely';

/**
 * Typage du schéma défini dans migrations/*.sql.
 *
 * Ce fichier est la contrepartie TypeScript des migrations : toute évolution du
 * SQL doit s'y refléter. Il est volontairement écrit à la main plutôt que
 * généré — il sert aussi de description lisible du modèle de données (§18).
 */

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type TimestampNullable = ColumnType<Date | null, Date | string | null, Date | string | null>;
/** Les montants sont des BIGINT lus en `number` (voir db/index.ts, parseur pg int8). */
type Money = ColumnType<number, number | undefined, number>;
type Json = ColumnType<Record<string, unknown>, Record<string, unknown> | string | undefined, Record<string, unknown> | string>;

export type DriverStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
export type DriverAvailability = 'offline' | 'online' | 'on_ride';
export type AdminRole = 'super_admin' | 'operations' | 'support' | 'finance' | 'viewer';
export type DocumentStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type AccountType = 'client' | 'driver' | 'admin';
export type ActorType = 'client' | 'driver' | 'admin' | 'system';
export type PromotionType = 'percentage' | 'fixed';
export type PaymentMethod = 'cash' | 'wallet' | 'mobile_money' | 'card';
export type PaymentStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'refunded'
  | 'cancelled';
export type OfferStatus = 'offered' | 'accepted' | 'rejected' | 'expired' | 'cancelled';
export type WalletEntryType =
  | 'ride_earning'
  | 'commission'
  | 'cash_collected'
  | 'withdrawal'
  | 'withdrawal_reversal'
  | 'adjustment'
  | 'bonus'
  | 'refund_deduction';
export type WithdrawalStatus =
  | 'requested'
  | 'approved'
  | 'processing'
  | 'paid'
  | 'rejected'
  | 'failed';
export type TicketStatus = 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationChannel = 'push' | 'sms' | 'email' | 'in_app';
export type NotificationStatus = 'pending' | 'sent' | 'failed' | 'read';

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

export interface VehicleCategoriesTable {
  id: Generated<string>;
  code: string;
  label: string;
  description: string | null;
  seats: Generated<number>;
  sort_order: Generated<number>;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PricingRulesTable {
  id: Generated<string>;
  vehicle_category_id: string;
  zone_code: Generated<string>;
  currency: Generated<string>;
  base_fare: Money;
  per_km: Money;
  per_minute: Money;
  minimum_fare: Money;
  booking_fee: Money;
  cancellation_fee: Money;
  surge_bps: Generated<number>;
  commission_bps: Generated<number>;
  round_to_nearest: Generated<number>;
  effective_from: Timestamp;
  effective_to: TimestampNullable;
  is_active: Generated<boolean>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface PlatformSettingsTable {
  key: string;
  value: Json;
  description: string | null;
  updated_at: Timestamp;
  updated_by: string | null;
}

export interface UsersTable {
  id: Generated<string>;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  locale: Generated<string>;
  phone_verified_at: TimestampNullable;
  rating_average: Generated<number>;
  rating_count: Generated<number>;
  rides_count: Generated<number>;
  push_token: string | null;
  suspended_at: TimestampNullable;
  suspension_reason: string | null;
  deleted_at: TimestampNullable;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DriversTable {
  id: Generated<string>;
  phone: string;
  first_name: string;
  last_name: string;
  email: string | null;
  national_id: string | null;
  license_number: string | null;
  phone_verified_at: TimestampNullable;
  status: Generated<DriverStatus>;
  availability: Generated<DriverAvailability>;
  status_reason: string | null;
  approved_at: TimestampNullable;
  approved_by: string | null;
  active_vehicle_id: string | null;
  rating_average: Generated<number>;
  rating_count: Generated<number>;
  rides_count: Generated<number>;
  offers_received: Generated<number>;
  offers_accepted: Generated<number>;
  push_token: string | null;
  deleted_at: TimestampNullable;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface AdminUsersTable {
  id: Generated<string>;
  email: string;
  full_name: string;
  password_hash: string;
  role: Generated<AdminRole>;
  is_active: Generated<boolean>;
  last_login_at: TimestampNullable;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface VehiclesTable {
  id: Generated<string>;
  driver_id: string;
  vehicle_category_id: string;
  make: string;
  model: string;
  year: number | null;
  color: string | null;
  plate_number: string;
  seats: Generated<number>;
  is_verified: Generated<boolean>;
  deleted_at: TimestampNullable;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DriverDocumentsTable {
  id: Generated<string>;
  driver_id: string;
  vehicle_id: string | null;
  doc_type: string;
  file_url: string;
  number: string | null;
  issued_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
  expires_at: ColumnType<Date | null, string | Date | null, string | Date | null>;
  status: Generated<DocumentStatus>;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: TimestampNullable;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OtpCodesTable {
  id: Generated<string>;
  phone: string;
  account_type: AccountType;
  code_hash: string;
  attempts: Generated<number>;
  consumed_at: TimestampNullable;
  expires_at: Timestamp;
  request_ip: string | null;
  created_at: Timestamp;
}

export interface RefreshTokensTable {
  id: Generated<string>;
  subject_id: string;
  account_type: AccountType;
  token_hash: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: Timestamp;
  revoked_at: TimestampNullable;
  replaced_by: string | null;
  created_at: Timestamp;
}

export interface DriverLocationsTable {
  driver_id: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed_kmh: number | null;
  accuracy_m: number | null;
  recorded_at: Timestamp;
}

export interface PromotionsTable {
  id: Generated<string>;
  code: string;
  label: string;
  description: string | null;
  type: PromotionType;
  value: Money;
  max_discount: number | null;
  min_fare: Money;
  max_redemptions: number | null;
  max_per_user: Generated<number>;
  redemptions_count: Generated<number>;
  first_ride_only: Generated<boolean>;
  starts_at: Timestamp;
  ends_at: TimestampNullable;
  is_active: Generated<boolean>;
  created_by: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RidesTable {
  id: Generated<string>;
  reference: string;
  user_id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  vehicle_category_id: string;
  status: Generated<RideStatus>;
  pickup_latitude: number;
  pickup_longitude: number;
  pickup_address: string | null;
  dropoff_latitude: number;
  dropoff_longitude: number;
  dropoff_address: string | null;
  estimated_distance_m: number | null;
  estimated_duration_s: number | null;
  actual_distance_m: number | null;
  actual_duration_s: number | null;
  pricing_rule_id: string | null;
  pricing_snapshot: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | string | null,
    Record<string, unknown> | string | null
  >;
  currency: Generated<string>;
  estimated_fare: number | null;
  final_fare: number | null;
  discount_amount: Money;
  cancellation_fee: Money;
  platform_amount: Money;
  driver_amount: Money;
  commission_bps: number | null;
  promotion_id: string | null;
  payment_method: Generated<PaymentMethod>;
  requested_at: Timestamp;
  assigned_at: TimestampNullable;
  arrived_at: TimestampNullable;
  started_at: TimestampNullable;
  completed_at: TimestampNullable;
  paid_at: TimestampNullable;
  cancelled_at: TimestampNullable;
  cancelled_by: ActorType | null;
  cancellation_reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RideEventsTable {
  id: Generated<number>;
  ride_id: string;
  from_status: RideStatus | null;
  to_status: RideStatus;
  actor_type: ActorType;
  actor_id: string | null;
  latitude: number | null;
  longitude: number | null;
  context: Json;
  created_at: Timestamp;
}

export interface RideLocationsTable {
  id: Generated<number>;
  ride_id: string;
  driver_id: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed_kmh: number | null;
  recorded_at: Timestamp;
}

export interface RideOffersTable {
  id: Generated<string>;
  ride_id: string;
  driver_id: string;
  rank: number;
  distance_m: number | null;
  eta_seconds: number | null;
  score: number | null;
  status: Generated<OfferStatus>;
  expires_at: Timestamp;
  responded_at: TimestampNullable;
  created_at: Timestamp;
}

export interface PromotionRedemptionsTable {
  id: Generated<string>;
  promotion_id: string;
  user_id: string;
  ride_id: string;
  discount: Money;
  created_at: Timestamp;
}

export interface PaymentsTable {
  id: Generated<string>;
  ride_id: string;
  user_id: string;
  driver_id: string | null;
  amount: Money;
  currency: Generated<string>;
  method: PaymentMethod;
  status: Generated<PaymentStatus>;
  platform_amount: Money;
  driver_amount: Money;
  provider: string | null;
  provider_reference: string | null;
  provider_payload: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | string | null,
    Record<string, unknown> | string | null
  >;
  failure_reason: string | null;
  authorized_at: TimestampNullable;
  captured_at: TimestampNullable;
  refunded_amount: Money;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface RefundsTable {
  id: Generated<string>;
  payment_id: string;
  ride_id: string;
  amount: Money;
  reason: string;
  status: Generated<PaymentStatus>;
  issued_by: string | null;
  provider_reference: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DriverWalletsTable {
  driver_id: string;
  currency: Generated<string>;
  balance: Money;
  pending_balance: Money;
  total_earned: Money;
  total_commission: Money;
  total_withdrawn: Money;
  updated_at: Timestamp;
}

export interface WalletTransactionsTable {
  id: Generated<string>;
  driver_id: string;
  entry_type: WalletEntryType;
  amount: number;
  balance_after: number;
  currency: Generated<string>;
  ride_id: string | null;
  payment_id: string | null;
  withdrawal_id: string | null;
  description: string | null;
  created_by: string | null;
  created_at: Timestamp;
}

export interface WithdrawalsTable {
  id: Generated<string>;
  driver_id: string;
  amount: Money;
  currency: Generated<string>;
  status: Generated<WithdrawalStatus>;
  method: string;
  destination: string;
  provider_reference: string | null;
  reviewed_by: string | null;
  reviewed_at: TimestampNullable;
  failure_reason: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ReviewsTable {
  id: Generated<string>;
  ride_id: string;
  author_type: ActorType;
  author_id: string;
  subject_type: ActorType;
  subject_id: string;
  rating: number;
  comment: string | null;
  tags: Generated<string[]>;
  created_at: Timestamp;
}

export interface SupportTicketsTable {
  id: Generated<string>;
  reference: string;
  ride_id: string | null;
  reporter_type: ActorType;
  reporter_id: string;
  category: string;
  subject: string;
  description: string;
  status: Generated<TicketStatus>;
  priority: Generated<TicketPriority>;
  assigned_to: string | null;
  resolution: string | null;
  resolved_at: TimestampNullable;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SupportTicketMessagesTable {
  id: Generated<string>;
  ticket_id: string;
  author_type: ActorType;
  author_id: string | null;
  body: string;
  is_internal: Generated<boolean>;
  created_at: Timestamp;
}

export interface NotificationsTable {
  id: Generated<string>;
  recipient_type: ActorType;
  recipient_id: string;
  channel: Generated<NotificationChannel>;
  template: string;
  title: string;
  body: string;
  data: Json;
  ride_id: string | null;
  status: Generated<NotificationStatus>;
  failure_reason: string | null;
  sent_at: TimestampNullable;
  read_at: TimestampNullable;
  created_at: Timestamp;
}

export interface AuditLogsTable {
  id: Generated<number>;
  actor_type: ActorType;
  actor_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | string | null,
    Record<string, unknown> | string | null
  >;
  after: ColumnType<
    Record<string, unknown> | null,
    Record<string, unknown> | string | null,
    Record<string, unknown> | string | null
  >;
  ip: string | null;
  user_agent: string | null;
  created_at: Timestamp;
}

export interface SchemaMigrationsTable {
  name: string;
  checksum: string;
  applied_at: Timestamp;
}

export interface Database {
  vehicle_categories: VehicleCategoriesTable;
  pricing_rules: PricingRulesTable;
  platform_settings: PlatformSettingsTable;
  users: UsersTable;
  drivers: DriversTable;
  admin_users: AdminUsersTable;
  vehicles: VehiclesTable;
  driver_documents: DriverDocumentsTable;
  otp_codes: OtpCodesTable;
  refresh_tokens: RefreshTokensTable;
  driver_locations: DriverLocationsTable;
  promotions: PromotionsTable;
  rides: RidesTable;
  ride_events: RideEventsTable;
  ride_locations: RideLocationsTable;
  ride_offers: RideOffersTable;
  promotion_redemptions: PromotionRedemptionsTable;
  payments: PaymentsTable;
  refunds: RefundsTable;
  driver_wallets: DriverWalletsTable;
  wallet_transactions: WalletTransactionsTable;
  withdrawals: WithdrawalsTable;
  reviews: ReviewsTable;
  support_tickets: SupportTicketsTable;
  support_ticket_messages: SupportTicketMessagesTable;
  notifications: NotificationsTable;
  audit_logs: AuditLogsTable;
  schema_migrations: SchemaMigrationsTable;
}

export type User = Selectable<UsersTable>;
export type NewUser = Insertable<UsersTable>;
export type UserUpdate = Updateable<UsersTable>;
export type Driver = Selectable<DriversTable>;
export type NewDriver = Insertable<DriversTable>;
export type Ride = Selectable<RidesTable>;
export type NewRide = Insertable<RidesTable>;
export type Payment = Selectable<PaymentsTable>;
export type PricingRule = Selectable<PricingRulesTable>;
export type Promotion = Selectable<PromotionsTable>;
export type AdminUser = Selectable<AdminUsersTable>;
export type Vehicle = Selectable<VehiclesTable>;
export type Withdrawal = Selectable<WithdrawalsTable>;
export type SupportTicket = Selectable<SupportTicketsTable>;
