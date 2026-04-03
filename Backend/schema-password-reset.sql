-- ============================================================
-- PASSWORD RESET TOKENS SCHEMA
-- Stores secure password reset tokens with expiration
-- ============================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table for password reset tokens
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    token          VARCHAR(512) NOT NULL,
    code           VARCHAR(255) NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    used_at        TIMESTAMPTZ,
    ip_address     INET,
    user_agent     TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for token lookups
CREATE INDEX IF NOT EXISTS idx_password_reset_token
    ON password_reset_tokens (token);

-- Index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_password_reset_user
    ON password_reset_tokens (user_id);

-- Password history table (prevents password reuse)
CREATE TABLE IF NOT EXISTS password_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_history_user
    ON password_history (user_id);

-- User sessions table (for invalidating sessions on password reset)
CREATE TABLE IF NOT EXISTS user_sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL,
    token          VARCHAR(512) NOT NULL,
    expires_at     TIMESTAMPTZ NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_token
    ON user_sessions (token);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user
    ON user_sessions (user_id);