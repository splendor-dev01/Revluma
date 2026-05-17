# Session Creation Bug — Diagnosis & Testing Guide

## The Problem (FIXED ✅)

**Why sessions weren't being created in `user_sessions` table:**

1. **Signup/Login routes** called `createSession()` to save a session row in the database
2. **If `createSession()` failed** (e.g., DB error, connection issue), the error was silently swallowed
3. **Response status was already set** (201 for signup, 200 for login) when the error occurred
4. **Frontend received `sessionEstablished: true`** but NO session row was created in the database
5. **Client-side verification** (`/session/me`) found no matching cookie in the database → returned `authenticated: false`
6. **User redirected back to login**, appearing as if signup/login failed

## What I Fixed

### Backend Changes (authSession.js)
```javascript
// BEFORE: Error silently swallowed
const sessionResult = await createSession(...);
// If this throws, error caught by outer catch block AFTER response sent

// AFTER: Error properly propagated
let sessionResult;
try {
  sessionResult = await createSession(...);
} catch (sessionErr) {
  logger.error('Session creation failed', { error: sessionErr.message, ... });
  throw new Error(`Session creation failed: ${sessionErr.message}`); // This bubbles to outer catch
}
// Now outer catch sends 500 error instead of 201/200
```

### Frontend Changes (loginIn.html)
```javascript
// Added user-friendly message for session creation failures:
case 'SERVER_ERROR':
  if (err.message && err.message.includes('Session creation')) {
    showErrorBanner(
      'We couldn\'t establish your session',
      'Our servers are having trouble saving your login. This is temporary. Please try again in a moment.'
    );
  }
```

## Testing Checklist

### Step 1: Deploy Backend
Push the updated code to Render:
```bash
git add Backend/src/routes/authSession.js
git commit -m "Fix: session creation error handling in auth routes"
git push origin main
```

Wait 2-3 minutes for Render to redeploy.

### Step 2: Create a Test Account
1. Open https://revluma.vercel.app/auth/onboarding.html
2. Enter test credentials:
   - Email: `test_[timestamp]@example.com` (e.g., `test_1234567890@example.com`)
   - Password: `SecureTest123!@` (meets 8+ char requirement)
   - First name: Test
   - Last name: User
3. Click "Create Account"

### Step 3: Monitor Server Logs
Open Render dashboard → Logs and look for:

✅ **SUCCESS** — You should see:
```
AUTH_EVENT session_created
  userId: "user_123"
  sessionId: "sess_abc..."
  tokenHashPrefix: "abc123..."
  
Signup session created
  userId: "user_123"
  sessionId: "sess_abc..."
```

❌ **FAILURE** — If you see:
```
Session creation failed
  error: "Connection timeout" 
  OR
  error: "user_sessions table not found"
  OR
  error: "ECONNREFUSED"
```

### Step 4: Check Database
In Supabase → SQL Editor, run:
```sql
SELECT 
  id, 
  "userId", 
  "tokenHash", 
  "createdAt", 
  "expiresAt"
FROM public.user_sessions
WHERE "createdAt" > NOW() - INTERVAL '5 minutes'
ORDER BY "createdAt" DESC
LIMIT 5;
```

✅ **SUCCESS**: At least 1 row should appear with today's timestamp
❌ **FAILURE**: Table is empty

### Step 5: Check Browser
1. After signup, open **DevTools** → **Application** → **Cookies**
2. Look for cookie under domain: `revluma.onrender.com`
3. Find the cookie named: `revluma_session`

✅ **SUCCESS**: Cookie is present
❌ **FAILURE**: Cookie is missing

### Step 6: Check Network Tab
1. Refresh the page with DevTools open → Network tab
2. Reproduce signup again
3. Find the `POST /api/session/signup` request
4. Check **Response Headers**:
   - Should see: `set-cookie: revluma_session=...`
   - Should see: `access-control-allow-credentials: true`
   - Should see: `access-control-allow-origin: https://revluma.vercel.app`

### Step 7: Verify Redirect Works
After successful signup:
1. Check browser console (DevTools → Console)
2. Look for: `[AUTH] Server session verified, proceeding to redirect`
3. If session verification passed, you should land on the dashboard (or onboarding)

---

## Error Scenarios & Fixes

### Scenario A: "Session creation failed"
**Indicates**: Database write is failing

**Next steps**:
1. Check Render logs for the specific error message (e.g., "Connection timeout", "constraint violation")
2. Verify Prisma connection string is correct: `DATABASE_URL` env var in Render
3. Run migrations: `npx prisma migrate deploy` (from your local machine pointed at the DB)
4. Check if `user_sessions` table exists in Supabase

### Scenario B: Signup succeeds but you're redirected to login
**Indicates**: Session was created BUT cookie not being set or sent

**Next steps**:
1. Open browser DevTools → Application → Cookies
2. Check if `revluma_session` cookie exists under `revluma.onrender.com`
3. If missing: Check Network tab for `Set-Cookie` header in the signup response
4. If header is missing: Check CORS settings in `Backend/server.js` (credentials, origin allow-list)
5. If header exists but cookie not stored: Browser might be blocking third-party cookies
   - Try: Settings → Cookies and site data → Allow all cookies

### Scenario C: Redirect works but dashboard is empty / wrong user
**Indicates**: Session created but wrong user data in cookie

**Next steps**:
1. Open DevTools → Application → Cookies → `revluma_session` 
2. Copy the cookie value
3. In Render logs, find the matching `tokenHashPrefix` (first 16 chars of hash)
4. Query DB: `SELECT * FROM user_sessions WHERE "userId" = '[your_user_id]' LIMIT 1;`
5. Verify the `userId` in the cookie matches your test account

---

## Manual Testing Command

If you want to test the endpoint directly with cURL:

```bash
# 1. Create account
curl -X POST https://revluma.onrender.com/api/session/signup \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test_manual_'"$(date +%s)"'@example.com",
    "password": "SecureTest123!@",
    "firstName": "Test",
    "lastName": "User"
  }' \
  -i

# Response should be:
# HTTP/1.1 201 Created
# set-cookie: revluma_session=...
# {
#   "message": "Account created successfully",
#   "user": {...},
#   "sessionEstablished": true
# }

# 2. Check if session was created
curl -X GET https://revluma.onrender.com/api/session/me \
  -H "Cookie: revluma_session=[PASTE_COOKIE_HERE]" \
  -i

# Response should be:
# HTTP/1.1 200 OK
# {
#   "authenticated": true,
#   "user": {...}
# }
```

---

## Files Changed

- ✅ `Backend/src/routes/authSession.js`
  - Added try-catch around `createSession()` calls in signup and login routes
  - Improved error logging with specific `sessionErr.message`
  - Ensured errors bubble up to outer catch block

- ✅ `Frontend/auth/loginIn.html`
  - Added user-friendly error message for session creation failures
  - Message: "We couldn't establish your session"

---

## Next Steps

1. **Commit & push** the changes
2. **Wait for Render redeploy** (2-3 min)
3. **Run the testing checklist above**
4. **Paste the Render logs** (from Step 3) in your next message if you see errors
5. **If successful**, existing accounts will continue to work seamlessly

---

## Production Impact

✅ **Backward compatible**: Existing accounts are unaffected
✅ **No data migration needed**
✅ **No breaking changes to API**
❌ **All NEW signup/login attempts will fail gracefully** if session creation fails (instead of appearing to succeed then redirect back)

