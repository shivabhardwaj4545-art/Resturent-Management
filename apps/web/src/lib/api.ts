import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';
import { useAuthStore } from '@/store/auth.store';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

if (typeof window !== 'undefined') {
  console.log('🔌 API Base URL:', API_BASE_URL);
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

    if (error.response?.status === 401 && !originalRequest._retry && !isAuthUrl) {
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
          console.error('❌ [API Refresh] Token refresh failed:', refreshError);
        }
        processQueue(refreshError as Error, null);
        
        // Only log out if backend explicitly returns 401 (invalid/expired refresh token)
        if (refreshError.response?.status === 401) {
          useAuthStore.getState().logout();
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
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
