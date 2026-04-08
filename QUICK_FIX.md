# Quick Fix: "Database setup incomplete" Error

## Problem
When registering a new user, you get:
```
500 Error: "Database setup incomplete – please contact support"
```

## Root Cause
The PostgreSQL database connection exists, but the schema tables haven't been created. Prisma migrations need to be run.

## Solution (Choose One)

### **Fastest: On Render.com Deployment**
1. Go to Render.com dashboard
2. Select your Revluma backend service
3. Go to **Settings** → **Environment**
4. Add/update the **Pre-deployment command**:
   ```bash
   npx prisma migrate deploy
   ```
5. Click "Deploy" or wait for auto-deployment
6. Check logs to verify: `✓ Database schema validated successfully`

### **For Local Development**
```bash
cd Backend
npm install
npx prisma migrate deploy
npm start
```

### **If Above Doesn't Work**

**Step 1: Verify DATABASE_URL is set**
```bash
# Show environment variable (Render)
# Or check .env file (local)
echo $DATABASE_URL
# Should output: postgresql://user:password@host:port/db
```

**Step 2: Check migration status**
```bash
cd Backend
npx prisma migrate status
```

**Step 3: Reset & reinitialize (⚠️ deletes all data)**
```bash
cd Backend
npx prisma migrate reset --force
```

**Step 4: Start server**
```bash
npm start
```

### **For Docker/Custom Deployment**
Before starting the app, run:
```bash
npx prisma migrate deploy
```

## Verification

Test the fix by registering a new user:
1. Go to https://revluma.onrender.com/auth/onboarding.html
2. Enter email, password, name
3. Click "Sign up"
4. Should see: "Account created successfully!"

Or test via API:
```bash
curl -X POST https://revluma.onrender.com/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "TestPassword123!",
    "full_name": "Test User"
  }'
```

Expected response:
```json
{
  "message": "Account created successfully! Welcome to Revluma",
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { ... }
}
```

## Health Check
```bash
curl https://revluma.onrender.com/health
```

Should show:
```json
{
  "status": "healthy",
  "schema": "initialized",
  "database": "connected",
  ...
}
```

## What Changed

File modifications for production-grade error handling:
- ✅ Added schema validator (`src/utils/schemaValidator.js`)
- ✅ Added database error handler (`src/utils/dbErrorHandler.js`)
- ✅ Enhanced error messages in all auth endpoints
- ✅ Version check on server startup
- ✅ Improved health endpoint with schema status
- ✅ Added DATABASE_SETUP.md with comprehensive guide

## Prevention

To prevent this in the future:
1. Always run `npx prisma migrate deploy` after pulling code
2. Set pre-deployment command in your hosting platform
3. Monitor `/health` endpoint for schema status
4. Keep DATABASE_URL in environment variables

---
**Issue Fixed:** April 8, 2026
**Status:** Production-Ready ✓
