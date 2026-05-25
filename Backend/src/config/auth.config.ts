/**
 * UNIFIED AUTHENTICATION CONFIGURATION
 * Centralized auth settings for all user types (customer, affiliate, admin)
 * Single source of truth for auth constants and validation
 */

export const AUTH_CONFIG = {
  // Session Management
  SESSION: {
    EXPIRY_DAYS: parseInt(process.env.SESSION_EXPIRY_DAYS || '7', 10),
    COOKIE_NAME: 'revluma_session',
    COOKIE_PATH: '/',
    POLL_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes
  },

  // CSRF Protection
  CSRF: {
    SECRET: process.env.CSRF_SECRET || process.env.JWT_SECRET,
    TOKEN_TTL_MS: 30 * 60 * 1000, // 30 minutes
    HEADER_NAME: 'X-CSRF-Token',
  },

  // Rate Limiting
  RATE_LIMITS: {
    LOGIN: { windowMs: 15 * 60 * 1000, max: 10 }, // 10 attempts per 15 minutes
    REGISTER: { windowMs: 15 * 60 * 1000, max: 5 }, // 5 attempts per 15 minutes
    PASSWORD_RESET: { windowMs: 15 * 60 * 1000, max: 5 },
    VERIFY_EMAIL: { windowMs: 15 * 60 * 1000, max: 10 },
  },

  // Password Requirements
  PASSWORD: {
    MIN_LENGTH: 8,
    MAX_LENGTH: 128,
    REQUIRE_UPPERCASE: false,
    REQUIRE_NUMBERS: false,
    REQUIRE_SYMBOLS: false,
    WEAK_PATTERNS: [
      /^12345678/,
      /^password/i,
      /^qwerty/i,
      /^abc123/i,
      /^admin/i,
      /^user/i,
      /^login/i,
      /^welcome/i,
      /^letmein/i,
      /^monkey/i,
      /^dragon/i,
      /^passw0rd/i,
      /^p@ssw0rd/i,
    ],
  },

  // Email Verification
  EMAIL_VERIFICATION: {
    CODE_EXPIRY_MINUTES: 15,
    CODE_LENGTH: 6,
    MAX_ATTEMPTS: 10,
  },

  // Password Reset
  PASSWORD_RESET: {
    TOKEN_EXPIRY_HOURS: 1,
    CODE_LENGTH: 6,
    MAX_ATTEMPTS: 5,
  },

  // User Roles
  ROLES: {
    CUSTOMER: 'customer',
    AFFILIATE: 'affiliate',
    ADMIN: 'admin',
    OWNER: 'owner',
  },

  // Affiliate Tiers
  AFFILIATE_TIERS: {
    NONE: 'none',
    AFFILIATE: 'affiliate',
    GROWTH: 'growth',
    ELITE: 'elite',
    FOUNDING_AMBASSADOR: 'founding_ambassador',
  },

  // Affiliate Status
  AFFILIATE_STATUS: {
    INACTIVE: 'inactive',
    PENDING_APPROVAL: 'pending_approval',
    APPROVED: 'approved',
    SUSPENDED: 'suspended',
  },

  // Approval Status
  APPROVAL_STATUS: {
    PENDING: 'pending',
    APPROVED: 'approved',
    REJECTED: 'rejected',
  },

  // Commission Defaults
  COMMISSION: {
    DEFAULT_RATE: 0.20, // 20%
    MIN_PAYOUT_AMOUNT: 50,
    MAX_COMMISSION_RATE: 0.50, // 50%
  },
};

/**
 * Validate authentication configuration
 * @throws Error if critical configuration is missing
 */
export function validateAuthConfig(): void {
  const errors: string[] = [];

  if (!AUTH_CONFIG.CSRF.SECRET) {
    errors.push('CSRF_SECRET or JWT_SECRET must be configured');
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SESSION_EXPIRY_DAYS) {
      errors.push('SESSION_EXPIRY_DAYS must be set in production');
    }
  }

  if (errors.length > 0) {
    console.error('=== AUTHENTICATION CONFIGURATION ERROR ===');
    errors.forEach(err => console.error(`  - ${err}`));
    console.error('==========================================');
    throw new Error('Critical authentication configuration missing');
  }
}

export default AUTH_CONFIG;
