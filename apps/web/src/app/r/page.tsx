'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { QrCode, Store, ArrowRight, Utensils, Smartphone, ChevronRight } from 'lucide-react';
import api from '@/lib/api';
import { ThemeToggle } from '@/components/ThemeToggle';
import { motion } from 'framer-motion';

type Restaurant = {
  slug: string;
  name: string;
  cuisineType?: string | null;
};

export default function SelectRestaurantPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
        <ThemeToggle size="sm" />
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-12 flex flex-col items-center">
        {/* Main QR Notice Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full bg-card border border-border rounded-3xl p-8 shadow-xl text-center mb-10 relative overflow-hidden"
        >
          <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary mx-auto flex items-center justify-center mb-4 shadow-sm">
            <QrCode className="w-8 h-8" />
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-bold mb-3 text-foreground">
            No Restaurant QR Code Scanned
          </h1>

          <p className="text-muted-foreground text-sm sm:text-base max-w-xl mx-auto leading-relaxed mb-6">
            Digital menus and table ordering require scanning the QR placard placed on your dining table. If you are currently at a restaurant, please scan their table QR code using your phone's camera.
          </p>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-muted border border-border text-xs font-semibold text-muted-foreground">
            <Smartphone className="w-4 h-4 text-primary animate-pulse" />
            <span>Point camera at table QR code to start ordering</span>
          </div>
        </motion.div>

        {/* Demo / Available Restaurants Section */}
        <div className="w-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-lg text-foreground flex items-center gap-2">
              <Store className="w-5 h-5 text-primary" /> Available Demo Restaurants
            </h2>
            <span className="text-xs text-muted-foreground">Explore sample menus</span>
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
