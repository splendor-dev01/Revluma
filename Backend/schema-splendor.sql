-- Splendor AI Full Platform Schema Extensions
-- Industry-aware profiles, benchmarks, CRM, LTV/churn, automations
-- Run AFTER schema-recovery.sql

-- 4. Industry Benchmarks (percentiles snapshots)
CREATE TABLE IF NOT EXISTS benchmarks (
  id SERIAL PRIMARY KEY,
  industry TEXT NOT NULL,
  business_model TEXT NOT NULL,
  price_band TEXT, -- 'low', 'mid', 'high'
  region TEXT DEFAULT 'global',
  period_month DATE NOT NULL, -- YYYY-MM
  cr_p25 NUMERIC, cr_p50 NUMERIC, cr_p75 NUMERIC, -- conversion rate
  aov_p25 NUMERIC, aov_p50 NUMERIC, aov_p75 NUMERIC,
  repeat_rate_p25 NUMERIC, repeat_rate_p50 NUMERIC, repeat_rate_p75 NUMERIC,
  churn_rate_p25 NUMERIC, churn_rate_p50 NUMERIC, churn_rate_p75 NUMERIC,
  inventory_turnover_p25 NUMERIC, inventory_turnover_p50 NUMERIC, inventory_turnover_p75 NUMERIC,
  cac_p25 NUMERIC, cac_p50 NUMERIC, cac_p75 NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_benchmarks_industry_model_period ON benchmarks (industry, business_model, period_month DESC);

-- RLS: Global read (anonymized), tenant can't write
ALTER TABLE benchmarks ENABLE ROW LEVEL SECURITY;
CREATE POLICY global_benchmarks ON benchmarks FOR ALL USING (true) WITH CHECK (false); -- read-only

-- Seed sample data (perfume dropship benchmarks)
INSERT INTO benchmarks (industry, business_model, price_band, region, period_month, 
  cr_p25, cr_p50, cr_p75, aov_p25, aov_p50, aov_p75,
  repeat_rate_p25, repeat_rate_p50, repeat_rate_p75)
VALUES 
  ('perfume', 'dropship', 'mid', 'global', '2024-03',
   1.2, 2.1, 3.5, 25.0, 40.0, 65.0,
   5.0, 12.0, 25.0),
  ('skincare', 'inventory', 'high', 'global', '2024-03',
   1.8, 2.8, 4.2, 45.0, 75.0, 120.0,
   8.0, 18.0, 32.0)
ON CONFLICT DO NOTHING;

-- 5. Customer CRM (leads/customers with scores)
CREATE TABLE IF NOT EXISTS customer_crm (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  external_id TEXT,
  name TEXT,
  email TEXT,
  phone TEXT,
  total_purchases INTEGER DEFAULT 0,
  total_spent NUMERIC(12,2) DEFAULT 0,
  last_purchase DATE,
  ltv_score INTEGER DEFAULT 0 CHECK (ltv_score BETWEEN 0 AND 100),
  intent_score INTEGER DEFAULT 0 CHECK (intent_score BETWEEN 0 AND 100),
  churn_risk INTEGER DEFAULT 0 CHECK (churn_risk BETWEEN 0 AND 100),
  segment TEXT DEFAULT 'low-intent', -- high/low, tiers
  behavior_data JSONB, -- views, time, referrals
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_crm_tenant_ltv ON customer_crm (tenant_id, ltv_score DESC);
CREATE INDEX idx_crm_tenant_churn ON customer_crm (tenant_id, churn_risk ASC);

ALTER TABLE customer_crm ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_crm ON customer_crm
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 6. LTV Segments & Churn Events
CREATE TABLE IF NOT EXISTS ltv_segments (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL, -- 'VIP', 'Rising'
  criteria JSONB NOT NULL, -- {'min_aov': 100, 'purchases': 3}
  size INTEGER DEFAULT 0,
  revenue_opportunity NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS churn_events (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  customer_id INTEGER REFERENCES customer_crm(id) ON DELETE CASCADE,
  days_inactive INTEGER,
  trigger_type TEXT, -- 'inactivity_30d', 'no_repeat'
  escalation_level INTEGER DEFAULT 1,
  status TEXT DEFAULT 'queued',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE ltv_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_ltv ON ltv_segments FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

ALTER TABLE churn_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_churn ON churn_events FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 7. Automation Tasks (chat advisor generated/executable)
CREATE TABLE IF NOT EXISTS automation_tasks (
  id SERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  type TEXT, -- 'activate_flow', 'adjust_pricing'
  status TEXT DEFAULT 'pending', -- pending, approved, executing, completed
  priority TEXT DEFAULT 'medium',
  assigned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

ALTER TABLE automation_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_tasks ON automation_tasks FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 8. Triggers: Auto-churn detection, LTV updates
CREATE OR REPLACE FUNCTION update_churn_risk()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.last_purchase < CURRENT_DATE - INTERVAL '30 days' THEN
    UPDATE customer_crm SET churn_risk = 80 WHERE id = NEW.id;
    INSERT INTO churn_events (tenant_id, customer_id, days_inactive, trigger_type)
    VALUES (NEW.tenant_id, NEW.id, EXTRACT(DAY FROM CURRENT_DATE - NEW.last_purchase)::int, 'inactivity_30d');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_churn AFTER UPDATE OF last_purchase ON customer_crm
  FOR EACH ROW EXECUTE FUNCTION update_churn_risk();

-- Indexes for perf
CREATE INDEX idx_benchmarks_lookup ON benchmarks (industry, business_model, region);

