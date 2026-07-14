'use client';

import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, UtensilsCrossed, ShoppingBag, Tag, BarChart3, Settings,
  LogOut, Menu, X, TrendingUp, Users, DollarSign, Clock, Bell, ChevronRight,
  Power, Star, Palette, BellRing
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
import { io, Socket } from 'socket.io-client';

// Play attention beep using Web Audio API
function playAlertBeep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.6);
  } catch { /* silent fail */ }
}

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

  // Waiter call notifications
  type WaiterCall = { tableNumber: string; calledAt: string; id: string; type?: 'default' | 'payment'; amount?: number };
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [showWaiterPanel, setShowWaiterPanel] = useState(false);
  const [activeWaiterAlert, setActiveWaiterAlert] = useState<WaiterCall | null>(null);

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

  // Real-time waiter call via Socket.IO
  useEffect(() => {
    if (!data?.restaurant?.id) return;

    const socket: Socket = io(
      process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:4000',
      { transports: ['websocket'], withCredentials: true }
    );

    socket.emit('join:restaurant', data.restaurant.id);

    socket.on('waiter:called', (payload: { tableNumber: string; calledAt: string; type?: 'default' | 'payment'; amount?: number }) => {
      const newCall: WaiterCall = {
        ...payload,
        id: `${payload.tableNumber}-${Date.now()}`,
      };
      setWaiterCalls((prev) => [newCall, ...prev]);
      setShowWaiterPanel(true);
      setActiveWaiterAlert(newCall); // Show big modal
      playAlertBeep();
    });

    return () => {
      socket.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.restaurant?.id]);

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
      {/* ── Big Waiter Call Modal ───────────────────────────────── */}
      <AnimatePresence>
        {activeWaiterAlert && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.7, y: 40 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.7, y: 40 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="relative mx-4 w-full max-w-sm bg-card border-2 border-orange-400 rounded-3xl shadow-2xl overflow-hidden"
            >
              {/* Pulsing top banner */}
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 px-6 py-4 flex items-center gap-3">
                <motion.div
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ repeat: Infinity, duration: 0.8 }}
                >
                  {activeWaiterAlert.type === 'payment' ? (
                    <DollarSign className="w-8 h-8 text-white" />
                  ) : (
                    <BellRing className="w-8 h-8 text-white" />
                  )}
                </motion.div>
                <div>
                  <p className="text-white font-bold text-lg leading-tight">
                    {activeWaiterAlert.type === 'payment' ? 'Payment Requested!' : 'Waiter Called!'}
                  </p>
                  <p className="text-orange-100 text-xs">
                    {activeWaiterAlert.type === 'payment' ? 'Table requests payment collection' : 'A table needs your attention'}
                  </p>
                </div>
              </div>

              <div className="p-8 text-center">
                <p className="text-muted-foreground text-sm mb-2">Table Number</p>
                <motion.p
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                  className="text-7xl font-black text-foreground mb-2"
                >
                  {activeWaiterAlert.tableNumber}
                </motion.p>
                {activeWaiterAlert.type === 'payment' && activeWaiterAlert.amount && (
                  <p className="text-xl font-bold text-orange-500 mb-2">
                    Amount: ₹{activeWaiterAlert.amount}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Called at {new Date(activeWaiterAlert.calledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </p>
              </div>

              <div className="px-6 pb-6 flex gap-3">
                <button
                  onClick={() => {
                    setWaiterCalls((prev) => prev.filter((c) => c.id !== activeWaiterAlert.id));
                    setActiveWaiterAlert(null);
                  }}
                  className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => setActiveWaiterAlert(null)}
                  className="flex-1 py-3 rounded-xl text-white text-sm font-semibold bg-gradient-to-r from-orange-500 to-amber-500 hover:opacity-90 transition-opacity"
                >
                  ✓ Sending Waiter
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm"
            >
              <LogOut className="w-4 h-4" />
              Logout
            </button>
            <ThemeToggle size="sm" />
          </div>
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
            {/* Waiter Calls Bell */}
            <div className="relative">
              <button
                onClick={() => setShowWaiterPanel((v) => !v)}
                className="relative p-2 rounded-xl hover:bg-muted transition-colors"
                title="Waiter call notifications"
              >
                {waiterCalls.length > 0 ? (
                  <BellRing className="w-5 h-5 text-orange-500 animate-[ring_1s_ease-in-out_3]" />
                ) : (
                  <Bell className="w-5 h-5" />
                )}
                {waiterCalls.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-orange-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center animate-bounce">
                    {waiterCalls.length}
                  </span>
                )}
              </button>

              {/* Waiter Call Panel */}
              <AnimatePresence>
                {showWaiterPanel && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowWaiterPanel(false)} />
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      className="absolute right-0 mt-2 z-50 w-80 bg-card border border-border shadow-2xl rounded-2xl overflow-hidden"
                    >
                      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-orange-50 dark:bg-orange-900/20">
                        <div className="flex items-center gap-2">
                          <BellRing className="w-4 h-4 text-orange-500" />
                          <span className="font-semibold text-sm text-orange-700 dark:text-orange-400">
                            Waiter Calls {waiterCalls.length > 0 && `(${waiterCalls.length})`}
                          </span>
                        </div>
                        {waiterCalls.length > 0 && (
                          <button
                            onClick={() => setWaiterCalls([])}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Clear all
                          </button>
                        )}
                      </div>

                      <div className="max-h-72 overflow-y-auto">
                        {waiterCalls.length === 0 ? (
                          <div className="py-8 text-center text-muted-foreground text-sm">
                            <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                            No waiter calls right now
                          </div>
                        ) : (
                          <div className="p-2 space-y-1.5">
                            {waiterCalls.map((call) => (
                              <motion.div
                                key={call.id}
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                className="flex items-center justify-between bg-orange-50 dark:bg-orange-900/20 border border-orange-200/50 dark:border-orange-500/20 rounded-xl px-3 py-2.5"
                              >
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center flex-shrink-0">
                                    {call.type === 'payment' ? (
                                      <DollarSign className="w-4 h-4 text-orange-500" />
                                    ) : (
                                      <BellRing className="w-4 h-4 text-orange-500" />
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
                                      Table {call.tableNumber}
                                      {call.type === 'payment' && (
                                        <span className="text-[9px] bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded-full font-semibold">
                                          Pay
                                        </span>
                                      )}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground">
                                      {call.type === 'payment' ? (
                                        <span className="font-semibold text-orange-500/90 dark:text-orange-400/90">
                                          Payment requested {call.amount ? `(₹${call.amount})` : ''}
                                        </span>
                                      ) : (
                                        <span>Called for assistance</span>
                                      )}
                                      {' • '}
                                      {new Date(call.calledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  </div>
                                </div>
                                <button
                                  onClick={() => setWaiterCalls((prev) => prev.filter((c) => c.id !== call.id))}
                                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </motion.div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

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
