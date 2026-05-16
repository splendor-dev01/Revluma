-- ============================================================
-- REVLUMA COMPLETE PRODUCTION MIGRATION
-- Supabase / PostgreSQL Production Database
-- Consolidated from: Prisma schema + all SQL schema files
--   + all raw SQL references in JS backend files
-- Generated: 2026-05-16
--
-- EXECUTION ORDER:
--   Extensions → Enums → Tables (no FKs) → Tables (with FKs)
--   → Check Constraints → Indexes → Triggers/Functions → RLS → Seed
-- ============================================================

--------------------------------------------------------------------
-- SECTION 0 — INITIAL SAFETY & EXTENSIONS
--------------------------------------------------------------------
SET statement_timeout = '15min';
SET CONSTRAINTS ALL DEFERRED INITIALLY DEFERRED;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "btree_gist";

--------------------------------------------------------------------
-- SECTION 1 — ENUMS (created before any table references them)
--------------------------------------------------------------------

-- 1a. E-Commerce Platform
DO $$ BEGIN
  CREATE TYPE Platform AS ENUM ('SHOPIFY','WOOCOMMERCE','BIGCOMMERCE');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1b. Sync Job Resource
DO $$ BEGIN
  CREATE TYPE SyncResource AS ENUM ('CUSTOMERS','ORDERS','PRODUCTS','CHECKOUTS');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1c. Sync Job Status
DO $$ BEGIN
  CREATE TYPE SyncStatus AS ENUM ('PENDING','RUNNING','PAUSED','COMPLETE','FAILED');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1d. Credential Status
DO $$ BEGIN
  CREATE TYPE CredentialStatus AS ENUM ('ACTIVE','INVALID','REVOKED','PENDING_VERIFICATION');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1e. Webhook Event Status
DO $$ BEGIN
  CREATE TYPE WebhookEventStatus AS ENUM ('RECEIVED','PROCESSING','PROCESSED','FAILED','DUPLICATE','REJECTED');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1f. Checkout Status
DO $$ BEGIN
  CREATE TYPE CheckoutStatus AS ENUM ('ACTIVE','COMPLETED','ABANDONED','UNKNOWN');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1g. Recovery Event Type
DO $$ BEGIN
  CREATE TYPE RecoveryEventType AS ENUM ('sent','opened','clicked','recovered','purchase','abandoned');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1h. Recovery Channel
DO $$ BEGIN
  CREATE TYPE RecoveryChannel AS ENUM ('email','sms','whatsapp');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1i. Customer Status
DO $$ BEGIN
  CREATE TYPE CustomerStatus AS ENUM ('unknown','identified','verified','churned','merged');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1j. Identity Type
DO $$ BEGIN
  CREATE TYPE IdentityType AS ENUM (
    'anonymous_cookie','email','phone','device_fingerprint',
    'shopify_customer_id','klaviyo_profile_id'
  );
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1k. Event Source
DO $$ BEGIN
  CREATE TYPE EventSource AS ENUM ('shopify','tracking_script','klaviyo','internal','webhook');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1l. Notification Type
DO $$ BEGIN
  CREATE TYPE NotificationType AS ENUM ('cart_recovered','abandoned_cart','campaign','system');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1m. Automation Task Status
DO $$ BEGIN
  CREATE TYPE AutomationStatus AS ENUM ('pending','approved','executing','completed');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1n. Automation Task Priority
DO $$ BEGIN
  CREATE TYPE AutomationPriority AS ENUM ('low','medium','high');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1o. Newsletter Subscriber Status
DO $$ BEGIN
  CREATE TYPE NewsletterSubscriberStatus AS ENUM ('active','unsubscribed','bounced');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1p. Newsletter Send Status
DO $$ BEGIN
  CREATE TYPE NewsletterSendStatus AS ENUM ('queued','sending','sent','failed','completed');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1q. Newsletter Send Event Type
DO $$ BEGIN
  CREATE TYPE NewsletterSendEventType AS ENUM ('delivered','opened','clicked','bounced','unsubscribed');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1r. Abandoned Cart Status
DO $$ BEGIN
  CREATE TYPE AbandonedCartStatus AS ENUM (
    'new','sent1','sent2','sent3','sent4','sent5','recovered','expired'
  );
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1s. Churn Trigger Type
DO $$ BEGIN
  CREATE TYPE ChurnTriggerType AS ENUM ('inactivity_30d','no_repeat','low_engagement');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1t. Predicted Trend Status
