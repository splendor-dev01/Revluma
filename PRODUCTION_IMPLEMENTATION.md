# Revluma SaaS Production Implementation Guide

## Overview
This document outlines the full system refactor from mocked affiliate system to production-ready SaaS platform.

**Status**: Phase 1 - Core Systems Implementation
**Last Updated**: 2026-05-28

---

## 1. CORE SYSTEM REQUIREMENTS

### 1.1 Architecture Overview
- **Backend**: Express.js + Prisma ORM + PostgreSQL
- **Frontend**: React + Vite (Affiliate Portal) / Static HTML (Landing Page)
- **Authentication**: JWT + Session-based (email verification required)
- **Database**: PostgreSQL with Prisma migrations
- **Storage**: Supabase Storage or AWS S3
- **Email**: SendGrid/Resend + NodeMailer
- **Real-time**: Redis for session management & caching

### 1.2 Environment Configuration

**Global Domain Configuration** (`.env`):
```env
# Domain Configuration (CRITICAL - controls all affiliate links)
NEXT_PUBLIC_BASE_URL=https://revluma.vercel.app
BASE_URL=https://revluma.vercel.app

# Alternative domain
PRODUCTION_DOMAIN=revluma.com

# Database
DATABASE_URL=postgresql://user:pass@host/db
DIRECT_URL=postgresql://user:pass@host/db

# Authentication & Security
JWT_SECRET=<strong-secret>
SESSION_SECRET=<strong-secret>
SALT_ROUNDS=12

# Email Service
RESEND_API_KEY=<key>
SENDGRID_API_KEY=<key>
SMTP_HOST=
SMTP_PORT=
SMTP_USER=
SMTP_PASS=

# Storage
SUPABASE_URL=
SUPABASE_KEY=
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY=
S3_SECRET_KEY=

# External Services
GEMINI_API_KEY=<key>
LEMON_SQUEEZY_WEBHOOK_SECRET=<secret>

# Feature Flags
ENABLE_AFFILIATE_SYSTEM=true
ENABLE_WAITLIST=true
```

---

## 2. AUTHENTICATION SYSTEM

### 2.1 Signup Flow
1. User submits email/password on `/signup` or `/auth/onboarding.html`
2. Password hashed with bcryptjs (12 rounds)
3. User created in `users` table with `emailVerified=false`
4. **Email verification code** sent to user's email
5. User must verify email before accessing dashboard
6. Session created only after verification

### 2.2 Verification System
- Verification code: 6-digit random number
- Stored in `emailVerificationCodes` table
- Expires after 24 hours
- Can be resent (rate-limited to 3 per hour)
- Must be verified before first login

### 2.3 Session Management
- Sessions stored in `userSessions` table
- JWT + Session token hybrid approach
- Token hash stored (never raw token in DB)
- 7-day sliding window expiration
- CSRF protection on all mutating endpoints
- Secure HttpOnly cookies with SameSite=Strict

---

## 3. AFFILIATE SYSTEM

### 3.1 Affiliate User Lifecycle

```
1. User creates account → user record created
2. User completes onboarding → affiliateProfile created
3. Referral link generated → stored in referralLinks table
4. Affiliate can share link: revluma.vercel.app/affiliate/username-uniqueId
```

### 3.2 Referral Link Format
```
revluma.vercel.app/affiliate/splendor-95d3e
                             └─────────┬─────────┘
                             username + uniqueId (5 chars)

Database Storage (referralLinks):
- id: uuid
- affiliateId: fk → AffiliateProfile.id
- username: string (from AffiliateProfile.username)
- uniqueId: string (auto-generated, immutable)
- referralCode: string (combined unique key)
- clicksCount: int
- createdAt: timestamp
- updatedAt: timestamp
```

### 3.3 Click Tracking
```
When user lands on /affiliate/:code:
1. Extract referralCode from URL
2. Store click in referralClicks table
3. Set tracking cookie: __revluma_ref=<code>
4. Set localStorage fallback: revluma_referrer=<code>
5. Persist across navigation/refresh
```

