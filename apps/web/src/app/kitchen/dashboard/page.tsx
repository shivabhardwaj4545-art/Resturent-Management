'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import { io, Socket } from 'socket.io-client';
import {
  ChefHat,
  Clock,
  CheckCircle2,
  AlertCircle,
  Flame,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  RefreshCw,
  LogOut,
  Utensils,
  ShoppingBag,
  User,
  Phone,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { playKitchenOrderSound } from '@/utils/audio';

// Play sound alert for kitchen when new order arrives
function playKitchenAlertChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    
    oscillator.type = 'triangle';
    // Chime sequence: High C -> High E -> High G
    oscillator.frequency.setValueAtTime(523.25, ctx.currentTime);
    oscillator.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15);
    oscillator.frequency.setValueAtTime(783.99, ctx.currentTime + 0.3);
    
    gain.gain.setValueAtTime(0.5, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.6);
  } catch {
    /* Silent fallback */
  }
}

interface KitchenOrderItem {
  id: string;
  quantity: number;
  price: number;
  notes?: string | null;
  customizations?: any;
  menuItem: {
    id: string;
    name: string;
    image?: string | null;
  };
}

interface KitchenOrder {
  id: string;
  orderNumber?: number | string;
  status: 'CONFIRMED' | 'PREPARING' | 'BAKING' | 'READY' | 'DELIVERED' | 'CANCELLED';
  orderType?: string;
  total: number;
  notes?: string | null;
  createdAt: string;
  table?: { id: string; tableNumber: number } | null;
  user?: { name: string; phone?: string | null } | null;
  items: KitchenOrderItem[];
}

