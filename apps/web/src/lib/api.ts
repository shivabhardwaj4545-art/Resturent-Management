import axios, { AxiosError } from 'axios';
import { useAuthStore } from '@/store/auth.store';

declare module 'axios' {
  export interface AxiosRequestConfig {
    skipToast?: boolean;
  }
}

function sanitizeApiUrl(url: string): string {
  let clean = url.trim().replace(/\/+$/, '');
  while (clean.endsWith('/api/v1/api/v1')) {
    clean = clean.slice(0, -7);
  }
  return clean.endsWith('/api/v1') ? clean : `${clean}/api/v1`;
}

export function getApiBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    // 1. Live Render deployment resolution
    if (hostname.includes('.onrender.com')) {
      if (!envUrl || envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
        const serverHostname = hostname.replace('-web', '-server');
        return `${protocol}//${serverHostname}/api/v1`;
      }
    }

    // 2. Local development fallback
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      if (envUrl && !envUrl.includes('localhost')) {
        return sanitizeApiUrl(envUrl);
      }
      return 'http://localhost:4000/api/v1';
    }

    // 3. Live VPS / Railway / Custom Domain resolution
    if (envUrl && !envUrl.includes('localhost')) {
      return sanitizeApiUrl(envUrl);
    }

    return `${window.location.origin}/api/v1`;
  }

  // Fallback for SSR or build time
  if (envUrl) {
    return sanitizeApiUrl(envUrl);
  }

  return 'http://localhost:4000/api/v1';
}

export const API_BASE_URL = getApiBaseUrl();

if (typeof window !== 'undefined') {
  console.log('🔌 Dynamic API Base URL resolved:', API_BASE_URL);
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000,
});

// Request interceptor — attach access token & fix FormData content-type header
api.interceptors.request.use((config) => {
  if (config.data instanceof FormData && config.headers) {
    delete config.headers['Content-Type'];
    delete (config.headers as any)['content-type'];
  }
  const token = useAuthStore.getState().accessToken;
  if (typeof window !== 'undefined') {
    console.log(`🚀 [API Request] ${config.method?.toUpperCase()} ${config.url}`, {
      hasToken: !!token,
      tokenPreview: token ? `${token.substring(0, 15)}...` : 'none',
      isFormData: config.data instanceof FormData,
    });
  }
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor — handle 401 and refresh token
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token ?? '');
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error: string; code: string }>) => {
    const originalRequest = error.config as typeof error.config & { _retry?: boolean };

    if (typeof window !== 'undefined') {
      console.warn(`⚠️ [API Response Error] ${originalRequest?.method?.toUpperCase()} ${originalRequest?.url}`, {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message,
      });
    }

    const isAuthUrl =
      originalRequest?.url?.includes('/auth/login') ||
      originalRequest?.url?.includes('/auth/register') ||
      originalRequest?.url?.includes('/auth/refresh');

    const hasSession = typeof window !== 'undefined' && (!!useAuthStore.getState().accessToken || !!useAuthStore.getState().user);

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthUrl && hasSession) {
      if (isRefreshing) {
        if (typeof window !== 'undefined') {
          console.log('🔄 [API Refresh] Already refreshing, queuing request...');
        }
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      if (typeof window !== 'undefined') {
        console.log('🔄 [API Refresh] Starting token refresh...');
      }

      try {
        const { data } = await axios.post(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true }
        );

        const newToken = data.data.accessToken as string;
        const refreshedUser = data.data.user;

        if (typeof window !== 'undefined') {
          console.log('🔄 [API Refresh] Success. New token obtained. User:', refreshedUser);
        }

        if (refreshedUser) {
          useAuthStore.getState().setUser(refreshedUser, newToken);
        } else {
          useAuthStore.getState().setAccessToken(newToken);
        }

        processQueue(null, newToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
        }

        return api(originalRequest);
      } catch (refreshError: any) {
        if (typeof window !== 'undefined') {
          console.warn('⚠️ [API Refresh] Refresh token expired or unavailable.');
        }
        processQueue(refreshError as Error, null);
        useAuthStore.getState().logout();
        if (typeof window !== 'undefined') {
          const currentPath = window.location.pathname;
          if ((currentPath.startsWith('/owner') || currentPath.startsWith('/admin')) && !currentPath.includes('/login')) {
            window.location.href = '/login';
          }
        }
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    // Handle network / slow connection / timeout / server unreachable errors
    const isNetworkOrSlowError =
      error.code === 'ERR_NETWORK' ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ETIMEDOUT' ||
      error.message === 'Network Error' ||
      error.message?.toLowerCase().includes('timeout') ||
      error.message?.toLowerCase().includes('network') ||
      !error.response ||
      error.response?.status >= 500;

    if (isNetworkOrSlowError) {
      if (typeof window !== 'undefined') {
        console.warn('⚠️ [API Network/Server] Network is slow, timed out, or backend server is unreachable.');
      }
      return Promise.reject(error);
    }

    // Do NOT show global red error toast popups on any request.
    // Errors should be handled contextually by individual components without intrusive popups.
    return Promise.reject(error);
  }
);

export function getSocketUrl(): string {
  if (typeof window !== 'undefined') {
    const envSocketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;
    if (envSocketUrl && !envSocketUrl.includes('localhost')) {
      return envSocketUrl.replace(/\/+$/, '');
    }

    const hostname = window.location.hostname;
    const protocol = window.location.protocol;

    if (hostname.includes('.onrender.com')) {
      const serverHostname = hostname.replace('-web', '-server');
      return `${protocol}//${serverHostname}`;
    }

    // Automatically derive socket URL from resolved API base URL
    const apiBase = getApiBaseUrl();
    if (apiBase && !apiBase.includes('localhost') && !apiBase.includes('127.0.0.1')) {
      const derived = apiBase.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
      if (derived && !derived.includes(hostname)) {
        return derived;
      }
    }

    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      if (process.env.NEXT_PUBLIC_API_URL && !process.env.NEXT_PUBLIC_API_URL.includes('localhost')) {
        return process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/v1\/?$/, '').replace(/\/+$/, '');
      }
      return 'http://localhost:4000';
    }

    return `${window.location.origin}`;
  }

  const envSocket = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/, '');
  return envSocket ? envSocket.replace(/\/+$/, '') : 'http://localhost:4000';
}

export default api;
