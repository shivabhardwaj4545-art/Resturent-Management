'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, UtensilsCrossed, ShoppingBag, Tag, BarChart3, Settings,
  LogOut, Menu, X, TrendingUp, Users, DollarSign, Clock, Bell, ChevronRight,
  Power, Star, Palette, BellRing, ChefHat
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { WaiterBell } from '@/components/owner/WaiterBell';
import { MessageSquare } from 'lucide-react';
import { AdminOwnerChatModal } from '@/components/admin/AdminOwnerChatModal';
import { OwnerSidebar } from '@/components/owner/OwnerSidebar';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { label: 'Kitchen Staff', icon: ChefHat, href: '/owner/kitchen-staff' },
  { label: 'Coupons', icon: Tag, href: '/owner/coupons' },
  { label: 'Reviews', icon: Star, href: '/owner/reviews' },
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
  const [showChatModal, setShowChatModal] = useState(false);



  const { data, isLoading } = useQuery({
    queryKey: ['owner-dashboard'],
    queryFn: async () => {
      const response = await api.get('/owner/dashboard');
      return response.data.data as {
        restaurant: { id: string; name: string; isOpen: boolean; themeColor: string | null };
        stats: {
          todayRevenue: number;
          todayOrders: number;
          monthlyRevenue: number;
          monthlyOrders: number;
          todayHourlyAverage: number;
          pendingOrders: number;
          avgOrderValue: number;
          avgRating: number;
          totalReviews: number;
        };
        recentOrders: Array<{
          id: string; status: string; total: number; createdAt: string;
          guestName: string | null; user: { name: string } | null;
          items: Array<{ menuItem: { name: string } }>;
          paymentMethod: string;
        }>;
        last7DaysRevenue: Array<{ date: string; revenue: number; orders: number }>;
        todayHourlyEarnings: Array<{ hour: string; rawHour: number; revenue: number; orders: number }>;
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
      <OwnerSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

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
            {/* Waiter Calls Bell */}
            <WaiterBell />

            {/* Admin Support Chat Button */}
            <button
              onClick={() => setShowChatModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50 text-indigo-600 dark:text-indigo-400 text-xs font-bold hover:bg-indigo-100 transition-all shadow-sm"
              title="Chat 1-to-1 with Super Admin"
            >
              <MessageSquare className="w-4 h-4 text-indigo-500" />
              <span className="hidden sm:inline">Admin Support Chat</span>
            </button>

            {/* Pending orders indicator */}
            {(data?.stats?.pendingOrders ?? 0) > 0 && (
              <span className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400 text-xs font-semibold">
                <Clock className="w-3.5 h-3.5" />
                {data?.stats.pendingOrders} pending
              </span>
            )}
          </div>
        </header>

        {/* Dashboard content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {isLoading ? (
            <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-28 skeleton rounded-2xl" />
              ))}
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
                {[
                  {
                    label: "Today's Earnings",
                    value: `₹${(data?.stats?.todayRevenue ?? 0).toLocaleString('en-IN')}`,
                    subtitle: `${data?.stats?.todayOrders ?? 0} orders today`,
                    icon: DollarSign,
                    color: 'from-green-500/20 to-emerald-500/20',
                    border: 'border-green-500/20',
                    text: 'text-green-600 dark:text-green-400',
                  },
                  {
                    label: "Monthly Earnings",
                    value: `₹${(data?.stats?.monthlyRevenue ?? 0).toLocaleString('en-IN')}`,
                    subtitle: `${data?.stats?.monthlyOrders ?? 0} orders this month`,
                    icon: TrendingUp,
                    color: 'from-blue-500/20 to-cyan-500/20',
                    border: 'border-blue-500/20',
                    text: 'text-blue-600 dark:text-blue-400',
                  },
                  {
                    label: "Today Hourly Avg",
                    value: `₹${(data?.stats?.todayHourlyAverage ?? 0).toFixed(0)}/hr`,
                    subtitle: 'Avg earning per hour',
                    icon: Clock,
                    color: 'from-purple-500/20 to-indigo-500/20',
                    border: 'border-purple-500/20',
                    text: 'text-purple-600 dark:text-purple-400',
                  },
                  {
                    label: 'Pending Orders',
                    value: data?.stats?.pendingOrders ?? 0,
                    subtitle: 'Needs confirmation',
                    icon: Clock,
                    color: 'from-orange-500/20 to-amber-500/20',
                    border: 'border-orange-500/20',
                    text: 'text-orange-600 dark:text-orange-400',
                  },
                  {
                    label: 'Avg. Order',
                    value: `₹${(data?.stats?.avgOrderValue ?? 0).toFixed(0)}`,
                    subtitle: 'Per completed order',
                    icon: ShoppingBag,
                    color: 'from-pink-500/20 to-rose-500/20',
                    border: 'border-pink-500/20',
                    text: 'text-pink-600 dark:text-pink-400',
                  },
                  {
                    label: 'Avg. Rating',
                    value: data?.stats?.avgRating ? `${(data.stats.avgRating as number).toFixed(1)} ★` : '0.0 ★',
                    subtitle: `${data?.stats?.totalReviews ?? 0} reviews`,
                    icon: Star,
                    color: 'from-amber-500/20 to-yellow-500/20',
                    border: 'border-amber-500/20',
                    text: 'text-amber-600 dark:text-amber-400',
                  },
                ].map((stat, i) => {
                  const Icon = stat.icon;
                  return (
                    <motion.div
                      key={stat.label}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.08 }}
                      className={`bg-gradient-to-br ${stat.color} border ${stat.border} rounded-2xl p-4 flex flex-col justify-between`}
                    >
                      <div className={`w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center mb-2 ${stat.text}`}>
                        <Icon className="w-4.5 h-4.5" />
                      </div>
                      <div>
                        <p className="font-display text-xl font-bold tracking-tight">{stat.value}</p>
                        <p className="font-semibold text-xs text-foreground/80 mt-0.5">{stat.label}</p>
                        <p className="text-[11px] text-muted-foreground">{stat.subtitle}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              {/* Charts Grid: Today's Hourly Earnings + 7 Days Revenue */}
              {(() => {
                const themeColor = data?.restaurant.themeColor ?? '#E85D04';
                return (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    {/* Today's Hourly Earnings Chart */}
                    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="font-display font-bold text-base text-foreground flex items-center gap-2">
                            <Clock className="w-4 h-4 text-primary" /> Today's Hourly Earnings
                          </h2>
                          <p className="text-xs text-muted-foreground">Earnings broken down by hour (12 AM - 11 PM)</p>
                        </div>
                        <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
                          Today: ₹{(data?.stats.todayRevenue ?? 0).toLocaleString('en-IN')}
                        </span>
                      </div>
                      <ResponsiveContainer width="100%" height={210}>
                        <AreaChart data={data?.todayHourlyEarnings ?? []}>
                          <defs>
                            <linearGradient id="hourlyGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor={themeColor} stopOpacity={0.4} />
                              <stop offset="95%" stopColor={themeColor} stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="hour" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval={2} />
                          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${v}`} />
                          <Tooltip formatter={(value: number) => [`₹${value}`, 'Earnings']} labelFormatter={(l: string) => `Time: ${l}`} />
                          <Area type="monotone" dataKey="revenue" stroke={themeColor} strokeWidth={2.5} fill="url(#hourlyGrad)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>

                    {/* 7 Days Revenue Chart */}
                    <div className="bg-card border border-border rounded-2xl p-5 shadow-sm">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h2 className="font-display font-bold text-base text-foreground flex items-center gap-2">
                            <TrendingUp className="w-4 h-4 text-emerald-500" /> Revenue (Last 7 Days)
                          </h2>
                          <p className="text-xs text-muted-foreground">Daily revenue trend over the past week</p>
                        </div>
                      </div>
                      <ResponsiveContainer width="100%" height={210}>
                        <AreaChart data={data?.last7DaysRevenue ?? []}>
                          <defs>
                            <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                          <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${v}`} />
                          <Tooltip formatter={(value: number) => [`₹${value}`, 'Revenue']} />
                          <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2.5} fill="url(#revenueGradient)" />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
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
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold border ${
                            order.paymentMethod === 'RAZORPAY' ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-900/30' :
                            order.paymentMethod === 'WALLET' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900/30' :
                            order.paymentMethod === 'PAY_TO_WAITER' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900/30' :
                            'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900/30'
                          }`}>
                            {order.paymentMethod === 'RAZORPAY' ? 'Online' : order.paymentMethod === 'WALLET' ? 'Wallet' : order.paymentMethod === 'PAY_TO_WAITER' ? 'Pay to Waiter' : 'Pay on Counter'}
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

      {/* 1-to-1 Live Support Chat Modal */}
      <AdminOwnerChatModal isOpen={showChatModal} onClose={() => setShowChatModal(false)} />
    </div>
  );
}
