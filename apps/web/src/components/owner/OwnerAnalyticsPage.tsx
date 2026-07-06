'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  BarChart3, LayoutDashboard, UtensilsCrossed, ShoppingBag, Tag, Settings, LogOut,
  Menu, TrendingUp, DollarSign, Users, Calendar, Star, Palette
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from 'recharts';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { label: 'Coupons', icon: Tag, href: '/owner/coupons' },
  { label: 'Analytics', icon: BarChart3, href: '/owner/analytics' },
  { label: 'Customize', icon: Palette, href: '/owner/customize' },
  { label: 'Settings', icon: Settings, href: '/owner/settings' },
];

export function OwnerAnalyticsPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');

  const { data, isLoading } = useQuery({
    queryKey: ['owner-analytics', period],
    queryFn: async () => {
      const res = await api.get(`/owner/analytics?period=${period}`);
      return res.data.data as {
        revenueData: Array<{ date: string; revenue: number; orders: number }>;
        topItems: Array<{ name: string; quantity: number; revenue: number }>;
        reviewStats: { avgRating: number; totalReviews: number };
      };
    },
  });

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally { logout(); router.push('/login'); }
  };

  const { data: restaurantData } = useQuery({
    queryKey: ['owner-restaurant-layout'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as { themeColor: string | null };
    },
  });
  const themeColor = restaurantData?.themeColor ?? '#E85D04';

  const totalRevenue = data?.revenueData.reduce((sum, d) => sum + d.revenue, 0) ?? 0;
  const totalOrders = data?.revenueData.reduce((sum, d) => sum + d.orders, 0) ?? 0;

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed lg:relative left-0 top-0 h-full z-30 w-64 bg-card border-r border-border flex flex-col transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <UtensilsCrossed className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-display font-bold text-sm">Restaurant</p>
              <p className="text-xs text-muted-foreground">Owner Panel</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <Icon className="w-4 h-4" />{item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">{user?.name?.[0] ?? 'O'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-xl hover:bg-muted">
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display font-bold text-xl">Analytics</h1>
          </div>
          <div className="flex gap-2">
            {(['7d', '30d'] as const).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                {p === '7d' ? '7 Days' : '30 Days'}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Total Revenue', value: `₹${totalRevenue.toFixed(0)}`, icon: DollarSign, color: 'text-green-600', bg: 'from-green-500/20 to-emerald-500/20', border: 'border-green-500/20' },
              { label: 'Total Orders', value: totalOrders, icon: ShoppingBag, color: 'text-blue-600', bg: 'from-blue-500/20 to-cyan-500/20', border: 'border-blue-500/20' },
              { label: 'Avg Rating', value: `${(data?.reviewStats.avgRating ?? 0).toFixed(1)} ★`, icon: Star, color: 'text-yellow-600', bg: 'from-yellow-500/20 to-amber-500/20', border: 'border-yellow-500/20' },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <motion.div key={stat.label} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}
                  className={`bg-gradient-to-br ${stat.bg} border ${stat.border} rounded-2xl p-4`}>
                  <Icon className={`w-5 h-5 ${stat.color} mb-2`} />
                  <p className="font-display text-2xl font-bold">{isLoading ? '—' : stat.value}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{stat.label}</p>
                </motion.div>
              );
            })}
          </div>

          {/* Revenue Chart */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-display font-semibold mb-4">Revenue Over Time</h2>
            {data?.revenueData && data.revenueData.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={data.revenueData}>
                  <defs>
                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={themeColor} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={themeColor} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${v}`} />
                  <Tooltip formatter={(v: number) => [`₹${v}`, 'Revenue']} />
                  <Area type="monotone" dataKey="revenue" stroke={themeColor} strokeWidth={2} fill="url(#revGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">No data for this period</div>
            )}
          </div>

          {/* Top Items */}
          <div className="bg-card border border-border rounded-2xl p-5">
            <h2 className="font-display font-semibold mb-4">Top Selling Items</h2>
            {data?.topItems && data.topItems.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.topItems} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis dataKey="name" type="category" tick={{ fontSize: 10 }} width={100} tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => [v, 'Quantity']} />
                  <Bar dataKey="quantity" fill={themeColor} radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[180px] flex items-center justify-center text-muted-foreground text-sm">No data for this period</div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
