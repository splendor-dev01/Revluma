import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '@/lib/utils';
import type { AxiosError } from 'axios';

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

const SESSION_POLL_INTERVAL = 5 * 60 * 1000;
const SESSION_VALIDATION_TIMEOUT = 30 * 1000;

// Every key that could hold auth state across the app
const ALL_AUTH_KEYS = [
  'revluma_token',
  'revluma_user',
  'revluma_pending_token',
  'csrf_token',
  'auth_bridge',
  'rv_auth_bridge',
];

function nukeAllAuthStorage() {
  ALL_AUTH_KEYS.forEach(key => {
    try { localStorage.removeItem(key); } catch {}
    try { sessionStorage.removeItem(key); } catch {}
  });
  try { sessionStorage.clear(); } catch {}
}

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const checkSessionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const userRef = useRef<User | null>(null);
  const isLoggingOut = useRef(false);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  const checkSession = useCallback(async () => {
    try {
      const response = await api.get('/session/me', {
        withCredentials: true,
        timeout: SESSION_VALIDATION_TIMEOUT
      });

      if (response.data?.authenticated) {
        const authenticatedUser: User = {
          ...response.data.user,
          onboarding_status:
            response.data.onboarding_status ??
            response.data.user?.onboarding_status ??
            'pending'
        };
        setUser(authenticatedUser);
        setError(null);
      } else {
        setUser(null);
      }
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status === 401 || status === 403) {
        setUser(null);
      } else {
        if (!userRef.current) {
          setError('Unable to connect to server. Please check your connection.');
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

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

        if (response.data.user) {
          const loggedInUser: User = {
            ...response.data.user,
            onboarding_status:
              response.data.onboarding_status ??
              response.data.user?.onboarding_status ??
              'pending'
          };
          setUser(loggedInUser);
          userRef.current = loggedInUser;
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
      console.error('[AUTH] Logout server call failed:', err);
      // Always continue with local cleanup
    } finally {
      // 1. Clear React state
      setUser(null);
      userRef.current = null;
      setCsrfToken(null);

      // 2. Nuke ALL auth storage — this is the critical fix
      // Clears revluma_token, revluma_user, all JWT tokens, CSRF tokens
      nukeAllAuthStorage();

      // 3. Set a persistent logout flag (5 minute window, not 10 seconds)
      // This prevents checkAutoLogin from running on the login page after logout
      try {
        localStorage.setItem('rv_logged_out', Date.now().toString());
      } catch {}

      // 4. Signal other tabs
      try {
        localStorage.setItem('auth_logout_signal', Date.now().toString());
        // Small delay then remove so storage event fires in other tabs
        setTimeout(() => {
          try { localStorage.removeItem('auth_logout_signal'); } catch {}
        }, 500);
      } catch {}

      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      setLoading(false);
      isLoggingOut.current = false;
      window.location.href = '/auth/loginIn.html';
    }
  }, [csrfToken]);

  const clearError = useCallback(() => setError(null), []);

  useEffect(() => {
    checkSession();

    pollIntervalRef.current = setInterval(() => {
      if (!isLoggingOut.current) checkSession();
    }, SESSION_POLL_INTERVAL);

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'auth_logout_signal' && e.newValue) {
        setUser(null);
        userRef.current = null;
        setCsrfToken(null);
        nukeAllAuthStorage();
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        window.location.href = '/auth/loginIn.html';
      }
    };

    window.addEventListener('storage', handleStorageChange);

    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (checkSessionTimeoutRef.current) clearTimeout(checkSessionTimeoutRef.current);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [checkSession]);

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
        if ((status === 401 || status === 403) && userRef.current && !isLoggingOut.current) {
          setUser(null);
          userRef.current = null;
          setCsrfToken(null);
          nukeAllAuthStorage();
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