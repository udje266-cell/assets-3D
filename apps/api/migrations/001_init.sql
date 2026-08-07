-- ---------------------------------------------------------------------------
-- 001_init.sql — Schéma initial de la plateforme de mobilité
-- Couvre le §18 du cahier des charges (tables principales) et les tables
-- techniques nécessaires à l'audit, à l'attribution et à la comptabilité.
--
-- Conventions :
--   * identifiants : UUID (gen_random_uuid(), natif depuis PostgreSQL 13)
--   * montants     : BIGINT en unités entières de la devise (le FCFA n'a pas
--                    de sous-unité) — jamais de flottant sur de l'argent
--   * horodatages  : TIMESTAMPTZ, toujours en UTC
--   * suppression  : logique (deleted_at / suspended_at), jamais physique sur
--                    les entités portant un historique financier
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- Référentiels
-- ===========================================================================

-- Catégories de véhicules (§7 : « différentes catégories de véhicules »)
CREATE TABLE vehicle_categories (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code          TEXT NOT NULL UNIQUE,            -- eco, confort, van, moto...
    label         TEXT NOT NULL,
    description   TEXT,
    seats         INTEGER NOT NULL DEFAULT 4 CHECK (seats > 0),
    sort_order    INTEGER NOT NULL DEFAULT 0,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grilles tarifaires (§7) — configurables depuis l'administration, sans mise à
-- jour applicative. Une grille par catégorie et par zone, versionnée par dates
-- d'effet afin de ne jamais réécrire l'historique de facturation.
CREATE TABLE pricing_rules (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_category_id   UUID NOT NULL REFERENCES vehicle_categories(id),
    zone_code             TEXT NOT NULL DEFAULT 'default',
    currency              TEXT NOT NULL DEFAULT 'XOF',

    base_fare             BIGINT NOT NULL DEFAULT 0 CHECK (base_fare >= 0),
    per_km                BIGINT NOT NULL DEFAULT 0 CHECK (per_km >= 0),
    per_minute            BIGINT NOT NULL DEFAULT 0 CHECK (per_minute >= 0),
    minimum_fare          BIGINT NOT NULL DEFAULT 0 CHECK (minimum_fare >= 0),
    booking_fee           BIGINT NOT NULL DEFAULT 0 CHECK (booking_fee >= 0),
    cancellation_fee      BIGINT NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0),
    -- tarification dynamique (§20) : multiplicateur en points de base
    -- (10000 = ×1.00) pour rester en arithmétique entière
    surge_bps             INTEGER NOT NULL DEFAULT 10000 CHECK (surge_bps >= 10000),
    -- commission plateforme (§8) en points de base : 2000 = 20 %
    commission_bps        INTEGER NOT NULL DEFAULT 2000
                          CHECK (commission_bps BETWEEN 0 AND 10000),
    -- arrondi du prix affiché (le FCFA se règle usuellement au multiple de 5)
    round_to_nearest      INTEGER NOT NULL DEFAULT 5 CHECK (round_to_nearest >= 1),

    effective_from        TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to          TIMESTAMPTZ,
    is_active             BOOLEAN NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX pricing_rules_lookup_idx
    ON pricing_rules (vehicle_category_id, zone_code, is_active, effective_from DESC);

-- Paramètres de plateforme modifiables sans redéploiement
CREATE TABLE platform_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID
);

-- ===========================================================================
-- Comptes
-- ===========================================================================

