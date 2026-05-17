# Revluma Auth Redirect Bug — Diagnostic Report

**Bug symptom:** After successful login on `/auth/loginIn.html`, user is redirected to `/dashboard/overview`, the React app shows a spinner briefly, then immediately redirects back to `/auth/loginIn.html` or `/auth/onboarding.html`.

---

## FILE-BY-FILE ANALYSIS

---

### 1. `Frontend/auth/loginIn.html` — Submit Handler & Redirect Logic

**Relevant code — submit handler (loginIn.html:1537–1588)**

```js
el.form.addEventListener('submit', async e => {
  e.preventDefault();
  // ... validation, rate limit ...
  const data = await apiLogin(email, password);  // calls revlumaAuth.login()
  // SUCCESS:
  clearRateLimit();
  console.log('[AUTH STEP 11] About to store session', { hasToken: !!data.token, hasUser: !!data.user });
  storeSession(data.token, data.user, state.rememberMe);  // STEP 5 — stores TOKEN in localStorage/sessionStorage
  showSuccess('Signed in — redirecting…');
  setTimeout(() => {
    redirectAfterLogin(data.user);    // STEP 6 — cookie-based redirect logic
  }, 900);
```

**Relevant code — `redirectAfterLogin()` (loginIn.html:1298–1332)**

```js
function redirectAfterLogin(user) {
  if (!user) { /* fallback to login page */ return; }
  const onboarding_status = user.onboarding_status;
  const dest = (onboarding_status === 'completed')
    ? '/dashboard/overview'
    : '/auth/onboarding.html';
  window.location.replace(abs);
}
```

**Relevant code — `verifyServerSessionAndRedirect()` (loginIn.html:1335–1367)**

```js
async function verifyServerSessionAndRedirect(user) {
  const res = await fetch(`${API_BASE}/session/me`, { credentials: 'include', headers: { 'Content-Type': 'application/json' } });
  if (body.authenticated) { redirectAfterLogin(user); }
  // Used only by the email-verification flow, NOT the normal login submit path.
}
```

**Relevant code — `storeSession()` syncs BOTH storages (loginIn.html:1232–1258)**

```js
function storeSession(token, user, remember) {
  const store = remember ? localStorage : sessionStorage;
  store.setItem('revluma_token', token);
  store.setItem('revluma_user', JSON.stringify(user));
  if (!remember) {
    localStorage.removeItem('revluma_token');
    localStorage.removeItem('revluma_user');
  }
}
```

**Relevant code — `checkAutoLogin()` (loginIn.html:1278–1296)**

```js
async function checkAutoLogin() {
  const user = await revlumaAuth.checkAutoLogin();
  if (user && user.id) {
    const dest = (user.onboarding_status === 'completed') ? '/dashboard/overview' : '/auth/onboarding.html';
    window.location.replace(dest);
  }
}
```

**Relevant code — `API_BASE` in loginIn.html (loginIn.html:976–991)**

```js
const API_BASE = window.APP_API_BASE?.replace(/\/$/, '') || (() => {
  const hostname = window.location.hostname.toLowerCase();
  const isVercelHost = hostname.endsWith('.vercel.app') || hostname.endsWith('.vercel.sh');
  const isRenderHost = hostname === 'revluma.onrender.com' || hostname.endsWith('.revluma.onrender.com');
  const isCustomDomain = hostname === 'revluma.com' || hostname.endsWith('.revluma.com');
  const isRevlumaHost = hostname.includes('revluma');
  const isProduction = isRenderHost || (isVercelHost && isRevlumaHost) || isCustomDomain;
  if (window.location.protocol === 'file:' || !window.location.origin) return 'http://localhost:5000/api';
  if (isProduction) return 'https://revluma.onrender.com/api';
  return `${window.location.origin}/api`;
})();
```

**🔴 FAIL — loginIn.html submit path incorrectly uses `revlumaAuth.login()` instead of `verifyServerSessionAndRedirect()`**

