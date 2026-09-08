'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { QrCode, Store, ArrowRight, Utensils, Smartphone, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';
import { motion } from 'framer-motion';

import { useAuthStore } from '@/store/auth.store';
import { LogIn, LogOut, User as UserIcon } from 'lucide-react';
import { toast } from 'sonner';

type Restaurant = {
  slug: string;
  name: string;
  cuisineType?: string | null;
};

export default function SelectRestaurantPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const { user, isAuthenticated, logout } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    api
      .get('/menu/restaurants')
      .then((res) => {
        const list = res.data?.data?.restaurants ?? [];
        setRestaurants(list);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top Header */}
      <header className="px-6 py-4 border-b border-border flex items-center justify-between bg-card/50 backdrop-blur-md">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-bold shadow-md">
            <QrCode className="w-4 h-4" />
          </div>
          <span className="font-display font-bold text-lg">Restaurant Hub</span>
        </Link>
        <div className="flex items-center gap-3">
          <ThemeToggle size="sm" />
          {mounted && (
            isAuthenticated && user ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground font-medium hidden sm:inline-block">
                  Hi, {user.name.split(' ')[0]}
                </span>
                {user.role === 'SUPER_ADMIN' && (
                  <Link href="/admin/dashboard" className="text-xs bg-muted hover:bg-accent border border-border px-3 py-1.5 rounded-lg text-foreground font-medium">
                    Admin
                  </Link>
                )}
                {user.role === 'RESTAURANT_OWNER' && (
                  <Link href="/owner/dashboard" className="text-xs bg-muted hover:bg-accent border border-border px-3 py-1.5 rounded-lg text-foreground font-medium">
                    Owner Dashboard
                  </Link>
                )}
                <button
                  onClick={() => {
                    logout();
                    toast.success('Logged out successfully');
                  }}
                  className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1"
                >
                  <LogOut className="w-3.5 h-3.5" /> Logout
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="text-xs bg-primary hover:bg-primary/90 text-primary-foreground px-3.5 py-1.5 rounded-lg font-semibold transition-all shadow-sm flex items-center gap-1.5"
              >
                <LogIn className="w-3.5 h-3.5" /> Sign In
              </Link>
            )
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 flex flex-col items-center">
        {/* Demo / Available Restaurants Section */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="font-display font-bold text-2xl text-foreground flex items-center gap-2">
                <Store className="w-6 h-6 text-primary" /> Explore Restaurants
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">Select a restaurant to view digital menu and place orders</p>
            </div>
            <span className="text-xs text-muted-foreground font-semibold px-3 py-1 bg-muted rounded-full">
              {restaurants.length} Restaurants Available
            </span>
          </div>

          {loading ? (
            <div className="grid sm:grid-cols-2 gap-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-24 skeleton rounded-2xl" />
              ))}
            </div>
          ) : restaurants.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-border rounded-2xl text-muted-foreground text-sm">
              No active demo restaurants found.
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {restaurants.map((rest) => (
                <Link
                  key={rest.slug}
                  href={`/r/${rest.slug}`}
                  className="group bg-card hover:bg-muted/40 border border-border hover:border-primary/50 rounded-2xl p-5 shadow-sm transition-all duration-200 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold group-hover:scale-105 transition-transform">
                      <Utensils className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                        {rest.name}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {rest.cuisineType || 'Digital Menu'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
