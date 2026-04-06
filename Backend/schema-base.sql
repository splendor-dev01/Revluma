-- Revluma Base Schema
-- Core tables required for all other schemas
-- Run this FIRST before any other schema files

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Tenants (organizations/stores)
CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  store_name TEXT NOT NULL,
  industry TEXT DEFAULT 'general',
  business_model TEXT,
  onboarding_status TEXT DEFAULT 'pending' CHECK (onboarding_status IN ('pending', 'started', 'step1', 'step2', 'step3', 'step4', 'step5', 'completed')),
  onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_tenants_onboarding ON tenants (onboarding_status);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  onboarding_status TEXT DEFAULT 'started' CHECK (onboarding_status IN ('pending', 'started', 'step1', 'step2', 'step3', 'step4', 'step5', 'completed')),
  onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  email_verified BOOLEAN DEFAULT FALSE,
  email_verified_at TIMESTAMP WITH TIME ZONE,
  role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'owner')),
  last_login_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_tenant ON users (tenant_id);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_onboarding ON users (onboarding_status);

-- RLS for tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_tenants ON tenants
  FOR ALL USING (true); -- Read-only for now, can add tenant-specific policies later

-- RLS for users  
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_users ON users
  FOR ALL USING (true); -- Read-only for now, can add tenant-specific policies later

-- 3. Tenant Profiles (extends tenant info with business details)
CREATE TABLE IF NOT EXISTS tenant_profiles (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  industry TEXT,
  business_model TEXT,
  target_market JSONB,
  aov NUMERIC(12,2),
  purchase_frequency INTEGER,
  sales_channels JSONB,
  payment_methods JSONB,
  team_size INTEGER,
  inventory_size INTEGER,
  fulfillment_speed INTEGER,
  growth_goals JSONB,
  brand_tone TEXT,
  maturity_score INTEGER DEFAULT 0 CHECK (maturity_score BETWEEN 0 AND 100),
  preferred_channel TEXT DEFAULT 'whatsapp' CHECK (preferred_channel IN ('email', 'sms', 'whatsapp')),
  touch1_delay INTEGER DEFAULT 15,
  touch2_delay INTEGER DEFAULT 90,
  discount_threshold NUMERIC DEFAULT 0.1,
  from_email TEXT,
  whatsapp_business_id TEXT,
  -- Onboarding fields
  platform TEXT,
  store_url TEXT,
  monthly_traffic TEXT,
  monthly_revenue TEXT,
  goals JSONB,
  preferred_recovery_channel TEXT,
  onboarding_status TEXT DEFAULT 'started',
  onboarding_completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add onboarding columns to existing tenants table if not present
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'pending';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE;

-- Add onboarding columns to existing users table if not present
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'started';
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE;

-- Create default tenant for system operations
INSERT INTO tenants (id, store_name, industry, onboarding_status)
VALUES ('00000000-0000-0000-0000-000000000000', 'System', 'internal', 'completed')
ON CONFLICT (id) DO NOTHING;

-- Grant necessary permissions (adjust for your security model)
-- Note: In production, you may want more restrictive permissions
GRANT USAGE ON SCHEMA public TO public;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO public;