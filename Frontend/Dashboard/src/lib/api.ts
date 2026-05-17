import axios from 'axios';

const API_BASE = window.APP_API_BASE?.replace(/\/$/, '') || (() => {
  const hostname = window.location.hostname.toLowerCase();
  const isVercelHost = hostname.endsWith('.vercel.app') || hostname.endsWith('.vercel.sh');
  const isRenderHost = hostname === 'revluma.onrender.com' || hostname.endsWith('.revluma.onrender.com');
  const isAllRevluma = hostname.includes('revluma');
  const isProduction = process.env.NODE_ENV === 'production' || isRenderHost || isVercelHost;

  if (window.location.protocol === 'file:') return 'http://localhost:5000/api';

  // In production (Vercel SPA or Render), API always lives on the Render backend
  if (isProduction || isAllRevluma) {
    return 'https://revluma.onrender.com/api';
  }

  // Same-origin fallback for local dev only
  return `${window.location.origin.replace(/\/+$/, '')}/api`;
})();

const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true, // Always send cookies with requests
});

export default api;