The normal login submit handler (line 1577) calls `redirectAfterLogin(data.user)` directly **without first verifying the server-side cookie session**. The `verifyServerSessionAndRedirect()` function (line 1335) exists and correctly calls `/session/me` with `credentials: 'include'` before redirecting — but it is only called from the *email-verification flow* (line 1499), NOT from the normal login submit path.

This means `data.user` is only the response body from the login POST (which does include `user` + `onboarding_status` — so that part works for loginIn.html itself). However, the `verifyServerSessionAndRedirect` gap means:
- On production (where `secure: true` and `sameSite: 'none'` are both set), if the cookie is not properly established or not sent on the /me check, there is no guard.
- More importantly, the `verifyServerSessionAndRedirect` path does `/session/me` and checks `body.authenticated` first — the login submit bypasses this check entirely.

The **critical consequence** appears in `auth-client.js` `checkAutoLogin()`: `checkAutoLogin` is called during page init (loginIn.html:1788) and it calls `/session/me` using `fetchWithAuth()`. If `checkAutoLogin` runs on `/dashboard/overview` page load (popup or tab scenario), its `me` call will set/clear browser state.

---

---

### 2. `Frontend/auth/auth-client.js` — `checkAutoLogin()` and Base URL Logic

**Relevant code — Constructor & base URL (auth-client.js:10–38)**

```js
constructor(config = {}) {
    const prodBackendUrl = 'https://revluma.onrender.com/api';
    const hostname = (window.location.hostname || '').toLowerCase();
    const isVercelHost = hostname.endsWith('.vercel.app') || hostname.endsWith('.vercel.sh');
    const isRenderHost = hostname === 'revluma.onrender.com' || hostname.endsWith('.revluma.onrender.com');
    const isCustomDomain = hostname === 'revluma.com' || hostname.endsWith('.revluma.com');
    const isRevlumaHost = hostname.includes('revluma');
    const isProduction = isRenderHost || (isVercelHost && isRevlumaHost) || isCustomDomain;
    const appApiBase = window.APP_API_BASE || (isProduction ? prodBackendUrl : '/api');
    if (!window.APP_API_BASE) { window.APP_API_BASE = appApiBase; }
    this.baseUrl = config.baseUrl || `${appApiBase}/session`;
}
```

**Relevant code — `checkAutoLogin()` (auth-client.js:136–177)**

```js
async checkAutoLogin() {
    try {
        const response = await this.fetchWithAuth(`${this.baseUrl}/me`);  // ✅ Fetches /session/me
        if (response.authenticated && response.user) {
            this.user = response.user;
            this.isAuthenticated = true;
            return this.user;
        }
    } catch (error) { /* fall through to JWT */ }
    // JWT fallback check...
    return null;  // ⚠️ Returns null means the page will NOT redirect
}
```

**🟡 WARNING — `checkAutoLogin()` has a silent-critical bug: it returns `this.user` (the `/session/me` response body) which contains `onboarding_status` at the **response top level only** — `this.user = response.user` (the nested `user` field) does NOT include `onboarding_status`.**

When `checkAutoLogin` returns, the caller accesses `user.onboarding_status` (loginIn.html:1282). Since `response.user` is the nested `buildUserPayload(user)` object which **does** contain `onboarding_status` (authSession.js:167–177), this path is actually MEMBER-safe — `buildUserPayload` sets `onboarding_status` on the user object itself. So `checkAutoLogin()` will work correctly for `onboarding_status`.

However, the real concern is: if `/session/me` fails on the dashboard page (different origin or cookie not sent), `checkAutoLogin()` returns `null`, and the page silently does nothing. This path isn't the primary redirect loop cause, but it's a degraded path worth noting.

**↳对这一点的修正：** The `checkAutoLogin()` on the login page runs at page load in `/auth`. The `fetchWithAuth` method uses `credentials: 'include'` so the session cookie IS sent to the backend. If the backend on Render is down or slow, or the cookie isn't set yet (race condition from redirect), `checkAutoLogin` returns `null` and no redirect fires. This is a rare degraded path, not the primary bug.

---

### 3. `Frontend/Dashboard/src/context/AuthContext.tsx` — `checkSession()`

**Relevant code — `checkSession()` (AuthContext.tsx:46–93)**

