-- Revluma Cart Recovery Schema
-- Run after schema-trending.sql

-- 1. Abandoned carts (core)
CREATE TABLE IF NOT EXISTS abandoned_carts (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  external_cart_id TEXT UNIQUE NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  cart_value NUMERIC(12,2) NOT NULL,
  currency TEXT DEFAULT 'USD',
  items JSONB NOT NULL,
  abandonment_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  intent_score INTEGER CHECK (intent_score BETWEEN 0 AND 100),
  status TEXT DEFAULT 'new' CHECK (status IN ('new', 'sent1', 'sent2', 'sent3', 'sent4', 'sent5', 'recovered', 'expired')),
  session_duration_seconds INTEGER,
  scroll_depth_percentage INTEGER CHECK (scroll_depth_percentage BETWEEN 0 AND 100),
  add_remove_actions INTEGER,
  repeat_visits INTEGER DEFAULT 1,
  device_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_abandoned_tenant_time ON abandoned_carts (tenant_id, abandonment_at DESC);
CREATE INDEX idx_abandoned_status ON abandoned_carts (status);
CREATE INDEX idx_abandoned_intent ON abandoned_carts (intent_score DESC);

-- 2. Recovery events (audit)
CREATE TABLE IF NOT EXISTS recovery_events (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  abandoned_cart_id INTEGER REFERENCES abandoned_carts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL, -- 'sent', 'opened', 'clicked', 'recovered'
  channel TEXT NOT NULL, -- 'email', 'sms', 'whatsapp'
  touch_number INTEGER,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_recovery_cart_time ON recovery_events (abandoned_cart_id, created_at DESC);

-- 3. Tenant profiles (5-layer industry-aware: identity/revenue/ops/goals/tone)
CREATE TABLE IF NOT EXISTS tenant_profiles (
  tenant_id UUID PRIMARY KEY,
  industry TEXT, -- fashion, skincare etc.
  business_model TEXT, -- dropship, subscription etc.
  target_market JSONB, -- {age: [18,35], gender: 'female', location: 'US'}
  aov NUMERIC(12,2),
  purchase_frequency INTEGER, -- days
  sales_channels JSONB,
  payment_methods JSONB,
  team_size INTEGER,
  inventory_size INTEGER,
  fulfillment_speed INTEGER, -- days
  growth_goals JSONB, -- ['revenue', 'retention']
  brand_tone TEXT, -- 'premium', 'playful'
  maturity_score INTEGER DEFAULT 0 CHECK (maturity_score BETWEEN 0 AND 100),
  preferred_channel TEXT DEFAULT 'whatsapp' CHECK (preferred_channel IN ('email', 'sms', 'whatsapp')), -- WhatsApp priority
  touch1_delay INTEGER DEFAULT 15,
  touch2_delay INTEGER DEFAULT 90,
  discount_threshold NUMERIC DEFAULT 0.1,
  from_email TEXT,
  whatsapp_business_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add industry column if missing (for existing tables)
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS industry TEXT;

CREATE INDEX IF NOT EXISTS idx_tenant_profiles_industry ON tenant_profiles (industry) WHERE industry IS NOT NULL;


-- RLS (tenant isolation)
ALTER TABLE abandoned_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_carts ON abandoned_carts
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_recovery_events ON recovery_events
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- Seed example tenant profile (perfume dropship) - only if industry column exists
INSERT INTO tenant_profiles (tenant_id, industry, business_model, aov, preferred_channel) 
SELECT '00000000-0000-0000-0000-000000000000', 'perfume', 'dropship', 35.00, 'whatsapp'
WHERE EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenant_profiles' AND column_name = 'industry')
ON CONFLICT (tenant_id) DO UPDATE SET 
  industry = EXCLUDED.industry, business_model = EXCLUDED.business_model, aov = EXCLUDED.aov, preferred_channel = EXCLUDED.preferred_channel;


