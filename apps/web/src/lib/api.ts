import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth.store';

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
        return envUrl.endsWith('/api/v1') ? envUrl : `${envUrl.replace(/\/$/, '')}/api/v1`;
      }
      return 'http://localhost:4000/api/v1';
    }
  }

  // 3. Fallback for SSR or custom domains
  if (envUrl) {
    return envUrl.endsWith('/api/v1') ? envUrl : `${envUrl.replace(/\/$/, '')}/api/v1`;
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

// Request interceptor — attach access token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (typeof window !== 'undefined') {
    console.log(`🚀 [API Request] ${config.method?.toUpperCase()} ${config.url}`, {
      hasToken: !!token,
      tokenPreview: token ? `${token.substring(0, 15)}...` : 'none',
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

    // Handle network / server unreachable errors
    const isNetworkError =
      error.code === 'ERR_NETWORK' ||
      error.message === 'Network Error' ||
      !error.response;

    if (isNetworkError) {
      toast.error('Unable to connect to backend server. Please verify the server is running.', {
        id: 'network-error',
      });
      return Promise.reject(error);
    }

    // Show error toast for server errors
    const errorMessage =
      error.response?.data?.error ?? error.message ?? 'Something went wrong';
    const errorCode = error.response?.data?.code;

    // Don't toast for validation errors (handled in forms)
    if (errorCode !== 'VALIDATION_ERROR' && error.response?.status !== 400) {
      toast.error(errorMessage);
    }

    return Promise.reject(error);
  }
);

export default api;