```ts
const checkSession = useCallback(async () => {
    console.log('[DASHBOARD AUTH] Starting session validation');
    try {
      const response = await api.get('/session/me', {
        withCredentials: true,
        timeout: SESSION_VALIDATION_TIMEOUT
      });
      if (response.data && response.data.authenticated) {
        const authenticatedUser: User = {
          ...response.data.user,                    // spread the nested user payload
          onboarding_status:                         // merge top-level onboarding_status
            response.data.onboarding_status ??
            response.data.user?.onboarding_status ??
            'pending'
        };
        setUser(authenticatedUser);
        setError(null);
      } else {
        console.warn('[DASHBOARD AUTH] Response not authenticated');
        setUser(null);
      }
    } catch (error) {
      console.error('[DASHBOARD AUTH] Session validation error:', ...);
      setUser(null);           // ⚠️ On ANY error, user is set to null
    } finally {
      setLoading(false);       // ⚠️ loading=false fires unconditionally
    }
  }, []);
```

**🟢 PASS — `checkSession()` logic is structurally correct.**
It correctly calls the API at `/session/me` (the full path when the dashboard app's `api.ts` sets `baseURL`). It merges `onboarding_status` from both top-level and nested user. `loading` is set to `false` in finally so App.tsx always proceeds.

**⚠️ WARNING — The catch-all `setUser(null)` on any error (including network error, 500, CORS, cookie-not-sent) is appropriate for "not logged in" but there is no distinction between "session expired" and "server is down". This is a UX issue, not the redirect loop bug.**

---

### 4. `Frontend/Dashboard/src/App.tsx` — Render Logic

**Relevant code — App.tsx:16–56**

```tsx
function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingSpinner />;
  }

  if (!user) {                                    // ⚠️ REDIRECT TRIGGER
    console.error('[DASHBOARD APP] No user authenticated, redirecting to login');
    window.location.href = '/auth/loginIn.html';
    return null;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {/* dashboard routes */}
    </QueryClientProvider>
  );
}
```

**🔴 FAIL — `App.tsx` unconditionally redirects to `/auth/loginIn.html` when `user` is null after loading completes. This is the redirect loop destination.**

When the dashboard loads at `/dashboard/overview`, `AuthContext` mounts, calls `checkSession()`, which calls `/session/me`. If this call fails (network error, CORS, cookie not sent, server error), `user` is set to `null`, `loading` becomes `false`, and `App.tsx` immediately sets `window.location.href = '/auth/loginIn.html'`.

The user sees a brief spinner (loading=true), then gets sent back to login. This is the exact bug described.

---

### 5. `Frontend/Dashboard/src/lib/api.ts` — Base URL

**Relevant code — api.ts:1–16**

```ts
const API_BASE = window.APP_API_BASE?.replace(/\/$/, '') || (() => {
  if (window.location.protocol === 'file:' || !window.location.origin) {
    return 'http://localhost:5000/api';
  }
  return `${window.location.origin}/api`;
})();

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});
```

**🔴 FAIL — When the React app is served at `revluma.vercel.app/dashboard/overview`, `window.location.origin` resolves to `https://revluma.vercel.app` (correct), so `API_BASE` = `https://revluma.vercel.app/api`.**

This is **wrong** in production. The React SPA uses the `/api` path which should proxy to the backend, but `window.location.origin` on the Vercel SPA host does NOT mean `https://revluma.vercel.app/api` EXISTS as a backend — Vercel rewrites to `/Dashboard/dist/` files.

The `APP_API_BASE` __must__ be set by the `apiConfig.js` script (which runs in the auth HTML pages), but `api.ts` (used by the React Dashboard SPA) does NOT load `apiConfig.js` — it only runs in the React build context. The React build is served by Vercel rewrites, and `window.APP_API_BASE` may well be **undefined** when the React app loads on `/dashboard/overview`, because the React build is a separate response.

This means `API_BASE` falls back to `https://revluma.vercel.app/api` — which hits Vercel and gets SPA-rewritten to serving `/Dashboard/dist/index.html` (a HTML response), NOT the backend API. Axios will parse the HTML as JSON and throw, causing `checkSession()` to hit the `catch` block, set `user = null`, and `App.tsx` redirects to login. → **This IS the redirect loop cause.**

**Evidence:** `loginIn.html` works because `apiConfig.js` runs first and sets `window.APP_API_BASE = 'https://revluma.onrender.com/api'`. The React app (`api.ts`) does NOT have this script loaded first in the HTML shell, so `window.APP_API_BASE` is undefined in the dashboard SPA. The fallback `${window.location.origin}/api` resolves to the Vercel proxy which returns HTML, not JSON, causing a parse error.

---

### 6. `Backend/src/routes/authSession.js` — `/me` Endpoint Response Shape

**Relevant code — `/me` route (authSession.js:391–436)**

```js
router.get('/me', async (req, res) => {
  const sessionAuth = await validateSession(req, res);
  if (sessionAuth) {
    const tenant = await prisma.tenant.findUnique({ where: { id: sessionAuth.user.tenantId } });
    // ...
    return res.status(200).json({
      authenticated: true,                         // ← top-level
      user: buildUserPayload(sessionAuth.user),     // ← nested user object
      onboarding_status:               // ← top-level field (NOT inside user)
        tenant?.onboardingStatus === 'completed' ? 'completed' : 'pending',
      connected_platforms: connectedPlatforms
    });
  }
  // ... Bearer JWT fallback path ...
});
```

**🟢 PASS — `onboarding_status` is a top-level field on the `/me` response, separate from the `user` field.**

`buildUserPayload()` also puts `onboarding_status` inside the user object:

```js
function buildUserPayload(user) {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName,
    role: user.role,
    tenant_id: user.tenantId,
    email_verified: user.emailVerified,
    onboarding_status: user.onboardingStatus    // ← also inside user
  };
}
```

So `/me` returns `{ authenticated: true, user: { ..., onboarding_status: "..." }, onboarding_status: "..." }`. The `onboarding_status` is in BOTH places. `AuthContext.tsx:64–67` correctly tries `response.data.onboarding_status` first, then falls back to `response.data.user?.onboarding_status`.

---

### 7. `Backend/src/middleware/sessionAuth.js` — Cookie Configuration

**Relevant code — `getCookieOptions()` (sessionAuth.js:18–27)**

```js
function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: isProduction ? 'none' : 'lax',  // ← production: 'none'  dev: 'lax'
    path: COOKIE_PATH,                         // ← COOKIE_PATH = '/'
    secure: isProduction,                      // ← production: true  dev: false
    maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
    expires: new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
  };
}
```

Settings summary:
| Field | Production Value | Dev Value |
|---|---|---|
| `sameSite` | `'none'` | `'lax'` |
| `secure` | `true` | `false` |
| `httpOnly` | `true` | `true` |
| `path` | `'/'` | `'/'` |

**🟢 PASS — Cookie `path: '/'` covers both `/auth/*` and `/dashboard/*` on the same domain.**

**🟡 WARNING — Production cookie settings: `sameSite: 'none'` + `secure: true`**

These settings are correct for cross-origin cookie behavior on Vercel (SPA served from `revluma.vercel.app`, backend at `revluma.onrender.com`). However:
- `sameSite: 'none'` **requires** `secure: true` — they are correctly coupled.
- The cookie will NOT be sent on a request from `revluma.vercel.app` to `revluma.onrender.com` UNLESS: the CORS configuration on the backend allows the Vercel origin AND the request uses `credentials: 'include'` AND the cookie domain is `.revluma.onrender.com` (browser scoping).

The cookie is set for the `.onrender.com` domain, so when the browser is on `revluma.vercel.app`, the cookie is NOT attached to cross-origin requests to `revluma.onrender.com` unless the cookie's `domain` attribute is explicitly set (it is NOT — `domain` is **absent** from `getCookieOptions()`).

The cookie is now scoped to `.revluma.onrender.com` by default (inferred from the `.onrender.com` host), NOT `.vercel.app`. This means the cookie IS accessible on all `*.revluma.onrender.com` subdomains, including the API backend — so it should be sent when the frontend (on Vercel) calls `revluma.onrender.com/api/me` with `credentials: include`. ✅

---

### 8. `Frontend/Dashboard/src/lib/api.ts` — Base URL (Re-analysis)

**🔴 FAIL — When `window.APP_API_BASE` is undefined (which it IS when the React SPA loads from the Vercel rewrite path), `api.ts` falls back to:**

```
`${window.location.origin}/api`
```

**When the vault-side reporter says `/dashboard/overview` is on Vercel, `window.location.origin = https://revluma.vercel.app`**

This means every API call goes to `https://revluma.vercel.app/api/...` — which hits Vercel's SPA rewrite rule, getting back the SPA HTML instead of a JSON API response. Axios throws a parse error → `checkSession()` catch block fires → `setUser(null)` → `loading = false` → `App.tsx` redirects to login. **This is the exact redirect loop.**

The `loginIn.html` auth pages DO load `auth-client.js` and `apiConfig.js`, which set `window.APP_API_BASE = 'https://revluma.onrender.com/api'`. But `api.ts` (React Dashboard) is part of the built SPA and has NO reference to those scripts. Even if scripts in `index.html` were to run, the SPA would already be building before hydration. However, the memory state left by `apiConfig.js` runs the `window.APP_API_BASE = apiBase` assignment on `window` — which persists across navigation for the same document tab; but since the SPA loads a **new document** under Vercel's rewrite, `window.APP_API_BASE` is undefined in the new page load.

---

### 9. `vercel.json` — Routing Rules

**Relevant code — vercel.json (vercel.json:22–35)**

```json
"rewrites": [
  {
    "source": "/dashboard/assets/:path*",
    "destination": "/Dashboard/dist/assets/:path*"
  },
  {
    "source": "/dashboard/:path*",
    "destination": "/Dashboard/dist/index.html"
  },
  {
    "source": "/dashboard",
    "destination": "/Dashboard/dist/index.html"
  }
]
```

- **No rewrite for `/api/*`** — requests to `/api/*` on Vercel either fall through to the backend (Render) or return 404.
- **No rewrite for `/auth/*`** — `/auth/loginIn.html` etc. would return 404 on Vercel unless these HTML files are also in the build output.
- **`/dashboard/*` → `/Dashboard/dist/index.html`** — This correctly serves the React SPA. BUT since `vercel.json` `"outputDirectory": "Frontend"` (line 3) places built output under `Frontend/Dashboard/dist/`, the actual served path would be `revluma.vercel.app/Dashboard/dist/index.html` — not matching the `/dashboard/:path*` rewrite pattern at all.

No "outputDirectory" hint is referenced in vercel.json:3. Let's parse this carefully:

`"outputDirectory": "Frontend"` — this tells Vercel that the build output (completed build) lives in `/Frontend` of the repo root after running `buildCommand`.

The build command is: `cd Frontend/Dashboard && npm install && npm run build` — this builds the React app, outputting `Frontend/Dashboard/dist/`. But Vercel looks for static files under `"outputDirectory": "Frontend"`, which means it will find `Frontend/Dashboard/dist/` as a subdirectory. The `/dashboard/assets/*` rewrite routes to `/Dashboard/dist/assets/` — this implies these are served relative to the deploy root.

Since `"outputDirectory": "Frontend"`, Vercel's built deployment would have the Dashboard dist at `.../Dashboard/dist/` from the deploy root — which matches the `/dashboard/assets/:path*` rewrite.

**🟡 WARNING — No explicit `/api` rewrite/proxy is configured.** If the Vercel site receives a request to `revluma.vercel.app/api/session/me`, Vercel has no rewrite for it. Depending on `outputDirectory`, it may 404 or fall through to the default 404 handler. If a user lands on Vercel (not Render), the Dashboard SPA would attempt to call `/api/session/me` → fails silently → redirect loop.

---

### 10. `Backend/server.js` — CORS Origins

**Relevant code — server.js:44–79**

```js
const configuredOrigins = new Set([
  ...parseOrigins(process.env.CORS_ORIGINS),
  ...parseOrigins(process.env.ALLOWED_ORIGINS),
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : [])
]);
if (configuredOrigins.size === 0 && isProduction) {
  configuredOrigins.add('https://revluma.vercel.app');
  configuredOrigins.add('https://www.revluma.vercel.app');
  configuredOrigins.add('https://revluma.onrender.com');
}

app.use(cors({
  origin: (origin, callback) => { /* ... */ },
  credentials: true,
  methods: ['GET', 'POST', ...],
  allowedHeaders: ['Content-Type', ..., 'X-CSRF-Token', ...]
}));
```

**🟢 PASS — CORS allows `credentials: true` and lists `revluma.vercel.app` explicitly in production defaults.**

The server supports requests from Vercel with credentials. This part is correct.

---

### 11. Cross-referencing: `loginIn.html` `redirectAfterLogin` vs `AuthContext.checkSession` + `App.tsx`

| Step | What happens |
|---|---|
| Login POST succeeds | Backend returns `{ user: buildUserPayload(user), csrfToken, sessionEstablished: true }` |
| Cookie is set on the POST response | `revluma_session` HTTP-only cookie set by browser on the POST response (cookie origin = render backend host) |
| `redirectAfterLogin(data.user)` fires | `window.location.href = '/dashboard/overview'` — navigates to Vercel |
| Vercel serves React SPA at `/dashboard/overview` | React app loads, `AuthContext.tsx` mounts |
| `checkSession()` calls `api.get('/session/me')` | `api.ts` baseURL = `https://revluma.vercel.app/api` because `window.APP_API_BASE` is undefined in the SPA |
| Request hits Vercel | Vercel has no `/api/*` rewrite → returns 404 HTML or 200 with HTML → axios JSON parse error |
| `checkSession()` catch block | `setUser(null)` |
| `setLoading(false)` in finally | triggers `App.tsx` render |
| `App.tsx` sees `user === null` | `window.location.href = '/auth/loginIn.html'` |
| User lands back on login page | Loops again |

**🔴 CONFIRMED — The redirect loop root cause is in `api.ts` base URL resolution in the React SPA.**

---

## PRIORITIZED FIX LIST

### Fix 1 — ROOT CAUSE: `api.ts` base URL must always point to the actual backend (`revluma.onrender.com/api`)

**File:** `Frontend/Dashboard/src/lib/api.ts`

Replace:
```ts
const API_BASE = window.APP_API_BASE?.replace(/\/$/, '') || (() => {
  if (window.location.protocol === 'file:' || !window.location.origin) {
    return 'http://localhost:5000/api';
  }
  return `${window.location.origin}/api`;
})();
```

With:
```ts
const API_BASE = window.APP_API_BASE?.replace(/\/$/, '') || (() => {
  const hostname = window.location.hostname.toLowerCase();
  const isVercelHost = hostname.endsWith('.vercel.app') || hostname.endsWith('.vercel.sh');
  const isRenderHost = hostname === 'revluma.onrender.com' || hostname.endsWith('.revluma.onrender.com');
  const isAllRevluma = hostname.includes('revluma');
  const isProduction = process.env.NODE_ENV === 'production' || isRenderHost || isVercelHost;

  if (window.location.protocol === 'file:') return 'http://localhost:5000/api';

  // In production (Vercel SPA or Render), API lives on the Render backend
  if (isProduction || isAllRevluma) {
    return 'https://revluma.onrender.com/api';
  }

  // Same-origin fallback for local dev (Express serves both /api and SPA)
  return `${window.location.origin.replace(/\/+$/, '')}/api`;
})();
```

This ensures any process.env-injected `APP_API_BASE` wins, AND the production fallback always goes to Render, not Vercel.

---

### Fix 2 — `vercel.json` must add `/api/*` rewrite/proxy so the SPA's fallback never hits Vercel

**File:** `vercel.json`

Add a proxy rewrite for all `/api/*` paths that point to the Render backend:

```json
{
  "source": "/api/:path*",
  "destination": "https://revluma.onrender.com/api/:path*"
}
```

Insert this into the `rewrites` array. This covers the case where API_BASE is not properly set at the window level and prevents a 404/HTML parse error.

---

### Fix 3 — `AuthContext.tsx` error handler should distinguish "not authenticated" from "server error"

**File:** `Frontend/Dashboard/src/context/AuthContext.tsx`

The `catch` block in `checkSession()` currently treats all errors identically (`setUser(null)`), including server-down or network errors. Add a `setError()` call on non-401 errors so `App.tsx` can distinguish a real "not logged in" from "backend down":

```ts
} catch (error) {
  const status = (error as AxiosError)?.response?.status;
  if (status === 401 || status === 403) {
    setUser(null);  // genuinely not authenticated
  } else {
    setError('Unable to connect to server. Please check your connection.');  // server/net error
    // Don't clear user — let per-session state survive the transient error
    setLoading(false);
    return;
  }
}
```

---

### Fix 4 — `App.tsx` should show an error screen instead of redirecting to login on transient errors

**File:** `Frontend/Dashboard/src/App.tsx`

Currently `App.tsx` unconditionally redirects to `/auth/loginIn.html` on `!user`. When the backend is temporarily unreachable (Fix 1 hasn't been deployed yet), this loop will persist. Replace the redirect line with an error display:

```tsx
if (!user) {
  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-500 mb-2">Connection Error</p>
          <p className="text-sm text-gray-500">{error}</p>
          <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-gray-200 rounded">Retry</button>
        </div>
      </div>
    );
  }
  console.error('[DASHBOARD APP] No user authenticated, redirecting to login');
  window.location.href = '/auth/loginIn.html';
  return null;
}
```

---

### Fix 5 — Ensure the login page's submit handler verifies the server-side session before redirecting

**File:** `Frontend/auth/loginIn.html`

The normal submit path calls `redirectAfterLogin(data.user)` immediately. Replace it with `verifyServerSessionAndRedirect(data.user)` (the function already exists and checks `/session/me` before calling `redirectAfterLogin`):

```js
// Replace this (line ~1586):
showSuccess('Signed in — redirecting…');
setTimeout(() => {
  redirectAfterLogin(data.user);
}, 900);

// With this:
showSuccess('Signed in — verifying session…');
verifyServerSessionAndRedirect(data.user);
```

This adds a server-side pre-flight check: if the session cookie wasn't set or isn't recognized by the backend, the user gets an error toast instead of a redirect loop.

---

## SUMMARY TABLE

| # | File | Status | Issue |
|---|---|---|---|
| 1 | `api.ts` | 🔴 FAIL | Base URL falls back to `window.location.origin/api` → Vercel SPA URL, not backend |
| 2 | `vercel.json` | 🔴 FAIL | No `/api/*` rewrite to Render backend |
| 3 | `AuthContext.tsx` | 🟡 WARN | Catch-all `setUser(null)` masks server-down vs not-authenticated |
| 4 | `App.tsx` | 🟡 WARN | Unconditional redirect to login when user is null, no error screen |
| 5 | `loginIn.html` | 🟡 WARN | Submit path skips `verifyServerSessionAndRedirect()`, no server-side session check |
| 6 | `authSession.js /me` | 🟢 PASS | Response shape correct, `onboarding_status` present both top-level and nested |
| 7 | `sessionAuth.js` cookie | 🟢 PASS | `path: '/'` correct, `sameSite: 'none'` + `secure: true` correctly paired |
| 8 | `App.tsx` render | 🟢 PASS | Logic correct — redirects on `!user` as expected |
| 9 | CORS in `server.js` | 🟢 PASS | Vercel origin whitelisted, `credentials: true` |

---

## PRIORITY ORDER (fix in this order)

1. **Fix 1** (`api.ts`): Hardcode the Render backend URL for production. This is the single root cause of the redirect loop.
2. **Fix 2** (`vercel.json`): Add `/api/*` rewrite to Render backend as a safety net.
3. **Fix 5** (`loginIn.html`): Use `verifyServerSessionAndRedirect` instead of `redirectAfterLogin` on normal submit.
4. **Fix 3** (`AuthContext.tsx`): Distinguish 401/403 from other errors.
5. **Fix 4** (`App.tsx`): Show an error UI instead of hard-redirecting on transient failures.