DO $$ BEGIN
  CREATE TYPE PredictedTrendStatus AS ENUM ('exploding','rising','stable','declining');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1u. Sentiment Score
DO $$ BEGIN
  CREATE TYPE SentimentScore AS ENUM ('positive','neutral','negative','mixed');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1v. Store Config Status
DO $$ BEGIN
  CREATE TYPE StoreConfigStatus AS ENUM ('pending','connected','error','disconnected');
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

-- 1w–1x: SyncStatus and CheckoutStatus already created above

--------------------------------------------------------------------
-- SECTION 2 — CORE TABLES (no FK dependencies)
--------------------------------------------------------------------

-- ============================================================
-- TABLE: tenants
-- ============================================================
DROP TABLE IF EXISTS tenant_profiles, users, email_verification_codes,
  password_reset_tokens, password_history, user_sessions,
  pending_registrations, abandoned_carts, recovery_events,
  benchmarks, customer_crm, ltv_segments, churn_events,
  notifications, automation_tasks, newsletter_subscribers,
  newsletter_sends, newsletter_send_events, customers,
  customer_identities, customer_events, event_dlq,
  store_configs, sync_cursors, sync_jobs, webhook_registrations,
  platform_credentials, webhook_events, checkouts,
  trending_products, watchlist, internal_aggregated_sales,
  raw_trend_sources, events CASCADE;

-- Create a helper to set current tenant for RLS, before any RLS is enabled
-- so that the function always exists even if called during DDL
CREATE OR REPLACE FUNCTION set_current_tenant_id(tenant_uuid UUID)
RETURNS VOID AS $$
BEGIN
  PERFORM set_config('app.current_tenant_id', tenant_uuid::text, true);
END; $$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN current_setting('app.current_tenant_id')::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN '00000000-0000-0000-0000-000000000000'::UUID;
END; $$ LANGUAGE plpgsql STABLE;

CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_name      TEXT NOT NULL,
  industry        TEXT NOT NULL DEFAULT 'general',
  business_model  TEXT,
  onboarding_status   TEXT NOT NULL DEFAULT 'pending'
    CHECK (onboarding_status IN ('pending','started','step1','step2','step3','step4','step5','completed')),
  onboarding_completed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_onboarding   ON tenants (onboarding_status);
CREATE INDEX IF NOT EXISTS idx_tenants_industry     ON tenants (industry);

-- ============================================================
-- TABLE: users
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id                     UUID  PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID  NOT NULL,
  email                  TEXT  NOT NULL,
  password_hash          TEXT  NOT NULL,
  full_name              TEXT  NOT NULL,
  role                   TEXT  NOT NULL DEFAULT 'user'
    CHECK (role IN ('user','admin','owner')),
  onboarding_status     TEXT  NOT NULL DEFAULT 'started'
    CHECK (onboarding_status IN ('pending','started','step1','step2','step3','step4','step5','completed')),
  onboarding_completed_at TIMESTAMPTZ,
  email_verified         BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at      TIMESTAMPTZ,
  last_login_at          TIMESTAMPTZ,
  failed_login_attempts  INT    NOT NULL DEFAULT 0,
  locked_until           TIMESTAMPTZ,
  is_owner               BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_tenant          ON users (tenant_id);
CREATE INDEX idx_users_email           ON users (email);
CREATE INDEX idx_users_onboarding      ON users (onboarding_status);

-- ============================================================
-- TABLE: customers  (unified customer profile)
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       TEXT    NOT NULL,
  external_id     TEXT,
  status          TEXT    NOT NULL DEFAULT 'unknown'
    CHECK (status IN ('unknown','identified','verified','churned','merged')),
  merged_into     UUID,
  full_name       TEXT,
  email           TEXT,
  phone           TEXT,
  ltv             NUMERIC(12,2) DEFAULT 0,
  total_orders    INT     DEFAULT 0,
  last_order_date TIMESTAMPTZ,
  metadata        JSONB   DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, external_id)
);

CREATE UNIQUE INDEX idx_customers_tenant_external
  ON customers (tenant_id, external_id);
CREATE INDEX idx_customers_tenant_status
  ON customers (tenant_id, status);
CREATE INDEX idx_customers_tenant_email
  ON customers (tenant_id, email);

