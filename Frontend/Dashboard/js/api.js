/**
 * Revluma API Client
 * Production-ready API integration for dashboard
 * 
 * Usage:
 *   const data = await api.dashboard.get();
 *   const revenue = await api.metrics.revenue();
 *   const insights = await api.insights.get();
 */

const RevlumaAPI = (function() {
  'use strict';

  const API_BASE = '/api/v1';
  
  // Token management - check both localStorage and sessionStorage
  function getToken() {
    return localStorage.getItem('revluma_token') || sessionStorage.getItem('revluma_token');
  }
  
  function getRefreshToken() {
    return localStorage.getItem('revluma_refresh') || sessionStorage.getItem('revluma_refresh');
  }

  let authToken = getToken();
  let refreshToken = getRefreshToken();

  async function request(endpoint, options = {}) {
    const token = getToken();
    const url = `${API_BASE}${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      },
      ...options
    };

    try {
      const response = await fetch(url, config);
      
      if (response.status === 401) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
          const newToken = getToken();
          config.headers.Authorization = `Bearer ${newToken}`;
          return fetch(url, config);
        }
        handleLogout();
        throw new Error('Session expired');
      }

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  async function authRequest(endpoint, options = {}) {
    const token = getToken();
    const url = `${API_BASE}/auth${endpoint}`;
    const config = {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
      },
      ...options
    };

    try {
      const response = await fetch(url, config);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Auth request failed');
      return data;
    } catch (error) {
      console.error(`Auth API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  async function refreshAccessToken() {
    const currentRefresh = getRefreshToken();
    if (!currentRefresh) return false;

    try {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: currentRefresh })
      });

      if (!response.ok) return false;

      const data = await response.json();
      
      localStorage.setItem('revluma_token', data.token);
      localStorage.setItem('revluma_refresh', data.refreshToken);

      return true;
    } catch (error) {
      console.error('Token refresh failed:', error);
      return false;
    }
  }

  function handleLogout() {
    localStorage.removeItem('revluma_token');
    localStorage.removeItem('revluma_user');
    localStorage.removeItem('revluma_refresh');
    sessionStorage.removeItem('revluma_token');
    sessionStorage.removeItem('revluma_user');
    sessionStorage.removeItem('revluma_refresh');
    authToken = null;
    refreshToken = null;
    window.location.href = '../auth/loginIn.html';
  }

  const auth = {
    async me() {
      const data = await authRequest('/me');
      return data.user;
    },

    async login(email, password) {
      const data = await authRequest('/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });
      
      if (data.token) {
        authToken = data.token;
        refreshToken = data.refreshToken;
        localStorage.setItem('revluma_token', authToken);
        localStorage.setItem('revluma_refresh', refreshToken);
      }
      
      return data;
    },

    async logout() {
      try {
        await authRequest('/logout', { method: 'POST' });
      } catch (e) {}
      handleLogout();
    },

    async getOnboardingStatus() {
      const data = await authRequest('/onboarding/status');
      return data.onboarding;
    }
  };

  const notifications = {
    async list(options = {}) {
      const params = new URLSearchParams(options).toString();
      const data = await request(`/notifications?${params}`);
      return data;
    },

    async markRead(id) {
      const data = await request(`/notifications/${id}/read`, {
        method: 'POST'
      });
      return data;
    },

    async markAllRead() {
      const data = await request('/notifications/read-all', {
        method: 'POST'
      });
      return data;
    }
  };

  const dashboard = {
    async get(range = '30d') {
      const data = await request(`/dashboard?range=${range}`);
      return data.data;
    },

    async summary() {
      const data = await request('/dashboard/summary');
      return data.data;
    }
  };

  const metrics = {
    async get(range = '30d') {
      const data = await request(`/metrics?range=${range}`);
      return data.data;
    },

    async revenue(range = '30d') {
      const data = await request(`/metrics/revenue?range=${range}`);
      return data.data;
    },

    async customers() {
      const data = await request(`/metrics/customers`);
      return data.data;
    }
  };

  const customers = {
    async list(options = {}) {
      const params = new URLSearchParams(options).toString();
      const data = await request(`/customers?${params}`);
      return data.data;
    },

    async segments() {
      const data = await request('/customers/segments');
      return data.data;
    },

    async get(id) {
      const data = await request(`/customers/${id}`);
      return data.data;
    }
  };

  const insights = {
    async get() {
      const data = await request('/insights');
      return data.data;
    },

    async recommendations() {
      const data = await request('/insights/recommendations');
      return data.data;
    }
  };

  // ============================================================
  // Products API
  // ============================================================
  
  const products = {
    async trending(limit = 10) {
      const data = await request(`/trending?limit=${limit}`);
      return data.data;
    }
  };

  let ws = null;
  let wsReconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;

  function connectWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) return;

    const wsUrl = (window.location.protocol === 'https:' ? 'wss:' : 'ws:') 
      + '//' + window.location.host + '/api/v1/ws';

    try {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        wsReconnectAttempts = 0;
        
        if (authToken) {
          ws.send(JSON.stringify({ type: 'auth', token: authToken }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          handleWebSocketMessage(message);
        } catch (error) {
          console.error('WebSocket message parse error:', error);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        
        if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          const delay = Math.min(1000 * Math.pow(2, wsReconnectAttempts), 30000);
          setTimeout(connectWebSocket, delay);
          wsReconnectAttempts++;
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (error) {
      console.error('WebSocket connection failed:', error);
    }
  }

  function handleWebSocketMessage(message) {
    const event = new CustomEvent('api:' + message.type, { detail: message.data });
    document.dispatchEvent(event);
  }

  function disconnectWebSocket() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function on(eventType, callback) {
    document.addEventListener('api:' + eventType, callback);
    return () => document.removeEventListener('api:' + eventType, callback);
  }
  
  return {
    request,
    auth,
    dashboard,
    metrics,
    customers,
    insights,
    products,
    notifications,
    ws: {
      connect: connectWebSocket,
      disconnect: disconnectWebSocket
    },
    on,
    setTokens(token, refresh) {
      authToken = token;
      refreshToken = refresh;
      localStorage.setItem('revluma_token', token);
      localStorage.setItem('revluma_refresh', refresh);
    },
    clearTokens() {
      authToken = null;
      refreshToken = null;
      localStorage.removeItem('revluma_token');
      localStorage.removeItem('revluma_user');
      localStorage.removeItem('revluma_refresh');
      sessionStorage.removeItem('revluma_token');
      sessionStorage.removeItem('revluma_user');
      sessionStorage.removeItem('revluma_refresh');
    },
    isAuthenticated() {
      return !!getToken();
    },
    formatCurrency: (value) => {
      return new Intl.NumberFormat('en-US', {
        notation: 'compact',
        maximumFractionDigits: 1,
        style: 'currency',
        currency: 'USD'
      }).format(value);
    },
    formatPercent: (value) => {
      return new Intl.NumberFormat('en-US', {
        style: 'percent',
        minimumFractionDigits: 1
      }).format(value / 100);
    }
  };

})();

if (typeof window !== 'undefined') {
  window.RevlumaAPI = RevlumaAPI;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = RevlumaAPI;
}
