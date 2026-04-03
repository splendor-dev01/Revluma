-- Revluma Email Verification Schema
-- Adds email verification functionality

-- Create email verification codes table
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  used BOOLEAN DEFAULT FALSE
);

-- Create index for quick lookups
CREATE INDEX IF NOT EXISTS idx_email_verification_user ON email_verification_codes (user_id);
CREATE INDEX IF NOT EXISTS idx_email_verification_email ON email_verification_codes (email);
CREATE INDEX IF NOT EXISTS idx_email_verification_code ON email_verification_codes (code);

-- Add email_verified field to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;

-- Create index for email verification status
CREATE INDEX IF NOT EXISTS idx_users_email_verified ON users (email_verified);

-- RLS for email verification codes
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_email_verification ON email_verification_codes
  FOR ALL USING (user_id IN (SELECT id FROM users WHERE tenant_id = current_setting('app.current_tenant_id')::uuid));
