-- Revluma Onboarding Schema
-- Extends tenant_profiles with onboarding-specific fields

-- Add onboarding fields to tenant_profiles
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS platform TEXT; -- 'shopify', 'woocommerce', 'other'
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS store_url TEXT;
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS monthly_traffic TEXT; -- '0-1k', '1k-10k', '10k-50k', '50k+'
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS monthly_revenue TEXT; -- '0-1k', '1k-10k', '10k-50k', '50k+'
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS goals JSONB; -- ['recover_carts', 'increase_conversion', 'find_products', 'scale_revenue']
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS preferred_recovery_channel TEXT; -- 'email', 'whatsapp', 'both'
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'started'; -- 'started', 'step1', 'step2', 'step3', 'step4', 'step5', 'completed'
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE;

-- Create index for onboarding status queries
CREATE INDEX IF NOT EXISTS idx_tenant_profiles_onboarding ON tenant_profiles (onboarding_status);

-- Update users table to track onboarding status
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'started';
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMP WITH TIME ZONE;

-- Create index for user onboarding status
CREATE INDEX IF NOT EXISTS idx_users_onboarding ON users (onboarding_status);