-- USERS : clients de la plateforme (§3 — inscription par téléphone + OTP)
CREATE TABLE users (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone             TEXT NOT NULL UNIQUE,        -- format E.164, ex. +2250700000001
    first_name        TEXT,
    last_name         TEXT,
    email             TEXT,                        -- facultatif (§3)
    locale            TEXT NOT NULL DEFAULT 'fr',
    phone_verified_at TIMESTAMPTZ,
    rating_average    NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (rating_average BETWEEN 0 AND 5),
    rating_count      INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
    rides_count       INTEGER NOT NULL DEFAULT 0 CHECK (rides_count >= 0),
    push_token        TEXT,
    suspended_at      TIMESTAMPTZ,
    suspension_reason TEXT,
    deleted_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_unique_idx ON users (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX users_created_at_idx ON users (created_at DESC);

-- DRIVERS : chauffeurs (§5)
CREATE TYPE driver_status AS ENUM ('pending', 'approved', 'rejected', 'suspended');
CREATE TYPE driver_availability AS ENUM ('offline', 'online', 'on_ride');

CREATE TABLE drivers (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone                 TEXT NOT NULL UNIQUE,
    first_name            TEXT NOT NULL,
    last_name             TEXT NOT NULL,
    email                 TEXT,
    national_id           TEXT,
    license_number        TEXT,
    phone_verified_at     TIMESTAMPTZ,

    status                driver_status NOT NULL DEFAULT 'pending',
    availability          driver_availability NOT NULL DEFAULT 'offline',
    status_reason         TEXT,
    approved_at           TIMESTAMPTZ,
    approved_by           UUID,

    active_vehicle_id     UUID,                    -- FK ajoutée après vehicles
    rating_average        NUMERIC(3,2) NOT NULL DEFAULT 0 CHECK (rating_average BETWEEN 0 AND 5),
    rating_count          INTEGER NOT NULL DEFAULT 0 CHECK (rating_count >= 0),
    rides_count           INTEGER NOT NULL DEFAULT 0 CHECK (rides_count >= 0),
    offers_received       INTEGER NOT NULL DEFAULT 0 CHECK (offers_received >= 0),
    offers_accepted       INTEGER NOT NULL DEFAULT 0 CHECK (offers_accepted >= 0),

    push_token            TEXT,
    deleted_at            TIMESTAMPTZ,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX drivers_status_idx ON drivers (status, availability);
CREATE INDEX drivers_created_at_idx ON drivers (created_at DESC);

-- ADMIN_USERS : accès à l'administration web (§14)
CREATE TYPE admin_role AS ENUM ('super_admin', 'operations', 'support', 'finance', 'viewer');

CREATE TABLE admin_users (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email          TEXT NOT NULL,
    full_name      TEXT NOT NULL,
    password_hash  TEXT NOT NULL,
    role           admin_role NOT NULL DEFAULT 'viewer',
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_users_email_idx ON admin_users (lower(email));

-- VEHICLES (§5)
CREATE TABLE vehicles (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id           UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    vehicle_category_id UUID NOT NULL REFERENCES vehicle_categories(id),
    make                TEXT NOT NULL,
    model               TEXT NOT NULL,
    year                INTEGER CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
    color               TEXT,
    plate_number        TEXT NOT NULL,
    seats               INTEGER NOT NULL DEFAULT 4 CHECK (seats > 0),
    is_verified         BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX vehicles_plate_idx ON vehicles (upper(plate_number)) WHERE deleted_at IS NULL;
CREATE INDEX vehicles_driver_idx ON vehicles (driver_id);

ALTER TABLE drivers
    ADD CONSTRAINT drivers_active_vehicle_fk
    FOREIGN KEY (active_vehicle_id) REFERENCES vehicles(id) ON DELETE SET NULL;

-- DRIVER_DOCUMENTS (§5) — les types exigibles dépendent de la réglementation
-- applicable (§28) : la liste est donc une donnée, pas une contrainte figée.
CREATE TYPE document_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE driver_documents (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id      UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    vehicle_id     UUID REFERENCES vehicles(id) ON DELETE CASCADE,
    doc_type       TEXT NOT NULL,                  -- identity, license, insurance, registration...
    file_url       TEXT NOT NULL,
    number         TEXT,
    issued_at      DATE,
    expires_at     DATE,
    status         document_status NOT NULL DEFAULT 'pending',
    review_note    TEXT,
    reviewed_by    UUID REFERENCES admin_users(id),
    reviewed_at    TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX driver_documents_driver_idx ON driver_documents (driver_id, status);
CREATE INDEX driver_documents_expiry_idx ON driver_documents (expires_at)
    WHERE status = 'approved' AND expires_at IS NOT NULL;

-- ===========================================================================
-- Authentification
-- ===========================================================================

CREATE TYPE account_type AS ENUM ('client', 'driver', 'admin');

-- Codes OTP : jamais stockés en clair (§12)
CREATE TABLE otp_codes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone         TEXT NOT NULL,
    account_type  account_type NOT NULL,
    code_hash     TEXT NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    consumed_at   TIMESTAMPTZ,
    expires_at    TIMESTAMPTZ NOT NULL,
    request_ip    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX otp_codes_lookup_idx ON otp_codes (phone, account_type, created_at DESC);

-- Jetons de rafraîchissement : persistés pour être révocables et rotatifs
CREATE TABLE refresh_tokens (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject_id    UUID NOT NULL,
    account_type  account_type NOT NULL,
    token_hash    TEXT NOT NULL UNIQUE,
    user_agent    TEXT,
    ip            TEXT,
    expires_at    TIMESTAMPTZ NOT NULL,
    revoked_at    TIMESTAMPTZ,
    replaced_by   UUID REFERENCES refresh_tokens(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_subject_idx ON refresh_tokens (subject_id, account_type);

-- ===========================================================================
-- Géolocalisation (§4)
-- ===========================================================================

-- Dernière position connue de chaque chauffeur (une ligne par chauffeur)
CREATE TABLE driver_locations (
    driver_id   UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
    latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    heading     DOUBLE PRECISION,
    speed_kmh   DOUBLE PRECISION,
    accuracy_m  DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index destiné au filtre par cadre englobant précédant le calcul haversine.
-- Migration vers PostGIS (geography + GIST + ST_DWithin) prévue si le volume
-- l'exige : seul services/dispatch.ts est concerné.
CREATE INDEX driver_locations_bbox_idx ON driver_locations (latitude, longitude);
CREATE INDEX driver_locations_recorded_idx ON driver_locations (recorded_at DESC);

-- ===========================================================================
-- Promotions (§13)
-- ===========================================================================

CREATE TYPE promotion_type AS ENUM ('percentage', 'fixed');

CREATE TABLE promotions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code                TEXT NOT NULL,
    label               TEXT NOT NULL,
    description         TEXT,
    type                promotion_type NOT NULL,
    -- percentage : points de base (2000 = 20 %) ; fixed : montant entier
    value               BIGINT NOT NULL CHECK (value > 0),
    max_discount        BIGINT CHECK (max_discount IS NULL OR max_discount > 0),
    min_fare            BIGINT NOT NULL DEFAULT 0 CHECK (min_fare >= 0),
    max_redemptions     INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
    max_per_user        INTEGER NOT NULL DEFAULT 1 CHECK (max_per_user > 0),
    redemptions_count   INTEGER NOT NULL DEFAULT 0 CHECK (redemptions_count >= 0),
    first_ride_only     BOOLEAN NOT NULL DEFAULT FALSE,
    starts_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at             TIMESTAMPTZ,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    created_by          UUID REFERENCES admin_users(id),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (ends_at IS NULL OR ends_at > starts_at),
    CHECK (type <> 'percentage' OR value <= 10000)
);

CREATE UNIQUE INDEX promotions_code_idx ON promotions (upper(code));

-- ===========================================================================
-- Courses (§6)
-- ===========================================================================

CREATE TYPE ride_status AS ENUM (
    'requested',
    'searching',
    'driver_assigned',
    'driver_en_route',
    'driver_arrived',
    'in_progress',
    'completed',
    'awaiting_payment',
    'paid',
    'rated',
    'cancelled',
    'expired'
);

CREATE TYPE payment_method AS ENUM ('cash', 'wallet', 'mobile_money', 'card');
CREATE TYPE actor_type AS ENUM ('client', 'driver', 'admin', 'system');

CREATE TABLE rides (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- identifiant unique lisible exigé au §18, exposé aux utilisateurs
    reference             TEXT NOT NULL UNIQUE,

    user_id               UUID NOT NULL REFERENCES users(id),
    driver_id             UUID REFERENCES drivers(id),
    vehicle_id            UUID REFERENCES vehicles(id),
    vehicle_category_id   UUID NOT NULL REFERENCES vehicle_categories(id),

    status                ride_status NOT NULL DEFAULT 'requested',

    pickup_latitude       DOUBLE PRECISION NOT NULL CHECK (pickup_latitude BETWEEN -90 AND 90),
    pickup_longitude      DOUBLE PRECISION NOT NULL CHECK (pickup_longitude BETWEEN -180 AND 180),
    pickup_address        TEXT,
    dropoff_latitude      DOUBLE PRECISION NOT NULL CHECK (dropoff_latitude BETWEEN -90 AND 90),
    dropoff_longitude     DOUBLE PRECISION NOT NULL CHECK (dropoff_longitude BETWEEN -180 AND 180),
    dropoff_address       TEXT,

    estimated_distance_m  INTEGER CHECK (estimated_distance_m >= 0),
    estimated_duration_s  INTEGER CHECK (estimated_duration_s >= 0),
    actual_distance_m     INTEGER CHECK (actual_distance_m >= 0),
    actual_duration_s     INTEGER CHECK (actual_duration_s >= 0),

    -- Tarification figée sur la course : une modification de grille en
    -- administration ne réécrit jamais l'historique facturé.
    pricing_rule_id       UUID REFERENCES pricing_rules(id),
    pricing_snapshot      JSONB,
    currency              TEXT NOT NULL DEFAULT 'XOF',

    estimated_fare        BIGINT CHECK (estimated_fare >= 0),
    final_fare            BIGINT CHECK (final_fare >= 0),
    discount_amount       BIGINT NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    cancellation_fee      BIGINT NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0),
    -- §8 : montants enregistrés séparément pour la comptabilité
    platform_amount       BIGINT NOT NULL DEFAULT 0 CHECK (platform_amount >= 0),
    driver_amount         BIGINT NOT NULL DEFAULT 0 CHECK (driver_amount >= 0),
    commission_bps        INTEGER CHECK (commission_bps BETWEEN 0 AND 10000),

    promotion_id          UUID REFERENCES promotions(id),
    payment_method        payment_method NOT NULL DEFAULT 'cash',

    requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    assigned_at           TIMESTAMPTZ,
    arrived_at            TIMESTAMPTZ,
    started_at            TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    paid_at               TIMESTAMPTZ,
    cancelled_at          TIMESTAMPTZ,
    cancelled_by          actor_type,
    cancellation_reason   TEXT,

    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX rides_user_idx ON rides (user_id, created_at DESC);
CREATE INDEX rides_driver_idx ON rides (driver_id, created_at DESC);
CREATE INDEX rides_status_idx ON rides (status, created_at DESC);
CREATE INDEX rides_created_at_idx ON rides (created_at DESC);
-- Un chauffeur ne peut avoir qu'une seule course active à la fois
CREATE UNIQUE INDEX rides_one_active_per_driver_idx ON rides (driver_id)
    WHERE driver_id IS NOT NULL
      AND status IN ('driver_assigned', 'driver_en_route', 'driver_arrived', 'in_progress');
-- Un client ne peut avoir qu'une seule course en cours à la fois
CREATE UNIQUE INDEX rides_one_active_per_user_idx ON rides (user_id)
    WHERE status IN ('requested', 'searching', 'driver_assigned', 'driver_en_route',
                     'driver_arrived', 'in_progress');

-- RIDE_EVENTS : journal des transitions (§6 « chaque changement d'état doit
-- être enregistré côté serveur »). Table en ajout seul.
CREATE TABLE ride_events (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ride_id       UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    from_status   ride_status,
    to_status     ride_status NOT NULL,
    actor_type    actor_type NOT NULL,
    actor_id      UUID,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    context       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_events_ride_idx ON ride_events (ride_id, created_at);

-- RIDE_LOCATIONS : trace de la position du chauffeur pendant la course (§4)
CREATE TABLE ride_locations (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ride_id     UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id   UUID NOT NULL REFERENCES drivers(id),
    latitude    DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude   DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    heading     DOUBLE PRECISION,
    speed_kmh   DOUBLE PRECISION,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ride_locations_ride_idx ON ride_locations (ride_id, recorded_at);

-- RIDE_OFFERS : attribution séquentielle (§19), source du taux d'acceptation (§24)
CREATE TYPE offer_status AS ENUM ('offered', 'accepted', 'rejected', 'expired', 'cancelled');

CREATE TABLE ride_offers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id       UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    driver_id     UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    rank          INTEGER NOT NULL CHECK (rank >= 0),
    distance_m    INTEGER CHECK (distance_m >= 0),
    eta_seconds   INTEGER CHECK (eta_seconds >= 0),
    score         DOUBLE PRECISION,
    status        offer_status NOT NULL DEFAULT 'offered',
    expires_at    TIMESTAMPTZ NOT NULL,
    responded_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ride_offers_unique_idx ON ride_offers (ride_id, driver_id);
CREATE INDEX ride_offers_driver_idx ON ride_offers (driver_id, status, created_at DESC);
CREATE INDEX ride_offers_pending_idx ON ride_offers (status, expires_at) WHERE status = 'offered';

-- Utilisations des promotions (§13 : nombre d'utilisations, utilisateurs concernés)
CREATE TABLE promotion_redemptions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id   UUID NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ride_id        UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    discount       BIGINT NOT NULL CHECK (discount >= 0),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX promotion_redemptions_ride_idx ON promotion_redemptions (ride_id);
CREATE INDEX promotion_redemptions_user_idx ON promotion_redemptions (promotion_id, user_id);

-- ===========================================================================
-- Paiements (§9)
-- ===========================================================================

CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'refunded', 'cancelled');

CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id             UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    user_id             UUID NOT NULL REFERENCES users(id),
    driver_id           UUID REFERENCES drivers(id),

    amount              BIGINT NOT NULL CHECK (amount >= 0),
    currency            TEXT NOT NULL DEFAULT 'XOF',
    method              payment_method NOT NULL,
    status              payment_status NOT NULL DEFAULT 'pending',

    -- §8 : commission et part chauffeur enregistrées séparément
    platform_amount     BIGINT NOT NULL DEFAULT 0 CHECK (platform_amount >= 0),
    driver_amount       BIGINT NOT NULL DEFAULT 0 CHECK (driver_amount >= 0),

    provider            TEXT,                       -- nom du prestataire (§9)
    provider_reference  TEXT,                       -- identifiant de transaction externe
    provider_payload    JSONB,
    failure_reason      TEXT,

    authorized_at       TIMESTAMPTZ,
    captured_at         TIMESTAMPTZ,
    refunded_amount     BIGINT NOT NULL DEFAULT 0 CHECK (refunded_amount >= 0),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

    CHECK (refunded_amount <= amount)
);

CREATE INDEX payments_ride_idx ON payments (ride_id);
CREATE INDEX payments_user_idx ON payments (user_id, created_at DESC);
CREATE INDEX payments_status_idx ON payments (status, created_at DESC);
CREATE UNIQUE INDEX payments_provider_ref_idx ON payments (provider, provider_reference)
    WHERE provider_reference IS NOT NULL;

CREATE TABLE refunds (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id     UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    ride_id        UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    amount         BIGINT NOT NULL CHECK (amount > 0),
    reason         TEXT NOT NULL,
    status         payment_status NOT NULL DEFAULT 'pending',
    issued_by      UUID REFERENCES admin_users(id),
    provider_reference TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refunds_payment_idx ON refunds (payment_id);

-- ===========================================================================
-- Portefeuille chauffeur (§10)
-- ===========================================================================

CREATE TABLE driver_wallets (
    driver_id        UUID PRIMARY KEY REFERENCES drivers(id) ON DELETE CASCADE,
    currency         TEXT NOT NULL DEFAULT 'XOF',
    -- solde disponible ; peut être négatif lorsque le chauffeur doit des
    -- commissions sur des courses encaissées en espèces (§8, §9)
    balance          BIGINT NOT NULL DEFAULT 0,
    pending_balance  BIGINT NOT NULL DEFAULT 0 CHECK (pending_balance >= 0),
    total_earned     BIGINT NOT NULL DEFAULT 0 CHECK (total_earned >= 0),
    total_commission BIGINT NOT NULL DEFAULT 0 CHECK (total_commission >= 0),
    total_withdrawn  BIGINT NOT NULL DEFAULT 0 CHECK (total_withdrawn >= 0),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Grand livre en ajout seul : aucun solde ne bouge sans écriture
CREATE TYPE wallet_entry_type AS ENUM (
    'ride_earning',        -- part chauffeur créditée (paiement électronique)
    'commission',          -- commission due sur une course encaissée en espèces
    'cash_collected',      -- espèces encaissées par le chauffeur (dette envers la plateforme)
    'withdrawal',          -- retrait
    'withdrawal_reversal', -- retrait échoué, remis au solde
    'adjustment',          -- correction manuelle par un administrateur
    'bonus',               -- prime
    'refund_deduction'     -- remboursement client imputé au chauffeur
);

CREATE TABLE wallet_transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id       UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    entry_type      wallet_entry_type NOT NULL,
    -- signé : positif = crédit, négatif = débit
    amount          BIGINT NOT NULL,
    balance_after   BIGINT NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'XOF',
    ride_id         UUID REFERENCES rides(id) ON DELETE SET NULL,
    payment_id      UUID REFERENCES payments(id) ON DELETE SET NULL,
    withdrawal_id   UUID,                            -- FK ajoutée après withdrawals
    description     TEXT,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX wallet_transactions_driver_idx ON wallet_transactions (driver_id, created_at DESC);
CREATE INDEX wallet_transactions_ride_idx ON wallet_transactions (ride_id);
-- Idempotence comptable : une seule écriture de gain et une seule de commission
-- par course, quelle que soit le nombre de tentatives de règlement.
CREATE UNIQUE INDEX wallet_transactions_ride_entry_idx
    ON wallet_transactions (ride_id, entry_type)
    WHERE ride_id IS NOT NULL
      AND entry_type IN ('ride_earning', 'commission', 'cash_collected');

CREATE TYPE withdrawal_status AS ENUM ('requested', 'approved', 'processing', 'paid', 'rejected', 'failed');

CREATE TABLE withdrawals (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    driver_id          UUID NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
    amount             BIGINT NOT NULL CHECK (amount > 0),
    currency           TEXT NOT NULL DEFAULT 'XOF',
    status             withdrawal_status NOT NULL DEFAULT 'requested',
    method             TEXT NOT NULL,               -- mobile_money, bank_transfer...
    destination        TEXT NOT NULL,               -- numéro / IBAN masqué
    provider_reference TEXT,
    reviewed_by        UUID REFERENCES admin_users(id),
    reviewed_at        TIMESTAMPTZ,
    failure_reason     TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX withdrawals_driver_idx ON withdrawals (driver_id, created_at DESC);
CREATE INDEX withdrawals_status_idx ON withdrawals (status, created_at DESC);

ALTER TABLE wallet_transactions
    ADD CONSTRAINT wallet_transactions_withdrawal_fk
    FOREIGN KEY (withdrawal_id) REFERENCES withdrawals(id) ON DELETE SET NULL;

-- ===========================================================================
-- Notation et signalement (§11)
-- ===========================================================================

CREATE TABLE reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ride_id         UUID NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
    author_type     actor_type NOT NULL CHECK (author_type IN ('client', 'driver')),
    author_id       UUID NOT NULL,
    subject_type    actor_type NOT NULL CHECK (subject_type IN ('client', 'driver')),
    subject_id      UUID NOT NULL,
    rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment         TEXT,
    tags            TEXT[] NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une seule évaluation par course et par auteur
CREATE UNIQUE INDEX reviews_ride_author_idx ON reviews (ride_id, author_type);
CREATE INDEX reviews_subject_idx ON reviews (subject_type, subject_id, created_at DESC);

-- ===========================================================================
-- Litiges et assistance (§15)
-- ===========================================================================

CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'waiting_user', 'resolved', 'closed');
CREATE TYPE ticket_priority AS ENUM ('low', 'normal', 'high', 'urgent');

CREATE TABLE support_tickets (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference        TEXT NOT NULL UNIQUE,
    ride_id          UUID REFERENCES rides(id) ON DELETE SET NULL,
    reporter_type    actor_type NOT NULL CHECK (reporter_type IN ('client', 'driver')),
    reporter_id      UUID NOT NULL,
    category         TEXT NOT NULL,   -- driver_no_show, wrong_price, payment, lost_item, incident, other
    subject          TEXT NOT NULL,
    description      TEXT NOT NULL,
    status           ticket_status NOT NULL DEFAULT 'open',
    priority         ticket_priority NOT NULL DEFAULT 'normal',
    assigned_to      UUID REFERENCES admin_users(id),
    resolution       TEXT,
    resolved_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX support_tickets_status_idx ON support_tickets (status, priority, created_at DESC);
CREATE INDEX support_tickets_reporter_idx ON support_tickets (reporter_type, reporter_id);
CREATE INDEX support_tickets_ride_idx ON support_tickets (ride_id);

CREATE TABLE support_ticket_messages (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id     UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_type   actor_type NOT NULL,
    author_id     UUID,
    body          TEXT NOT NULL,
    is_internal   BOOLEAN NOT NULL DEFAULT FALSE,  -- note interne, invisible du déclarant
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX support_ticket_messages_ticket_idx ON support_ticket_messages (ticket_id, created_at);

-- ===========================================================================
-- Notifications (§16)
-- ===========================================================================

CREATE TYPE notification_channel AS ENUM ('push', 'sms', 'email', 'in_app');
CREATE TYPE notification_status AS ENUM ('pending', 'sent', 'failed', 'read');

CREATE TABLE notifications (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_type actor_type NOT NULL CHECK (recipient_type IN ('client', 'driver', 'admin')),
    recipient_id   UUID NOT NULL,
    channel        notification_channel NOT NULL DEFAULT 'push',
    template       TEXT NOT NULL,       -- driver_found, driver_arrived, ride_started...
    title          TEXT NOT NULL,
    body           TEXT NOT NULL,
    data           JSONB NOT NULL DEFAULT '{}'::jsonb,
    ride_id        UUID REFERENCES rides(id) ON DELETE SET NULL,
    status         notification_status NOT NULL DEFAULT 'pending',
    failure_reason TEXT,
    sent_at        TIMESTAMPTZ,
    read_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX notifications_recipient_idx
    ON notifications (recipient_type, recipient_id, created_at DESC);
CREATE INDEX notifications_status_idx ON notifications (status) WHERE status = 'pending';

-- ===========================================================================
-- Audit (§12 : journalisation des événements importants)
-- ===========================================================================

CREATE TABLE audit_logs (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_type    actor_type NOT NULL,
    actor_id      UUID,
    action        TEXT NOT NULL,        -- driver.approve, pricing.update, refund.issue...
    entity_type   TEXT NOT NULL,
    entity_id     TEXT,
    before        JSONB,
    after         JSONB,
    ip            TEXT,
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_type, actor_id, created_at DESC);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC);

-- ===========================================================================
-- Déclencheur générique de mise à jour de updated_at
-- ===========================================================================

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'vehicle_categories', 'pricing_rules', 'users', 'drivers', 'admin_users',
        'vehicles', 'driver_documents', 'promotions', 'rides', 'payments',
        'refunds', 'withdrawals', 'support_tickets'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
    END LOOP;
END;
$$;
