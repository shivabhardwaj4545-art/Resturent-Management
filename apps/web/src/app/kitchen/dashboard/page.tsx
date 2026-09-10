'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getSocketUrl } from '@/lib/api';
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
  BellRing,
  Bell,
  X as XIcon,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { playKitchenOrderSound, playWaiterCallSound, processRealTimeEvent, requestDesktopNotificationPermission, sendDesktopNotification } from '@/utils/audio';

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
  const [activeWaiterCalls, setActiveWaiterCalls] = useState<{ id: string; tableNumber: string; time: string }[]>([]);
  const [activeNewOrderAlert, setActiveNewOrderAlert] = useState<any | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const soundEnabledRef = useRef(soundEnabled);
  useEffect(() => {
    soundEnabledRef.current = soundEnabled;
  }, [soundEnabled]);

  useEffect(() => {
    setMounted(true);
    requestDesktopNotificationPermission();

    const unlockAudio = () => {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      } catch {}
    };
    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
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
    refetchInterval: 30000, // 30s background fallback polling without page flicker
  });

  const orders = ordersData?.orders ?? [];
  const targetRestId = (user as any)?.restaurantId || ordersData?.restaurantId;

  // Socket.io Real-Time Connection
  useEffect(() => {
    if (!targetRestId) return;

    const socket = io(getSocketUrl(), {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    const joinRestaurant = () => {
      socket.emit('join:restaurant', targetRestId);
    };

    if (socket.connected) {
      joinRestaurant();
    }

    socket.on('connect', joinRestaurant);

    const handleNewOrder = (order?: any) => {
      if (order) {
        setActiveNewOrderAlert(order);
      }
      const orderIdShort = order?.id ? String(order.id).slice(-8).toUpperCase() : 'NEW';
      const itemsLabel = order?.items?.map((i: any) => `${i.menuItem?.name || i.name || 'Item'} × ${i.quantity}`).join(', ') || 'New items in kitchen';
      const locationLabel = order?.table?.tableNumber || order?.tableNumber ? `Table ${order?.table?.tableNumber || order?.tableNumber}` : 'Dine-In / Delivery';
      const totalLabel = order?.total ? `₹${Number(order.total).toFixed(2)}` : '';

      if (soundEnabledRef.current) {
        processRealTimeEvent(
          'new_order',
          () => {
            if (order) setActiveNewOrderAlert(order);
          },
          {
            title: `🔔 KITCHEN: NEW ORDER #${orderIdShort}`,
            body: `${locationLabel} ${totalLabel ? `• ${totalLabel}` : ''}\nItems: ${itemsLabel}`,
            tag: `kitchen-order-${order?.id || Date.now()}`,
          },
          'kitchen'
        );
      } else {
        sendDesktopNotification(`🔔 KITCHEN: NEW ORDER #${orderIdShort}`, {
          body: `${locationLabel} ${totalLabel ? `• ${totalLabel}` : ''}\nItems: ${itemsLabel}`,
          tag: `kitchen-order-${order?.id || Date.now()}`,
        });
      }

      toast.info('🔔 New Order Confirmed for Kitchen!', { duration: 5000 });
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
    };

    const handleOrderUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
    };

    const handleWaiterCalled = (payload: { tableNumber: string; calledAt?: string }) => {
      if (soundEnabledRef.current) {
        processRealTimeEvent(
          'waiter_called',
          undefined,
          {
            title: `🔔 KITCHEN: WAITER CALL`,
            body: `Table ${payload.tableNumber} requested waiter assistance!`,
            tag: `kitchen-waiter-${payload.tableNumber}-${Date.now()}`,
          },
          'kitchen'
        );
      } else {
        sendDesktopNotification(`🔔 KITCHEN: WAITER CALL`, {
          body: `Table ${payload.tableNumber} requested waiter assistance!`,
          tag: `kitchen-waiter-${payload.tableNumber}-${Date.now()}`,
        });
      }

      toast.warning(`🔔 Waiter Call from Table ${payload.tableNumber}!`, {
        description: 'Customer requested assistance at table.',
        duration: 10000,
      });
      setActiveWaiterCalls((prev) => [
        {
          id: `${payload.tableNumber}-${Date.now()}`,
          tableNumber: payload.tableNumber,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        },
        ...prev.filter((c) => c.tableNumber !== payload.tableNumber),
      ]);
    };

    socket.on('order:new', handleNewOrder);
    socket.on('new_order', handleNewOrder);
    socket.on('kitchen:new_order', handleNewOrder);
    socket.on('order:status_updated', handleOrderUpdated);
    socket.on('kitchen:order_updated', handleOrderUpdated);
    socket.on('order_status_changed', handleOrderUpdated);
    socket.on('order_cancelled', handleOrderUpdated);
    socket.on('driver_assigned', handleOrderUpdated);
    socket.on('waiter:called', handleWaiterCalled);
    socket.on('waiter_called', handleWaiterCalled);

    return () => {
      socket.disconnect();
    };
  }, [targetRestId, queryClient]);

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

      {/* Live Waiter Calls Alert Banner */}
      <AnimatePresence>
        {activeWaiterCalls.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-gradient-to-r from-orange-950/80 via-amber-950/70 to-orange-950/80 border-b border-orange-500/40 px-6 py-3 shadow-lg"
          >
            <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500 text-white rounded-xl animate-bounce shadow-md">
                  <BellRing className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-black text-orange-200 tracking-wide flex items-center gap-2">
                    LIVE WAITER CALLS ({activeWaiterCalls.length})
                  </h3>
                  <p className="text-xs text-orange-300/80">Table requested waiter assistance in dining area</p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {activeWaiterCalls.map((call) => (
                  <div
                    key={call.id}
                    className="bg-orange-900/60 border border-orange-500/40 rounded-xl px-3 py-1.5 text-xs text-orange-100 flex items-center gap-2 font-bold shadow-sm"
                  >
                    <span>Table {call.tableNumber}</span>
                    <span className="text-[10px] text-orange-300 font-normal">({call.time})</span>
                    <button
                      onClick={() =>
                        setActiveWaiterCalls((prev) => prev.filter((c) => c.id !== call.id))
                      }
                      className="p-1 hover:bg-orange-500/30 rounded-lg transition-colors text-orange-200"
                      title="Clear"
                    >
                      <XIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Global New Order Alert Modal for Kitchen */}
      <AnimatePresence>
        {activeNewOrderAlert && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-slate-900 border-2 border-orange-500 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-slate-100"
            >
              {/* Header Banner */}
              <div className="bg-gradient-to-r from-orange-500 via-amber-500 to-yellow-500 p-5 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
                    <ShoppingBag className="w-5 h-5 text-white animate-bounce" />
                  </div>
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full">
                      New Order Notification
                    </span>
                    <h3 className="font-display font-extrabold text-xl leading-tight">
                      Order #{activeNewOrderAlert.id ? String(activeNewOrderAlert.id).slice(-8).toUpperCase() : 'NEW'}
                    </h3>
                  </div>
                </div>
                <button
                  onClick={() => setActiveNewOrderAlert(null)}
                  className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
                >
                  <XIcon className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Order Info */}
              <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
                <div className="flex items-center justify-between bg-slate-950/80 p-3 rounded-2xl border border-slate-800">
                  <div>
                    <p className="text-xs text-slate-400 font-medium">Order Type / Location</p>
                    <p className="text-sm font-bold text-white">
                      {activeNewOrderAlert.tableNumber || activeNewOrderAlert.table?.tableNumber
                        ? `🍽️ Table ${activeNewOrderAlert.tableNumber || activeNewOrderAlert.table?.tableNumber}`
                        : '🏠 Home Delivery'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400 font-medium">Total Amount</p>
                    <p className="text-lg font-extrabold text-orange-400">
                      ₹{Number(activeNewOrderAlert.total || 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Items Summary */}
                {activeNewOrderAlert.items && activeNewOrderAlert.items.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Order Items:</p>
                    <div className="space-y-1.5 bg-slate-950 p-3 rounded-2xl border border-slate-800">
                      {activeNewOrderAlert.items.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-xs py-1.5 border-b border-slate-800/60 last:border-0">
                          <span className="font-semibold text-slate-100">
                            {item.menuItem?.name || item.name || 'Item'} × {item.quantity}
                          </span>
                          <span className="font-mono text-slate-400">
                            ₹{Number(item.subtotal || (item.unitPrice * item.quantity) || 0).toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payment Method Badge */}
                <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-blue-950/40 border border-blue-900/60">
                  <span className="font-semibold text-blue-300">Payment Method:</span>
                  <span className="font-bold text-blue-200">
                    {activeNewOrderAlert.paymentMethod === 'RAZORPAY' ? 'Pay Direct (Online)' : activeNewOrderAlert.paymentMethod === 'PAY_TO_WAITER' ? 'Pay to Waiter' : 'Pay on Counter'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-4 border-t border-slate-800 bg-slate-950 flex gap-2 flex-wrap">
                <button
                  onClick={async () => {
                    const orderId = activeNewOrderAlert.id;
                    try {
                      await handleUpdateStatus(orderId, 'PREPARING');
                      setActiveNewOrderAlert(null);
                    } catch {
                      setActiveNewOrderAlert(null);
                    }
                  }}
                  className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" /> Confirm Order
                </button>
                <button
                  onClick={() => {
                    setActiveNewOrderAlert(null);
                  }}
                  className="flex-1 py-3 px-4 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs shadow-md transition-all text-center"
                >
                  View All Orders
                </button>
                <button
                  onClick={() => setActiveNewOrderAlert(null)}
                  className="py-3 px-4 rounded-xl border border-slate-700 text-slate-300 font-semibold text-xs hover:bg-slate-800 transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Loader2Icon(props: any) {
  return <RefreshCw {...props} />;
}
