import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isVerified: boolean;
  loyaltyPoints: number;
  walletBalance: number;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  loginRestaurantSlug: string | null;

  setUser: (user: User, accessToken: string, loginRestaurantSlug?: string | null) => void;
  setAccessToken: (token: string) => void;
  updateUser: (updates: Partial<User>) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: false,
      loginRestaurantSlug: null,

      setUser: (user, accessToken, loginRestaurantSlug = null) =>
        set({ user, accessToken, isAuthenticated: true, loginRestaurantSlug }),

      setAccessToken: (accessToken) => set({ accessToken }),

      updateUser: (updates) => {
        const currentUser = get().user;
        if (currentUser) {
          set({ user: { ...currentUser, ...updates } });
        }
      },

      logout: () => set({ user: null, accessToken: null, isAuthenticated: false, loginRestaurantSlug: null }),

      setLoading: (isLoading) => set({ isLoading }),
    }),
    {
      name: 'qr-restaurant-auth',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined'
          ? localStorage
          : { getItem: () => null, setItem: () => {}, removeItem: () => {} }
      ),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        isAuthenticated: state.isAuthenticated,
        loginRestaurantSlug: state.loginRestaurantSlug,
      }),
    }
  )
);