-- ============================================================
-- TABLE: tenant_profiles  (extended business config)
-- ============================================================
CREATE TABLE IF NOT EXISTS tenant_profiles (
  id                           UUID  PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id                    UUID  UNIQUE NOT NULL,
  industry                     TEXT,
  business_model               TEXT,
  target_market                JSONB,
  aov                          NUMERIC(12,2),
  purchase_frequency           INT,
  sales_channels               JSONB,
  payment_methods              JSONB,
  team_size                    INT,
  inventory_size               INT,
  fulfillment_speed            INT,
  growth_goals                 JSONB,
  brand_tone                   TEXT,
  maturity_score               INT   NOT NULL DEFAULT 0
    CHECK (maturity_score BETWEEN 0 AND 100),
  preferred_channel            TEXT  NOT NULL DEFAULT 'whatsapp'
    CHECK (preferred_channel IN ('email','sms','whatsapp')),
  touch1_delay                 INT   NOT NULL DEFAULT 15,
  touch2_delay                 INT   NOT NULL DEFAULT 90,
  discount_threshold           NUMERIC(5,2) NOT NULL DEFAULT 0.1,
  from_email                   TEXT,
  whatsapp_business_id         TEXT,
  platform                     TEXT,
  store_url                    TEXT,
  monthly_traffic              TEXT,
  monthly_revenue              TEXT,
  goals                        JSONB,
  preferred_recovery_channel   TEXT,
  onboarding_status           TEXT  NOT NULL DEFAULT 'started',
  onboarding_completed_at      TIMESTAMPTZ,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tenant_profiles
  ADD CONSTRAINT fk_tenant_profiles_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

--------------------------------------------------------------------
-- SECTION 3 — AUTH / SESSION TABLES
--------------------------------------------------------------------

-- ============================================================
-- TABLE: pending_registrations
-- ============================================================
CREATE TABLE IF NOT EXISTS pending_registrations (
  id                    UUID   PRIMARY KEY DEFAULT uuid_generate_v4(),
  email                 TEXT   NOT NULL,
  first_name            TEXT   NOT NULL,
  last_name             TEXT   NOT NULL,
  password_hash         TEXT   NOT NULL,
  verification_code_hash TEXT  NOT NULL,
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at     TIMESTAMPTZ,
  verification_expires_at TIMESTAMPTZ NOT NULL,
  onboarding_data       JSONB  NOT NULL DEFAULT '{}',
  step                  INT    NOT NULL DEFAULT 1,
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_pending_registrations_email
  ON pending_registrations (email);
CREATE INDEX idx_pending_registrations_expires
  ON pending_registrations (expires_at);

-- ============================================================
-- TABLE: email_verification_codes
-- ============================================================
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id        UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id   UUID    NOT NULL,
  email     TEXT    NOT NULL,
  code      TEXT    NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_verification_user  ON email_verification_codes (user_id);
CREATE INDEX idx_email_verification_email ON email_verification_codes (email);
CREATE INDEX idx_email_verification_code  ON email_verification_codes (code);

ALTER TABLE email_verification_codes
  ADD CONSTRAINT fk_email_verification_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- TABLE: password_reset_tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id            UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID   NOT NULL,
  token         TEXT   NOT NULL,
  code          TEXT   NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  ip_address    INET,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_reset_token  ON password_reset_tokens (token);
CREATE INDEX idx_password_reset_user   ON password_reset_tokens (user_id);

ALTER TABLE password_reset_tokens
  ADD CONSTRAINT fk_password_reset_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- TABLE: password_history
-- ============================================================
CREATE TABLE IF NOT EXISTS password_history (
  id            UUID   PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID   NOT NULL,
  password_hash TEXT   NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_history_user ON password_history (user_id);

ALTER TABLE password_history
  ADD CONSTRAINT fk_password_history_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ============================================================
-- TABLE: user_sessions  (single authoritative definition)
-- ============================================================
DROP TABLE IF EXISTS user_sessions CASCADE;

CREATE TABLE IF NOT EXISTS user_sessions (
  id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID    NOT NULL,
  token_hash TEXT    UNIQUE NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_token   ON user_sessions (token_hash);
CREATE INDEX idx_user_sessions_user    ON user_sessions (user_id);
CREATE INDEX idx_user_sessions_expires ON user_sessions (expires_at);

ALTER TABLE user_sessions
  ADD CONSTRAINT fk_user_sessions_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

--------------------------------------------------------------------
-- SECTION 4 — E-COMMERCE / INTEGRATION TABLES
--------------------------------------------------------------------

-- ============================================================
-- TABLE: store_configs
-- ============================================================
CREATE TABLE IF NOT EXISTS store_configs (
  id                       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                UUID    NOT NULL,
  platform                 Platform NOT NULL,
  store_name               TEXT    NOT NULL,
  store_url                TEXT    NOT NULL,
  callback_url             TEXT,
  credentials_encrypted    TEXT    NOT NULL,
  cart_tracking_mode       TEXT    NOT NULL DEFAULT 'plugin',
  abandonment_window_minutes INT  NOT NULL DEFAULT 60,
  status                   StoreConfigStatus NOT NULL DEFAULT 'pending',
  last_sync_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX  idx_store_configs_tenant_platform_url
  ON store_configs (tenant_id, platform, store_url);
CREATE INDEX idx_store_configs_tenant  ON store_configs (tenant_id);
CREATE INDEX idx_store_configs_status  ON store_configs (status);

ALTER TABLE store_configs
  ADD CONSTRAINT fk_store_configs_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ============================================================
-- TABLE: platform_credentials
-- ============================================================
CREATE TABLE IF NOT EXISTS platform_credentials (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id         UUID          UNIQUE NOT NULL,
  platform         Platform      NOT NULL,
  encrypted_payload TEXT         NOT NULL,
  iv               TEXT          NOT NULL,
  auth_tag         TEXT          NOT NULL,
  status           CredentialStatus NOT NULL DEFAULT 'ACTIVE',
  last_verified_at  TIMESTAMPTZ,
  failure_reason   TEXT,
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_platform_credentials_store
  ON platform_credentials (store_id);
CREATE INDEX idx_platform_credentials_platform_status
  ON platform_credentials (platform, status);

ALTER TABLE platform_credentials
  ADD CONSTRAINT fk_platform_credentials_store
  FOREIGN KEY (store_id) REFERENCES store_configs(id) ON DELETE CASCADE;

-- ============================================================
-- TABLE: webhook_registrations
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_registrations (
  id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id      UUID    NOT NULL,
  topic         TEXT    NOT NULL,
  webhook_id    TEXT,
  callback_url  TEXT    NOT NULL,
  secret        TEXT,
  secret_iv     TEXT,
  secret_auth_tag TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  registered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_webhook_registrations_store_topic
  ON webhook_registrations (store_id, topic);
CREATE INDEX idx_webhook_registrations_store
  ON webhook_registrations (store_id);

ALTER TABLE webhook_registrations
  ADD CONSTRAINT fk_webhook_registrations_store
  FOREIGN KEY (store_id) REFERENCES store_configs(id) ON DELETE CASCADE;

-- ============================================================
-- TABLE: webhook_events
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_events (
  id                UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          UUID            NOT NULL,
  platform          Platform        NOT NULL,
  topic             TEXT            NOT NULL,
  external_event_id TEXT,
  status            WebhookEventStatus NOT NULL DEFAULT 'RECEIVED',
  processing_error  TEXT,
  raw_payload       JSONB,
  received_at       TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  processed_at      TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_webhook_events_platform_store_external
  ON webhook_events (platform, store_id, external_event_id);
CREATE INDEX idx_webhook_events_store_status_received
  ON webhook_events (store_id, status, received_at);
CREATE INDEX idx_webhook_events_status_received
  ON webhook_events (status, received_at);

ALTER TABLE webhook_events
  ADD CONSTRAINT fk_webhook_events_store
  FOREIGN KEY (store_id) REFERENCES store_configs(id) ON DELETE CASCADE;

-- ============================================================
-- TABLE: sync_cursors
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_cursors (
  id             UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id       UUID    NOT NULL,
  resource       TEXT    NOT NULL,
  cursor         TEXT    NOT NULL,
  timestamp      TIMESTAMPTZ NOT NULL,
  processed_count INT   NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_sync_cursors_store_resource
  ON sync_cursors (store_id, resource);
CREATE INDEX idx_sync_cursors_store
  ON sync_cursors (store_id);

ALTER TABLE sync_cursors
  ADD CONSTRAINT fk_sync_cursors_store
  FOREIGN KEY (store_id) REFERENCES store_configs(id) ON DELETE CASCADE;

-- ============================================================
-- TABLE: sync_jobs
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_jobs (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id           UUID        NOT NULL,
  platform           Platform    NOT NULL,
  resource           SyncResource NOT NULL,
  status             SyncStatus  NOT NULL DEFAULT 'PENDING',
  cursor             JSONB,