### 3.4 Affiliate Dashboard Data (Real-Time)
- **Total Clicks**: count from referralClicks
- **Referral Users**: count from affiliateReferrals
- **Users Joined Today/Week**: filtered by createdAt
- **Conversion Rate**: (conversions / clicks) × 100
- **User Status Breakdown**:
  - WAITLIST_JOINED
  - ACCOUNT_CREATED
  - TRIAL_STARTED
  - ACTIVE_SUBSCRIBER
  - CANCELLED
- **Earnings**: from affiliateEarnings, filtered by status (PENDING/CLEARED/WITHDRAWN)
- **Leaderboard**: affiliates ranked by total conversions (month/week/all-time)

---

## 4. WAITLIST SYSTEM

### 4.1 Form Fields
```
Required:
- Full Name
- Email
- Primary Platform (dropdown)
- Phone Number

Optional:
- Monthly Revenue Range
- Referral Code (if from affiliate link)
- Biggest Revenue Leak
- X Handle
- TikTok Handle
- Instagram Handle
```

### 4.2 Platform Dropdown (15 options)
1. Shopify
2. WooCommerce
3. Amazon
4. Etsy
5. BigCommerce
6. Magento
7. Wix
8. Squarespace
9. eBay
10. TikTok Shop
11. Facebook Shops
12. Stripe Store
13. Payhip
14. Gumroad
15. Custom Store (user types manually)

### 4.3 Referral Attribution Logic
```
If referralCode submitted:
  1. Look up ReferralLink by referralCode
  2. Get associated AffiliateProfile
  3. Create WaitlistSubmission with affiliateId
  4. Create AffiliateReferral record
  5. Link user to affiliate

If referralCode invalid:
  → Return 400: "Referral code does not exist"
```

### 4.4 Data Storage
```
waitlistSubmissions:
- id
- fullName
- email (unique)
- phoneNumber
- monthlyRevenueRange
- primaryPlatform
- referralCode (optional, fk → ReferralLink)
- affiliateId (optional, fk → AffiliateProfile)
- biggestRevenueLeak
- xHandle
- tiktokHandle
- instagramHandle
- status: PENDING/CONTACTED/QUALIFIED/CONVERTED
- createdAt
- updatedAt
```

---

## 5. FILE UPLOAD SYSTEM

### 5.1 Current Issues
- Uploads don't persist
- Placeholder images aren't replaced dynamically
- No real storage integration

### 5.2 Solution
**Use Supabase Storage** (simplest for this stack):
1. Create bucket: `revluma-uploads`
2. Files stored with structure: `uploads/{affiliateId}/{filename}`
3. URL returned and stored in DB
4. Replace all placeholder images with real uploaded assets
5. Implement file deletion on record removal

### 5.3 API Endpoint
```
POST /api/v1/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>

Response:
{
  "url": "https://supabase.../storage/v1/object/public/revluma-uploads/...",
  "filename": "profile.jpg",
  "size": 51200
}
```

---

## 6. LANDING PAGE CTA

### 6.1 Changes to `/Frontend/index.html`
```html
<!-- Visible "Join Waitlist" CTA -->
<button onclick="window.location.href='/waitlist'" 
  class="glass-btn uppercase tracking-wide">
  Join Waitlist
</button>
```

**Behavior**:
- Click → redirects to `/waitlist`
- Mobile responsive (tested on 320px - 1920px)
- Visible in hero section and sticky nav
- Opens modal or new page (configurable)

---

## 7. ROUTES IMPLEMENTATION

### 7.1 Public Routes (No Auth Required)

```
GET  /                              → Landing page (Frontend/index.html)
GET  /waitlist                       → Waitlist form page
POST /api/waitlist                   → Submit waitlist form
GET  /affiliate/:code                → Referral tracking + redirect
GET  /affiliate/:code/track          → Track click only

GET  /health                         → Health check
```

### 7.2 Protected Routes (Auth Required)

```
Dashboard & Profile:
GET  /api/v1/dashboard             → User dashboard data
GET  /api/v1/user/profile          → User profile

Affiliate-Specific:
GET  /api/v1/affiliate             → Affiliate profile
GET  /api/v1/affiliate/dashboard-summary
GET  /api/v1/affiliate/metrics     → Real-time metrics
GET  /api/v1/affiliate/referrals   → List all referrals
GET  /api/v1/affiliate/earnings    → Earnings breakdown
POST /api/v1/affiliate/withdraw    → Create withdrawal request
GET  /api/v1/affiliate/leaderboard → Ranked affiliates

Analytics:
GET  /api/v1/metrics/clicks        → Click analytics
GET  /api/v1/metrics/conversions   → Conversion analytics
```