export default function KitchenDashboardPage() {
  const { user, isAuthenticated, logout } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'DELIVERED'>('ALL');
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted) {
      if (!isAuthenticated || !user) {
        router.push('/login');
      } else if (user.role !== 'KITCHEN' && user.role !== 'RESTAURANT_OWNER' && user.role !== 'SUPER_ADMIN') {
        router.push('/');
      }
    }
  }, [mounted, user, isAuthenticated, router]);

  // Fetch kitchen orders
  const { data: ordersData, isLoading, refetch } = useQuery({
    queryKey: ['kitchen-orders'],
    queryFn: async () => {
      const res = await api.get('/kitchen/orders');
      return res.data.data as { orders: KitchenOrder[]; restaurantId: string };
    },
    enabled: !!user && (user.role === 'KITCHEN' || user.role === 'RESTAURANT_OWNER' || user.role === 'SUPER_ADMIN'),
    refetchInterval: 10000, // Fallback polling every 10s
  });

  const orders = ordersData?.orders ?? [];
  const restaurantId = ordersData?.restaurantId;

  // Socket.io Real-Time Connection
  useEffect(() => {
    if (!restaurantId) return;

    const wsUrl = process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') || 'http://localhost:4000';
    const socket = io(wsUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join:restaurant', restaurantId);
    });

    const handleNewOrder = () => {
      if (soundEnabled) playKitchenOrderSound();
      toast.info('🔔 New Order Confirmed for Kitchen!', { duration: 4000 });
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
    };

    const handleOrderUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
    };

    socket.on('order:new', handleNewOrder);
    socket.on('kitchen:new_order', handleNewOrder);
    socket.on('order:status_updated', handleOrderUpdated);
    socket.on('kitchen:order_updated', handleOrderUpdated);

    return () => {
      socket.disconnect();
    };
  }, [restaurantId, soundEnabled, queryClient]);

  // Status update handler
  const handleUpdateStatus = async (orderId: string, nextStatus: string) => {
    try {
      await api.patch(`/kitchen/orders/${orderId}/status`, { status: nextStatus });
      toast.success(`Order status updated to ${nextStatus}`);
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to update order status');
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  const getElapsedTime = (createdAt: string) => {
    const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000 / 60);
    if (diff < 1) return 'Just now';
    return `${diff} min${diff > 1 ? 's' : ''}`;
  };

  const getTimerBadgeStyle = (createdAt: string) => {
    const diff = Math.floor((Date.now() - new Date(createdAt).getTime()) / 1000 / 60);
    if (diff >= 20) return 'bg-red-500/20 text-red-400 border-red-500/40 animate-pulse';
    if (diff >= 10) return 'bg-amber-500/20 text-amber-400 border-amber-500/40';
    return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
  };

  if (!mounted || isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <RefreshCw className="w-12 h-12 animate-spin text-orange-500 mx-auto" />
          <p className="text-lg font-semibold text-slate-300">Loading Kitchen Display System (KDS)...</p>
        </div>
      </div>
    );
  }

  const activeOrders = orders.filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED');
  const confirmedOrders = orders.filter((o) => o.status === 'CONFIRMED');
  const preparingOrders = orders.filter((o) => o.status === 'PREPARING' || o.status === 'BAKING');
  const readyOrders = orders.filter((o) => o.status === 'READY');
  const completedTodayOrders = orders.filter((o) => o.status === 'DELIVERED');

  const filteredOrders = activeFilter === 'ALL'
    ? activeOrders
    : orders.filter((o) => {
        if (activeFilter === 'CONFIRMED') return o.status === 'CONFIRMED';
        if (activeFilter === 'PREPARING') return o.status === 'PREPARING' || o.status === 'BAKING';
        if (activeFilter === 'READY') return o.status === 'READY';
        if (activeFilter === 'DELIVERED') return o.status === 'DELIVERED';
        return true;
      });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col selection:bg-orange-500/30">
      {/* Top KDS Navigation Bar */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center justify-between shadow-xl sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-orange-500 to-amber-600 rounded-2xl shadow-lg shadow-orange-500/20">
            <ChefHat className="w-7 h-7 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
              KITCHEN DISPLAY SYSTEM
              <span className="text-xs bg-orange-500/20 text-orange-400 border border-orange-500/30 px-2.5 py-0.5 rounded-full font-bold uppercase">
                LIVE
              </span>
            </h1>
            <p className="text-xs text-slate-400 font-medium">
              Real-time Order Queue & Preparation Control
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-3">
          {/* Quick Filters */}
          <div className="hidden lg:flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-bold">
            <button
              onClick={() => setActiveFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFilter === 'ALL' ? 'bg-orange-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active Queue ({activeOrders.length})
            </button>
            <button
              onClick={() => setActiveFilter('CONFIRMED')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFilter === 'CONFIRMED' ? 'bg-amber-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              New ({confirmedOrders.length})
            </button>
            <button
              onClick={() => setActiveFilter('PREPARING')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFilter === 'PREPARING' ? 'bg-blue-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Preparing ({preparingOrders.length})
            </button>
            <button
              onClick={() => setActiveFilter('READY')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFilter === 'READY' ? 'bg-emerald-500 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Ready ({readyOrders.length})
            </button>
            <button
              onClick={() => setActiveFilter('DELIVERED')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                activeFilter === 'DELIVERED' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Served Today ({completedTodayOrders.length})
            </button>
          </div>

          <button
            onClick={() => refetch()}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-all border border-slate-700 active:scale-95"
            title="Refresh Orders"
          >
            <RefreshCw className="w-5 h-5" />
          </button>

          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`p-2.5 rounded-xl transition-all border active:scale-95 flex items-center gap-1.5 text-xs font-bold ${
              soundEnabled
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                : 'bg-slate-800 text-slate-400 border-slate-700'
            }`}
            title="Toggle Sound Alerts"
          >
            {soundEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            <span className="hidden sm:inline">{soundEnabled ? 'Audio ON' : 'Audio OFF'}</span>
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl transition-all border border-slate-700 active:scale-95"
            title="Fullscreen Monitor View"
          >
            {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
          </button>

          <button
            onClick={() => {
              logout();
              router.push('/login');
            }}
            className="p-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all border border-red-500/30 font-bold text-xs flex items-center gap-1.5"
            title="Log Out"
          >
            <LogOut className="w-5 h-5" />
            <span className="hidden sm:inline">Exit</span>
          </button>
        </div>
      </header>

      {/* Main Kanban Grid */}
      <main className="flex-1 p-6 overflow-x-auto">
        {filteredOrders.length === 0 ? (
          <div className="h-full min-h-[60vh] flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-slate-800 rounded-3xl bg-slate-900/40">
            <div className="p-6 bg-slate-900 rounded-full border border-slate-800 text-slate-600 mb-4">
              <ChefHat className="w-16 h-16" />
            </div>
            <h3 className="text-2xl font-black text-slate-300">Kitchen Queue Clean! 🎉</h3>
            <p className="text-sm text-slate-500 max-w-md mt-2">
              There are currently no active confirmed orders waiting in the kitchen. New orders will pop up automatically with sound alerts.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <AnimatePresence>
              {filteredOrders.map((order) => {
                const orderIdShort = order.id.slice(-6).toUpperCase();
                return (
                  <motion.div
                    key={order.id}
                    layout
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    className={`rounded-3xl border shadow-2xl overflow-hidden flex flex-col bg-slate-900 transition-all ${
                      order.status === 'CONFIRMED'
                        ? 'border-amber-500/50 shadow-amber-500/10'
                        : order.status === 'PREPARING' || order.status === 'BAKING'
                        ? 'border-blue-500/50 shadow-blue-500/10'
                        : 'border-emerald-500/50 shadow-emerald-500/10'
                    }`}
                  >
                    {/* Ticket Header */}
                    <div
                      className={`p-4 flex items-center justify-between border-b ${
                        order.status === 'CONFIRMED'
                          ? 'bg-amber-500/10 border-amber-500/20'
                          : order.status === 'PREPARING' || order.status === 'BAKING'
                          ? 'bg-blue-500/10 border-blue-500/20'
                          : 'bg-emerald-500/10 border-emerald-500/20'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-black tracking-wider text-white">
                            #{orderIdShort}
                          </span>
                          <span
                            className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md border ${getTimerBadgeStyle(
                              order.createdAt
                            )}`}
                          >
                            <Clock className="w-3 h-3 inline mr-1" />
                            {getElapsedTime(order.createdAt)}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1">
                          {order.table?.tableNumber ? (
                            <span className="bg-orange-500 text-white font-extrabold text-xs px-2.5 py-0.5 rounded-lg">
                              🍽️ Table {order.table.tableNumber}
                            </span>
                          ) : (
                            <span className="bg-blue-600 text-white font-extrabold text-xs px-2.5 py-0.5 rounded-lg">
                              🍽️ Dine-In Order
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status Badge */}
                      <span
                        className={`text-xs font-black uppercase px-3 py-1 rounded-xl border ${
                          order.status === 'CONFIRMED'
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                            : order.status === 'PREPARING' || order.status === 'BAKING'
                            ? 'bg-blue-500/20 text-blue-400 border-blue-500/40'
                            : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                        }`}
                      >
                        {order.status}
                      </span>
                    </div>

                    {/* Customer Info (if available) */}
                    {order.user?.name && (
                      <div className="px-4 py-2 bg-slate-950/60 border-b border-slate-800 text-xs text-slate-400 flex items-center justify-between">
                        <span className="flex items-center gap-1 font-semibold text-slate-300">
                          <User className="w-3.5 h-3.5 text-slate-500" />
                          {order.user.name}
                        </span>
                        {order.user.phone && (
                          <span className="flex items-center gap-1 font-mono">
                            <Phone className="w-3 h-3 text-slate-500" />
                            {order.user.phone}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Items List */}
                    <div className="p-4 flex-1 space-y-3 overflow-y-auto max-h-[350px]">
                      {order.items.map((item, idx) => (
                        <div
                          key={item.id || idx}
                          className="bg-slate-950/80 p-3 rounded-2xl border border-slate-800/80 flex items-start gap-3"
                        >
                          <span className="w-8 h-8 rounded-xl bg-orange-500/20 text-orange-400 border border-orange-500/30 flex items-center justify-center font-black text-sm flex-shrink-0">
                            {item.quantity}x
                          </span>
                          <div className="flex-1">
                            <h4 className="font-extrabold text-sm text-slate-100 leading-snug">
                              {item.menuItem?.name || 'Menu Item'}
                            </h4>
                            
                            {/* Item Notes / Customizations */}
                            {item.notes && (
                              <p className="text-xs font-bold text-amber-300 bg-amber-500/10 border border-amber-500/20 p-2 rounded-xl mt-1.5">
                                ⚠️ Note: {item.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Action Button Footer */}
                    <div className="p-4 bg-slate-950 border-t border-slate-800 mt-auto">
                      {order.status === 'CONFIRMED' && (
                        <button
                          onClick={() => handleUpdateStatus(order.id, 'PREPARING')}
                          className="w-full py-3 px-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm rounded-2xl shadow-lg shadow-blue-600/20 transition-all flex items-center justify-center gap-2 active:scale-98"
                        >
                          <Flame className="w-4 h-4" /> Start Preparing
                        </button>
                      )}

                      {(order.status === 'PREPARING' || order.status === 'BAKING') && (
                        <button
                          onClick={() => handleUpdateStatus(order.id, 'READY')}
                          className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-sm rounded-2xl shadow-lg shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 active:scale-98"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Mark Order Ready
                        </button>
                      )}

                      {order.status === 'READY' && (
                        <button
                          onClick={() => handleUpdateStatus(order.id, 'DELIVERED')}
                          className="w-full py-3 px-4 bg-gradient-to-r from-slate-800 to-slate-700 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 font-black text-sm rounded-2xl transition-all flex items-center justify-center gap-2 active:scale-98"
                        >
                          <Utensils className="w-4 h-4" /> Complete / Served
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}

function Loader2Icon(props: any) {
  return <RefreshCw {...props} />;
}
