'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, Mail, Lock, Loader2, QrCode, Shield, Store } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/ThemeToggle';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const restaurantSlug = searchParams.get('restaurant');
  const isPartner = searchParams.get('partner') === 'true';
  const { setUser } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    try {
      const response = await api.post('/auth/login', {
        ...data,
        restaurantSlug: restaurantSlug || undefined,
      });
      const { user, accessToken } = response.data.data as {
        user: {
          id: string; name: string; email: string; phone: string | null;
          role: string; isVerified: boolean; loyaltyPoints: number; walletBalance: number;
        };
        accessToken: string;
      };

      setUser(user, accessToken, restaurantSlug || null);

      if (user.role === 'SUPER_ADMIN') {
        router.push('/admin/dashboard');
      } else if (user.role === 'RESTAURANT_OWNER') {
        router.push('/owner/dashboard');
      } else if (restaurantSlug) {
        router.push(`/r/${restaurantSlug}`);
      } else {
        router.push('/');
      }

      toast.success(`Welcome back, ${user.name}! 👋`);
    } catch {
      // Error handled by interceptor
    } finally {
      setLoading(false);
    }
  };



  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4 relative">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl" />
      </div>

      {/* Theme Toggle - top right */}
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`w-full ${isPartner ? 'max-w-4xl grid md:grid-cols-2 gap-8' : 'max-w-md'} items-stretch my-8 relative z-10`}
      >
        {/* Left Column: Login Form */}
        <div className="flex flex-col justify-between">
          <div className="text-center mb-8">
            <Link href="/" className="inline-flex items-center gap-2 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
                <QrCode className="w-5 h-5 text-white" />
              </div>
              <span className="font-display font-bold text-xl text-foreground">QR Restaurant</span>
            </Link>
            <h1 className="font-display text-3xl font-bold text-foreground mb-2">
              {restaurantSlug ? 'Customer Login' : isPartner ? 'Partner & Owner Login' : 'Welcome back'}
            </h1>
            <p className="text-muted-foreground">
              {restaurantSlug
                ? `Sign in to order from ${restaurantSlug.toUpperCase()}`
                : isPartner
                ? 'Sign in to manage your restaurant'
                : 'Sign in to your account'}
            </p>
          </div>

          <div className="bg-card backdrop-blur-xl border border-border rounded-2xl p-6 shadow-2xl flex-1 flex flex-col justify-center">
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    {...register('email')}
                    type="email"
                    placeholder="you@example.com"
                    className="w-full pl-9 pr-4 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/50"
                  />
                </div>
                {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
              </div>

              <div>
                <label className="text-sm font-medium text-foreground mb-1.5 block">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-10 py-3 bg-muted border border-border rounded-xl text-foreground placeholder:text-muted-foreground text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>}
              </div>

              <div className="flex justify-end">
                <Link href={restaurantSlug ? `/forgot-password?restaurant=${restaurantSlug}` : "/forgot-password"} className="text-sm text-orange-400 hover:text-orange-300">
                  Forgot password?
                </Link>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-xl text-white font-semibold bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 transition-all shadow-lg shadow-orange-500/20 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>

            {/* Divider */}
            <div className="my-5 flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-muted-foreground text-xs">OR</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Google OAuth */}
            <a
              href={`${process.env.NEXT_PUBLIC_API_URL}/auth/google`}
              className="w-full flex items-center justify-center gap-3 py-3 bg-muted border border-border rounded-xl text-foreground text-sm font-medium hover:bg-accent transition-colors"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </a>

            <p className="text-center text-muted-foreground text-sm mt-5">
              Don't have an account?{' '}
              <Link href={restaurantSlug ? `/register?restaurant=${restaurantSlug}` : "/register"} className="text-orange-400 hover:text-orange-300 font-medium">
                Sign up
              </Link>
            </p>
          </div>
        </div>

        {/* Right Column: Partner Info Panel (only shown in partner mode) */}
        {isPartner && (
          <div className="bg-card backdrop-blur-xl border border-border rounded-2xl p-6 shadow-2xl flex flex-col justify-between">
            <div className="flex flex-col h-full">
              <div className="mb-6">
                <h2 className="font-display text-xl font-bold text-foreground mb-2 flex items-center gap-2">
                  <Store className="w-5 h-5 text-amber-400" />
                  Restaurant Partner Portal
                </h2>
                <p className="text-muted-foreground text-sm">
                  Sign in with your partner account to manage your restaurant.
                </p>
              </div>

              <div className="space-y-4 flex-1">
                {/* Owner Access */}
                <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                      <Store className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground text-sm">Restaurant Owner</p>
                      <p className="text-[10px] text-amber-400">Full dashboard access</p>
                    </div>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1 pl-1">
                    <li>• Manage your menu & categories</li>
                    <li>• View and manage orders in real-time</li>
                    <li>• Customize branding & settings</li>
                    <li>• Track analytics & revenue</li>
                  </ul>
                </div>

                {/* Admin Access */}
                <div className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/20">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                      <Shield className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="font-semibold text-foreground text-sm">Super Admin</p>
                      <p className="text-[10px] text-purple-400">Platform management</p>
                    </div>
                  </div>
                  <ul className="text-xs text-muted-foreground space-y-1 pl-1">
                    <li>• Approve & manage restaurants</li>
                    <li>• View system-wide statistics</li>
                    <li>• Manage platform users</li>
                  </ul>
                </div>

                <div className="p-3 rounded-xl bg-muted border border-border text-center mt-auto">
                  <p className="text-xs text-muted-foreground">
                    Not a partner yet?{' '}
                    <a href="mailto:support@qrrestaurant.com" className="text-orange-400 hover:text-orange-300 font-medium">
                      Contact us
                    </a>
                    {' '}to get onboarded.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