### 7.3 Authentication Routes

```
POST /api/auth/signup              → Create account
POST /api/auth/login               → Login
POST /api/auth/verify-email        → Verify email code
POST /api/session/logout           → Logout
GET  /api/session/me               → Current user
POST /api/session/refresh          → Refresh token
GET  /api/session/validate         → Validate session
```

---

## 8. DATABASE SCHEMA

### Core Models to Implement/Update

```prisma
// User & Tenant
model User {
  id: String @id @default(uuid())
  tenantId: String
  email: String @unique
  passwordHash: String
  fullName: String
  emailVerified: Boolean @default(false)
  emailVerifiedAt: DateTime?
  createdAt: DateTime @default(now())
  affiliateProfile: AffiliateProfile?
}

model AffiliateProfile {
  id: String @id @default(uuid())
  userId: String @unique
  username: String @unique
  fullName: String
  status: AffiliateStatus (PENDING|APPROVED|REJECTED|SUSPENDED)
  tier: AffiliateTier (AFFILIATE|GROWTH|ELITE|FOUNDING_AMBASSADOR)
  commissionRate: Decimal @default(0.20)
  totalEarned: Decimal @default(0)
  totalWithdrawn: Decimal @default(0)
  pendingBalance: Decimal @default(0)
  createdAt: DateTime @default(now())
  referralLinks: ReferralLink[]
  referrals: AffiliateReferral[]
  earnings: AffiliateEarning[]
}

// Referral Tracking
model ReferralLink {
  id: String @id @default(uuid())
  affiliateId: String
  username: String
  uniqueId: String @unique
  referralCode: String @unique
  clicksCount: Int @default(0)
  createdAt: DateTime @default(now())
  clicks: ReferralClick[]
}

model ReferralClick {
  id: String @id @default(uuid())
  referralLinkId: String
  affiliateId: String
  ipAddress: String?
  userAgent: String?
  referrer: String?
  utmSource: String?
  utmMedium: String?
  utmCampaign: String?
  createdAt: DateTime @default(now())
}

// Waitlist & Conversions
model WaitlistSubmission {
  id: String @id @default(uuid())
  fullName: String
  email: String @unique
  phoneNumber: String?
  monthlyRevenueRange: String?
  primaryPlatform: String?
  referralCode: String?
  affiliateId: String?
  biggestRevenueLeak: String?
  xHandle: String?
  tiktokHandle: String?
  instagramHandle: String?
  status: String @default("PENDING")
  createdAt: DateTime @default(now())
}

model AffiliateReferral {
  id: String @id @default(uuid())
  partnerId: String
  customerEmail: String
  customerId: String?
  status: ReferralStatus (WAITLIST_JOINED|ACCOUNT_CREATED|TRIAL_STARTED|ACTIVE_SUBSCRIBER|CANCELLED)
  planName: String @default("None")
  monthlyValue: Decimal @default(0)
  lifetimeValue: Decimal @default(0)
  convertedAt: DateTime?
  createdAt: DateTime @default(now())
}

model AffiliateEarning {
  id: String @id @default(uuid())
  partnerId: String
  referralId: String?
  amount: Decimal
  status: EarningStatus (PENDING|CLEARED|WITHDRAWN)
  paidAt: DateTime?
  createdAt: DateTime @default(now())
}
```

---

## 9. EMAIL SYSTEM

### 9.1 Email Templates

**Verification Email**:
```
Subject: Verify Your Revluma Account
Body:
  Your verification code is: 123456
  This code expires in 24 hours.
  If you didn't create this account, ignore this email.
```

**Affiliate Approval**:
```
Subject: Welcome to Revluma Affiliate Program!
Body:
  Your affiliate account has been approved.
  Your referral link: revluma.vercel.app/affiliate/{username}-{id}
  Start sharing and earn commissions!
```

**Referral Notification**:
```
Subject: New Referral! 🎉
Body:
  Someone from your link just signed up!
  Name: {name}
  Email: {email}
  Platform: {platform}
```

### 9.2 Email Service Provider
- **Primary**: SendGrid (production reliability)
- **Secondary**: Resend (backup, simpler API)
- **Fallback**: Node Mailer with SMTP (self-hosted)

