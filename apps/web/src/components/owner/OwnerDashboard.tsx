'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, UtensilsCrossed, ShoppingBag, Tag, BarChart3, Settings,
  LogOut, Menu, X, TrendingUp, Users, DollarSign, Clock, Bell, ChevronRight,
  Power, Star, Palette
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
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

export function OwnerDashboard() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: async () => {
      const response = await api.get('/owner/dashboard');
      return response.data.data as {
        restaurant: { id: string; name: string; isOpen: boolean; themeColor: string | null };
        stats: { todayRevenue: number; todayOrders: number; pendingOrders: number; avgOrderValue: number };
        recentOrders: Array<{
          id: string; status: string; total: number; createdAt: string;
          guestName: string | null; user: { name: string } | null;
          items: Array<{ menuItem: { name: string } }>;
        }>;
        last7DaysRevenue: Array<{ date: string; revenue: number; orders: number }>;
      };
    },
    refetchInterval: 30000, // Refresh every 30s
  });

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      logout();
      router.push('/login');
    }
  };

  const toggleRestaurant = async () => {
    if (!data) return;
    try {
      await api.patch('/owner/restaurant/toggle', { isOpen: !data.restaurant.isOpen });
      toast.success(`Restaurant is now ${!data.restaurant.isOpen ? 'OPEN' : 'CLOSED'}`);
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
    } catch {
      toast.error('Failed to update restaurant status');
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    CONFIRMED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    PREPARING: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    READY: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    DELIVERED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:relative left-0 top-0 h-full z-30 w-64 bg-card border-r border-border flex flex-col transition-transform lg:translate-x-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <UtensilsCrossed className="w-4.5 h-4.5 text-white" />
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
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="w-4.5 h-4.5" />
                {item.label}
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
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Bar */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl hover:bg-muted transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display font-bold text-xl">Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            {data && (
              <button
                onClick={toggleRestaurant}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                  data.restaurant.isOpen
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200'
                }`}
              >
                <Power className="w-4 h-4" />
                {data.restaurant.isOpen ? 'Open' : 'Closed'}
              </button>
            )}
            <button className="relative p-2 rounded-xl hover:bg-muted transition-colors">
              <Bell className="w-5 h-5" />
              {(data?.stats?.pendingOrders ?? 0) > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 bg-orange-500 rounded-full" />
              )}
            </button>
          </div>
        </header>

        {/* Dashboard content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {isLoading ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 skeleton rounded-2xl" />
              ))}
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  {
                    label: "Today's Revenue",
                    value: `₹${(data?.stats.todayRevenue ?? 0).toFixed(0)}`,
                    icon: DollarSign,
                    color: 'from-green-500/20 to-emerald-500/20',
                    border: 'border-green-500/20',
                    text: 'text-green-600 dark:text-green-400',
                  },
                  {
                    label: "Today's Orders",
                    value: data?.stats.todayOrders ?? 0,
                    icon: ShoppingBag,
                    color: 'from-blue-500/20 to-cyan-500/20',
                    border: 'border-blue-500/20',
                    text: 'text-blue-600 dark:text-blue-400',
                  },
                  {
                    label: 'Pending',
                    value: data?.stats.pendingOrders ?? 0,
                    icon: Clock,
                    color: 'from-orange-500/20 to-amber-500/20',
                    border: 'border-orange-500/20',
                    text: 'text-orange-600 dark:text-orange-400',
                  },
                  {
                    label: 'Avg. Order',
                    value: `₹${(data?.stats.avgOrderValue ?? 0).toFixed(0)}`,
                    icon: TrendingUp,
                    color: 'from-purple-500/20 to-pink-500/20',
                    border: 'border-purple-500/20',
                    text: 'text-purple-600 dark:text-purple-400',
                  },
                ].map((stat, i) => {
                  const Icon = stat.icon;
                  return (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className={`bg-gradient-to-br ${stat.color} border ${stat.border} rounded-2xl p-4`}
                    >
                      <div className={`w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center mb-3 ${stat.text}`}>
                        <Icon className="w-4.5 h-4.5" />
                      </div>
                      <p className="font-display text-2xl font-bold">{stat.value}</p>
                      <p className="text-muted-foreground text-xs mt-0.5">{stat.label}</p>
                    </motion.div>
                  );
                })}
              </div>

              {/* Revenue Chart */}
              {data?.last7DaysRevenue && data.last7DaysRevenue.length > 0 && (() => {
                const themeColor = data.restaurant.themeColor ?? '#E85D04';
                return (
                  <div className="bg-card border border-border rounded-2xl p-5">
                    <h2 className="font-display font-semibold mb-4">Revenue (Last 7 Days)</h2>
                    <ResponsiveContainer width="100%" height={200}>
                      <AreaChart data={data.last7DaysRevenue}>
                        <defs>
                          <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor={themeColor} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={themeColor} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${v}`} />
                        <Tooltip formatter={(value: number) => [`₹${value}`, 'Revenue']} />
                        <Area type="monotone" dataKey="revenue" stroke={themeColor} strokeWidth={2} fill="url(#revenueGradient)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}

              {/* Recent Orders */}
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display font-semibold">Recent Orders</h2>
                  <Link href="/owner/orders" className="text-sm text-primary flex items-center gap-1 hover:gap-2 transition-all">
                    View all <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
                <div className="space-y-3">
                  {data?.recentOrders.slice(0, 5).map((order) => (
                    <div key={order.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-muted/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">
                            #{order.id.slice(-8).toUpperCase()}
                          </span>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] ?? ''}`}>
                            {order.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {order.guestName ?? order.user?.name ?? 'Guest'} •{' '}
                          {order.items.slice(0, 2).map((i) => i.menuItem.name).join(', ')}
                          {order.items.length > 2 && ` +${order.items.length - 2}`}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-bold text-sm">₹{order.total.toFixed(0)}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
