import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/utils';
import type { AxiosError } from 'axios';

// ============================================================
// AUTH CONTEXT — 24-hour session, no redirect loops
// ============================================================

export interface User {
  id: string;
  email: string;
  full_name: string;
  tenant_id: string;
  onboarding_status: 'completed' | 'pending';
  email_verified: boolean;
}

export interface AuthContextProps {
  user: User | null;
  loading: boolean;
  error: string | null;
  csrfToken: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextProps | undefined>(undefined);

// Session polling — check every 10 minutes (not 5, to reduce server load)
const SESSION_POLL_INTERVAL = 10 * 60 * 1000;
const SESSION_VALIDATION_TIMEOUT = 15 * 1000;

// Key used by loginIn.html to pass auth state to dashboard
const AUTH_BRIDGE_KEY = 'rv_auth_bridge';
const AUTH_BRIDGE_TTL_MS = 30 * 1000; // Bridge data valid for 30 seconds

// ============================================================
// HELPERS
// ============================================================

function buildUserFromResponse(data: any): User | null {
  if (!data?.user) return null;
  return {
    ...data.user,
    onboarding_status:
      data.onboarding_status ??
      data.user?.onboarding_status ??
      'pending'
  };
}

function readAuthBridge(): User | null {
  try {
    const raw = sessionStorage.getItem(AUTH_BRIDGE_KEY);
    if (!raw) return null;
    const { user, timestamp } = JSON.parse(raw);
    if (Date.now() - timestamp > AUTH_BRIDGE_TTL_MS) {
      sessionStorage.removeItem(AUTH_BRIDGE_KEY);
      return null;
    }
    return user;
  } catch {
    return null;
  }
}

function clearAuthBridge() {
  sessionStorage.removeItem(AUTH_BRIDGE_KEY);
}

// ============================================================
// PROVIDER
// ============================================================

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const userRef = useRef<User | null>(null);
  const isLoggingOut = useRef(false);

  // Keep userRef in sync
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // ============================================================
  // CHECK SESSION — called on mount and every 10 min
  // ============================================================
  const checkSession = useCallback(async () => {
    // 1. Check if loginIn.html passed auth state via bridge
    const bridgeUser = readAuthBridge();
    if (bridgeUser) {
      console.log('[AUTH] Using auth bridge from login page');
      clearAuthBridge();
      setUser(bridgeUser);
      setError(null);
      setLoading(false);
      return;
    }

    // 2. Verify with server
    try {
      const response = await api.get('/session/me', {
        withCredentials: true,
        timeout: SESSION_VALIDATION_TIMEOUT
      });

      if (response.data?.authenticated) {
        const authenticatedUser = buildUserFromResponse(response.data);
        if (authenticatedUser) {
          setUser(authenticatedUser);
          setError(null);
        } else {
          setUser(null);
        }
      } else {
        setUser(null);
      }
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;

      if (status === 401 || status === 403) {
        // Genuinely not authenticated — clear and let App.tsx redirect
        setUser(null);
      } else {
        // Network/server error — don't clear existing user, show error
        if (!userRef.current) {
          setError('Unable to connect to server. Please check your connection.');
        }
        console.error('[AUTH] Session check failed:', err instanceof Error ? err.message : String(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================================
  // LOGIN — called from dashboard login form (if used)
  // ============================================================
  const login = useCallback(async (email: string, password: string) => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.post('/session/login', {
        email: email.toLowerCase().trim(),
        password
      }, { withCredentials: true });

      if (response.data) {
        if (response.data.csrfToken) {
          setCsrfToken(response.data.csrfToken);
          sessionStorage.setItem('csrf_token', response.data.csrfToken);
        }

        const loggedInUser = buildUserFromResponse(response.data);
        if (loggedInUser) {
          setUser(loggedInUser);
          userRef.current = loggedInUser;
        }

        // Store expiry for UI display
        if (response.data.expiresAt) {
          sessionStorage.setItem('rv_session_expires', response.data.expiresAt);
        }

        setTimeout(() => {
          window.location.href = '/dashboard/overview';
        }, 100);
      }
    } catch (err) {
      const errorMessage = (err as AxiosError<{ error?: string }>)?.response?.data?.error
        || 'Login failed. Please try again.';
      setError(errorMessage);
      setUser(null);
      setLoading(false);
      throw err;
    }
  }, []);

  // ============================================================
  // LOGOUT — clears session on server + client
  // ============================================================
  const logout = useCallback(async () => {
    if (isLoggingOut.current) return;
    isLoggingOut.current = true;
    setLoading(true);

    try {
      const token = csrfToken || sessionStorage.getItem('csrf_token');
      const headers: Record<string, string> = {};
      if (token) headers['X-CSRF-Token'] = token;

      await api.post('/session/logout', {}, { withCredentials: true, headers });
    } catch (err) {
      console.error('[AUTH] Logout error:', err);
      // Continue with local cleanup even if server fails
    } finally {
      // Always clean up local state
      setUser(null);
      userRef.current = null;
      setCsrfToken(null);
      clearAuthBridge();
      sessionStorage.removeItem('csrf_token');
      sessionStorage.removeItem('rv_session_expires');
      sessionStorage.clear();

      // Signal other tabs to logout
      localStorage.setItem('rv_logout_signal', Date.now().toString());
      localStorage.removeItem('rv_logout_signal');

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      setLoading(false);
      isLoggingOut.current = false;
      window.location.href = '/auth/loginIn.html';
    }
  }, [csrfToken]);

  const clearError = useCallback(() => setError(null), []);

  // ============================================================
  // MOUNT — initial session check + polling
  // ============================================================
  useEffect(() => {
    checkSession();

    // Poll every 10 minutes to detect expired sessions
    pollIntervalRef.current = setInterval(() => {
      if (!isLoggingOut.current) checkSession();
    }, SESSION_POLL_INTERVAL);

    // Cross-tab logout sync
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'rv_logout_signal' && e.newValue) {
        setUser(null);
        userRef.current = null;
        setCsrfToken(null);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        window.location.href = '/auth/loginIn.html';
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [checkSession]);

  // ============================================================
  // AXIOS INTERCEPTORS — attach CSRF + handle 401
  // ============================================================
  useEffect(() => {
    const requestInterceptor = api.interceptors.request.use((config) => {
      const token = csrfToken || sessionStorage.getItem('csrf_token');
      if (token) config.headers['X-CSRF-Token'] = token;
      return config;
    });

    const errorInterceptor = api.interceptors.response.use(
      (response) => response,
      (err) => {
        const status = err.response?.status;
        // Only redirect on 401/403 if user was previously authenticated
        // This prevents redirect on the initial /session/me check
        if ((status === 401 || status === 403) && userRef.current && !isLoggingOut.current) {
          console.warn('[AUTH] Session expired mid-session, redirecting to login');
          setUser(null);
          userRef.current = null;
          setCsrfToken(null);
          sessionStorage.removeItem('csrf_token');
          window.location.href = '/auth/loginIn.html';
        }
        return Promise.reject(err);
      }
    );

    return () => {
      api.interceptors.request.eject(requestInterceptor);
      api.interceptors.response.eject(errorInterceptor);
    };
  }, [csrfToken]);

  return (
    <AuthContext.Provider value={{ user, loading, error, csrfToken, login, logout, checkSession, clearError }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextProps => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};