---

## 10. ANALYTICS ENGINE

### 10.1 Real-Time Metrics

```
Per Affiliate:
- Total Clicks: COUNT(referralClicks) WHERE affiliateId = X
- Clicks Today: COUNT(*) WHERE affiliateId = X AND createdAt >= TODAY
- Clicks This Week: COUNT(*) WHERE affiliateId = X AND createdAt >= WEEK_START
- Conversions: COUNT(affiliateReferrals) WHERE status IN (ACCOUNT_CREATED, TRIAL_STARTED, ACTIVE_SUBSCRIBER)
- Conversion Rate: (conversions / clicks) × 100
- Active Referrals: COUNT(*) WHERE status = ACTIVE_SUBSCRIBER
- Trial Referrals: COUNT(*) WHERE status = TRIAL_STARTED
- Waitlist Referrals: COUNT(*) WHERE status = WAITLIST_JOINED
- Total Earned: SUM(affiliateEarnings.amount) WHERE status IN (CLEARED, WITHDRAWN)
- Pending Earnings: SUM(*) WHERE status = PENDING
```

### 10.2 Time Filters
```
Query Parameters:
?period=today
?period=week
?period=month
?period=all_time
```

### 10.3 Leaderboard
```
GET /api/v1/leaderboard?period=month&limit=50

Response:
[
  {
    rank: 1,
    username: "splendor",
    totalConversions: 124,
    totalEarned: 5000,
    tier: "ELITE"
  },
  ...
]

Sort by: totalConversions DESC (not clicks)
```

---

## 11. IMPLEMENTATION CHECKLIST

### Phase 1: Core Foundation (Week 1)
- [x] Database schema finalization
- [ ] Email verification system
- [ ] Session management refactor
- [ ] Referral link generation
- [ ] Click tracking implementation

### Phase 2: Affiliate System (Week 2)
- [ ] Affiliate profile endpoints
- [ ] Dashboard metrics API
- [ ] Real-time analytics
- [ ] Leaderboard implementation
- [ ] Earnings calculation

### Phase 3: Waitlist & Attribution (Week 3)
- [ ] Waitlist form validation
- [ ] Referral attribution logic
- [ ] Email notifications
- [ ] Status tracking

### Phase 4: UI & Polish (Week 4)
- [ ] Landing page CTA
- [ ] Affiliate dashboard UI
- [ ] File upload integration
- [ ] Mobile responsiveness
- [ ] Performance optimization

### Phase 5: Deployment & Testing (Week 5)
- [ ] Environment configuration
- [ ] Database migrations
- [ ] Load testing
- [ ] Security audit
- [ ] Production deployment

---

## 12. SECURITY CHECKLIST

- [ ] HTTPS enforced on all endpoints
- [ ] CORS properly configured
- [ ] Rate limiting on auth endpoints
- [ ] CSRF protection on all POST/PUT/DELETE
- [ ] SQL injection prevention (Prisma handles this)
- [ ] XSS protection (sanitize all outputs)
- [ ] Password hashing (bcryptjs)
- [ ] Sensitive data never logged
- [ ] API keys in environment only
- [ ] Database backups configured
- [ ] Secrets rotation plan
- [ ] Encryption for stored tokens

---

## 13. DEPLOYMENT READINESS

### 13.1 Environment Validation
```bash
# Verify all env vars set
npm run verify-env

# Run migrations
npm run db:deploy

# Seed initial data (if needed)
npm run seed

# Start server
npm start
```

### 13.2 Health Checks
```
GET /health
{
  "status": "healthy",
  "database": "connected",
  "redis": "connected",
  "uptime": 3600
}
```

---

## 14. NEXT STEPS

1. **Review this document** with the team
2. **Create feature branches** for each component
3. **Start with Phase 1** (foundation)
4. **Daily standups** on progress
5. **Code reviews** before merge
6. **Testing** at each phase gate

---

## Questions & Support

- Database issues → check Prisma docs
- Email issues → verify SendGrid/Resend keys
- Affiliate tracking → review click tracking logic
- Session issues → check JWT/cookie configuration

---

**Document Version**: 1.0
**Last Updated**: 2026-05-28
**Status**: Ready for Implementation
