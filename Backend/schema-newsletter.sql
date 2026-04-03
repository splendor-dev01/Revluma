-- ============================================================
-- NEWSLETTER SUBSCRIPTION SYSTEM - DATABASE SCHEMA
-- Production-ready with double opt-in, unsubscribe tokens,
-- proper indexing, and audit timestamps.
-- ============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- TABLE: newsletter_subscribers
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email           VARCHAR(255) NOT NULL,
    is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
    is_unsubscribed BOOLEAN NOT NULL DEFAULT FALSE,
    verify_token    VARCHAR(512),
    verify_expires  TIMESTAMPTZ,
    unsub_token     VARCHAR(512) NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
    source          VARCHAR(100) DEFAULT 'website',
    ip_address      INET,
    user_agent      TEXT,
    verified_at     TIMESTAMPTZ,
    unsubscribed_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique constraint: one email per subscriber (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_newsletter_email_unique
    ON newsletter_subscribers (LOWER(email));

-- Index for verified + active subscribers (used in send-update queries)
CREATE INDEX IF NOT EXISTS idx_newsletter_active_verified
    ON newsletter_subscribers (is_verified, is_unsubscribed)
    WHERE is_verified = TRUE AND is_unsubscribed = FALSE;

-- Index for verification token lookups
CREATE INDEX IF NOT EXISTS idx_newsletter_verify_token
    ON newsletter_subscribers (verify_token)
    WHERE verify_token IS NOT NULL;

-- Index for unsubscribe token lookups
CREATE INDEX IF NOT EXISTS idx_newsletter_unsub_token
    ON newsletter_subscribers (unsub_token);

-- Index for cleanup of expired unverified subscriptions
CREATE INDEX IF NOT EXISTS idx_newsletter_expired_unverified
    ON newsletter_subscribers (verify_expires)
    WHERE is_verified = FALSE AND verify_expires IS NOT NULL;

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_newsletter_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_newsletter_updated_at ON newsletter_subscribers;
CREATE TRIGGER trg_newsletter_updated_at
    BEFORE UPDATE ON newsletter_subscribers
    FOR EACH ROW
    EXECUTE FUNCTION update_newsletter_updated_at();

-- ============================================================
-- TABLE: newsletter_sends (analytics / audit log)
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_sends (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subject         VARCHAR(500) NOT NULL,
    content_html    TEXT,
    content_text    TEXT,
    total_recipients INTEGER NOT NULL DEFAULT 0,
    sent_count      INTEGER NOT NULL DEFAULT 0,
    failed_count    INTEGER NOT NULL DEFAULT 0,
    status          VARCHAR(50) NOT NULL DEFAULT 'pending',
    sent_by         VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

-- ============================================================
-- TABLE: newsletter_send_events (per-recipient delivery log)
-- ============================================================
CREATE TABLE IF NOT EXISTS newsletter_send_events (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    send_id         UUID NOT NULL REFERENCES newsletter_sends(id) ON DELETE CASCADE,
    subscriber_id   UUID NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    status          VARCHAR(50) NOT NULL DEFAULT 'queued',
    error_message   TEXT,
    sent_at         TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    opened_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_send_events_send_id
    ON newsletter_send_events (send_id);

CREATE INDEX IF NOT EXISTS idx_send_events_subscriber_id
    ON newsletter_send_events (subscriber_id);

CREATE INDEX IF NOT EXISTS idx_send_events_status
    ON newsletter_send_events (status);

-- ============================================================
-- HELPER: Get active subscriber count
-- ============================================================
CREATE OR REPLACE FUNCTION active_subscriber_count()
RETURNS INTEGER AS $$
    SELECT COUNT(*)::INTEGER FROM newsletter_subscribers
    WHERE is_verified = TRUE AND is_unsubscribed = FALSE;
$$ LANGUAGE SQL STABLE;
