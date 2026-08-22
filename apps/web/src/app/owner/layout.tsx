'use client';

import { useEffect, useState, useRef } from 'react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import { Loader2, DollarSign, BellRing, Banknote, ShoppingBag, Check, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import { useWaiterStore, WaiterCall } from '@/store/waiter.store';
import { playNewOrderSound, playWaiterCallSound } from '@/utils/audio';

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

function hexToHsl(hex: string): { primary: string; foreground: string } {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }

  let r = parseInt(hex.substring(0, 2), 16) / 255;
  let g = parseInt(hex.substring(2, 4), 16) / 255;
  let b = parseInt(hex.substring(4, 6), 16) / 255;

  let max = Math.max(r, g, b);
  let min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  let l = (max + min) / 2;

  if (max !== min) {
    let d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  h = Math.round(h * 360);
  s = Math.round(s * 100);
  l = Math.round(l * 100);

  const primary = `${h} ${s}% ${l}%`;
  const foreground = l > 70 ? '217 30% 11.8%' : '0 0% 100%';

  return { primary, foreground };
}

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useAuthStore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const { activeWaiterAlert, addWaiterCall, removeWaiterCall, setActiveWaiterAlert } = useWaiterStore();
  const [activeNewOrderAlert, setActiveNewOrderAlert] = useState<any>(null);

  useEffect(() => {
    setMounted(true);
    if (mounted) {
      if (!isAuthenticated || !user) {
        router.push('/login');
      } else if (user.role !== 'RESTAURANT_OWNER') {
        router.push('/');
      }
    }
  }, [mounted, user, isAuthenticated, router]);

  const { data: restaurantData } = useQuery({
    queryKey: ['owner-restaurant-layout'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as { id: string; themeColor: string | null };
    },
    enabled: !!user && user.role === 'RESTAURANT_OWNER',
  });

  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  // Global socket connection for waiter calls and new orders
  useEffect(() => {
    if (!restaurantData?.id) return;

    const socket: Socket = io(
      process.env.NEXT_PUBLIC_SOCKET_URL ?? process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:4000',
      { transports: ['websocket', 'polling'], withCredentials: true }
    );
    socketRef.current = socket;
    useWaiterStore.getState().setSocket(socket);

    socket.emit('join:restaurant', restaurantData.id);
    if (user?.id) {
      socket.emit('join:user', user.id);
    }

    // 1. Waiter calls or payment requests
    socket.on('waiter:called', (payload: { 
      tableNumber: string; 
      calledAt: string; 
      restaurantId?: string;
      type?: 'default' | 'payment' | 'addons'; 
      amount?: number; 
      paymentMethod?: string;
      itemsSummary?: string;
    }) => {
      useWaiterStore.getState().addWaiterCall(payload);
      playWaiterCallSound();
      
      const isPayOnCounter = payload.paymentMethod === 'COD';
      const isPayToWaiter = payload.paymentMethod === 'PAY_TO_WAITER';
      
      let typeLabel = 'Waiter Call';
      let detailLabel = `Table ${payload.tableNumber} requested assistance`;
      
      if (payload.type === 'payment') {
        typeLabel = isPayOnCounter ? 'Counter Cash Checkout' : 'Pay to Waiter';
        detailLabel = `Table ${payload.tableNumber} requests checkout via ${isPayOnCounter ? 'Counter Cash' : 'Waiter'}${payload.amount ? ` (₹${payload.amount})` : ''}`;
      } else if (payload.type === 'addons') {
        typeLabel = isPayOnCounter 
          ? 'Add-on Pay on Counter' 
          : isPayToWaiter 
            ? 'Add-on Pay to Waiter' 
            : 'Add-on Items Added';
        detailLabel = `Table ${payload.tableNumber} added items${payload.amount ? ` (₹${payload.amount})` : ''}${payload.itemsSummary ? `: ${payload.itemsSummary}` : ''}`;
      }
        
      const waiterCallObj: WaiterCall = {
        id: `${payload.tableNumber}-${Date.now()}`,
        ...payload,
      };

      toast.info(`${typeLabel}: ${detailLabel}`, {
        duration: 10000,
        icon: '🔔',
      });
    });

    // 2. New order received
    socket.on('order:new', (order: any) => {
      playNewOrderSound();
      setActiveNewOrderAlert(order);
      
      const orderIdShort = order.id ? order.id.slice(-8).toUpperCase() : 'NEW';
      const itemsLabel = order.items?.map((i: any) => `${i.menuItem?.name || i.name || 'Item'} × ${i.quantity}`).join(', ');
      
      toast.success(`🛍️ New Order Received! #${orderIdShort} for ₹${order.total ? Number(order.total).toFixed(0) : ''}`, {
        description: itemsLabel,
        duration: 12000,
        icon: '🛍️',
      });
      
      // Auto-refresh orders and stats
      queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
    });

    // 3. Order status updated
    socket.on('order:status_updated', () => {
      queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
    });

    // 4. Broadcast & Direct Chat Notifications
    socket.on('notification:new', (notif: any) => {
      playAlertBeep();
      toast.info(notif.title || '📢 System Announcement', {
        description: notif.message,
        duration: 12000,
        icon: '📢',
      });
      queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
      queryClient.invalidateQueries({ queryKey: ['chat-contacts'] });
    });

    return () => {
      socket.disconnect();
      useWaiterStore.getState().setSocket(null);
    };
  }, [restaurantData?.id, queryClient]);

  const themeColor = restaurantData?.themeColor ?? '#E85D04';
  const { primary: primaryHsl, foreground: foregroundHsl } = hexToHsl(themeColor);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--primary', primaryHsl);
      document.documentElement.style.setProperty('--primary-foreground', foregroundHsl);
      document.documentElement.style.setProperty('--ring', primaryHsl);
    }
  }, [primaryHsl, foregroundHsl]);

  if (!mounted || !user || user.role !== 'RESTAURANT_OWNER') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      style={{
        '--primary': primaryHsl,
        '--primary-foreground': foregroundHsl,
        '--ring': primaryHsl,
      } as React.CSSProperties}
      className="min-h-screen relative"
    >
      {/* Global Waiter Call Modal */}
      <AnimatePresence>
        {activeWaiterAlert && (() => {
          const isPayOnCounter = activeWaiterAlert.paymentMethod === 'COD';
          const isPayToWaiter = activeWaiterAlert.paymentMethod === 'PAY_TO_WAITER';
          
          let title = 'Waiter Called!';
          let description = 'A table needs your attention';
          let gradientClass = 'from-orange-500 to-amber-500';
          let borderClass = 'border-orange-400';
          let IconComponent = BellRing;
          
          if (activeWaiterAlert.type === 'payment') {
            borderClass = 'border-amber-400';
            if (isPayOnCounter) {
              title = 'Pay on Counter Cash!';
              description = 'Table requests counter cash checkout';
              gradientClass = 'from-amber-600 to-yellow-500';
              IconComponent = Banknote;
            } else {
              title = 'Pay to Waiter!';
              description = 'Table requests waiter cash/UPI checkout';
              gradientClass = 'from-orange-600 to-amber-500';
              IconComponent = DollarSign;
            }
          } else if (activeWaiterAlert.type === 'addons') {
            borderClass = 'border-blue-400 dark:border-blue-500';
            if (isPayOnCounter) {
              title = 'Add-on Pay on Counter!';
              description = 'Table added items, requests counter checkout';
              gradientClass = 'from-blue-600 to-cyan-500';
              IconComponent = Banknote;
            } else if (isPayToWaiter) {
              title = 'Add-on Pay to Waiter!';
              description = 'Table added items, requests waiter checkout';
              gradientClass = 'from-indigo-600 to-blue-500';
              IconComponent = DollarSign;
            } else {
              title = 'Add-on Waiter Called!';
              description = 'Table added items, needs waiter attention';
              gradientClass = 'from-violet-600 to-indigo-500';
              IconComponent = BellRing;
            }
          }

          // Parse items list
          const items = activeWaiterAlert.itemsSummary 
            ? activeWaiterAlert.itemsSummary.split(', ') 
            : [];
          
          return (
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
                className={`relative mx-4 w-full max-w-sm bg-card border-2 ${borderClass} rounded-3xl shadow-2xl overflow-hidden`}
              >
                {/* Pulsing top banner */}
                <div className={`bg-gradient-to-r ${gradientClass} px-6 py-4 flex items-center gap-3`}>
                  <motion.div
                    animate={{ scale: [1, 1.15, 1] }}
                    transition={{ repeat: Infinity, duration: 1.0 }}
                  >
                    <IconComponent className="w-8 h-8 text-white" />
                  </motion.div>
                  <div>
                    <p className="text-white font-bold text-lg leading-tight">
                      {title}
                    </p>
                    <p className="text-orange-100 text-xs">
                      {description}
                    </p>
                  </div>
                </div>

                <div className="p-6 text-center space-y-4">
                  <div>
                    <p className="text-muted-foreground text-xs uppercase tracking-wider mb-1">Table Number</p>
                    <motion.p
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ repeat: Infinity, duration: 1.5 }}
                      className="text-6xl font-black text-foreground"
                    >
                      {activeWaiterAlert.tableNumber}
                    </motion.p>
                  </div>

                  {/* Payment Details */}
                  {activeWaiterAlert.amount && (
                    <div className="bg-muted/50 rounded-2xl p-3 border border-border/50">
                      <p className="text-xs text-muted-foreground mb-0.5">Amount Due</p>
                      <p className={`text-2xl font-black ${activeWaiterAlert.type === 'addons' ? 'text-blue-500' : 'text-orange-500'}`}>
                        ₹{activeWaiterAlert.amount.toFixed(2)}
                      </p>
                    </div>
                  )}

                  {/* Order / Add-on Items list */}
                  {items.length > 0 && (
                    <div className="text-left space-y-2">
                      <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                        {activeWaiterAlert.type === 'addons' ? 'Added Add-on Items' : 'Order Items'}
                      </p>
                      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-1 bg-muted/30 rounded-xl border border-border/35">
                        {items.map((item, idx) => (
                          <span 
                            key={idx} 
                            className={`text-xs px-2.5 py-1 rounded-lg font-semibold border ${
                              activeWaiterAlert.type === 'addons' 
                                ? 'bg-blue-50 text-blue-700 border-blue-200/60 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900/30' 
                                : 'bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900/30'
                            }`}
                          >
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Called at {new Date(activeWaiterAlert.calledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </p>
                </div>

                <div className="px-6 pb-6 flex gap-3">
                  <button
                    onClick={() => {
                      if (socketRef.current && activeWaiterAlert.tableNumber) {
                        socketRef.current.emit('waiter:dismiss', {
                          restaurantId: restaurantData?.id,
                          tableNumber: activeWaiterAlert.tableNumber,
                        });
                      }
                      removeWaiterCall(activeWaiterAlert.id);
                      setActiveWaiterAlert(null);
                    }}
                    className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold hover:bg-muted transition-colors text-foreground"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={() => {
                      if (socketRef.current && activeWaiterAlert.tableNumber) {
                        socketRef.current.emit('waiter:respond', {
                          restaurantId: restaurantData?.id,
                          tableNumber: activeWaiterAlert.tableNumber,
                        });
                      }
                      removeWaiterCall(activeWaiterAlert.id);
                      setActiveWaiterAlert(null);
                    }}
                    className={`flex-1 py-3 rounded-xl text-white text-sm font-bold bg-gradient-to-r ${gradientClass} hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5`}
                  >
                    <span>✓ Send Waiter 🏃</span>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Global New Order Alert Modal */}
      <AnimatePresence>
        {activeNewOrderAlert && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-card border-2 border-orange-500 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-card-foreground"
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
                      Order #{activeNewOrderAlert.id ? activeNewOrderAlert.id.slice(-8).toUpperCase() : 'NEW'}
                    </h3>
                  </div>
                </div>
                <button
                  onClick={() => setActiveNewOrderAlert(null)}
                  className="p-1.5 rounded-full hover:bg-white/20 transition-colors"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Order Info */}
              <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
                <div className="flex items-center justify-between bg-muted/50 p-3 rounded-2xl border border-border/50">
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Order Type / Location</p>
                    <p className="text-sm font-bold text-foreground">
                      {activeNewOrderAlert.tableNumber ? `🍽️ Table ${activeNewOrderAlert.tableNumber}` : '🏠 Home Delivery'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground font-medium">Total Amount</p>
                    <p className="text-lg font-extrabold text-orange-600 dark:text-orange-400">
                      ₹{Number(activeNewOrderAlert.total || 0).toFixed(2)}
                    </p>
                  </div>
                </div>

                {/* Items Summary */}
                {activeNewOrderAlert.items && activeNewOrderAlert.items.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Order Items:</p>
                    <div className="space-y-1.5 bg-background p-3 rounded-2xl border border-border/60">
                      {activeNewOrderAlert.items.map((item: any, idx: number) => (
                        <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-border/30 last:border-0">
                          <span className="font-semibold text-foreground">
                            {item.menuItem?.name || item.name || 'Item'} × {item.quantity}
                          </span>
                          <span className="font-mono text-muted-foreground">
                            ₹{Number(item.subtotal || (item.unitPrice * item.quantity) || 0).toFixed(0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Payment Method Badge */}
                <div className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/40">
                  <span className="font-semibold text-blue-700 dark:text-blue-300">Payment Method:</span>
                  <span className="font-bold text-blue-800 dark:text-blue-200">
                    {activeNewOrderAlert.paymentMethod === 'RAZORPAY' ? 'Pay Direct (Online)' : activeNewOrderAlert.paymentMethod === 'PAY_TO_WAITER' ? 'Pay to Waiter' : 'Pay on Counter'}
                  </span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="p-4 border-t border-border bg-muted/30 flex gap-2 flex-wrap">
                <button
                  onClick={async () => {
                    try {
                      await api.patch(`/owner/orders/${activeNewOrderAlert.id}/status`, { status: 'CONFIRMED' });
                      toast.success(`Order #${activeNewOrderAlert.id.slice(-8).toUpperCase()} Confirmed!`);
                      queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
                      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
                    } catch {
                      toast.error('Failed to confirm order.');
                    } finally {
                      setActiveNewOrderAlert(null);
                    }
                  }}
                  className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> Confirm Order
                </button>
                <button
                  onClick={() => {
                    setActiveNewOrderAlert(null);
                    router.push('/owner/orders');
                  }}
                  className="flex-1 py-3 px-4 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs shadow-md transition-all text-center"
                >
                  View All Orders
                </button>
                <button
                  onClick={() => setActiveNewOrderAlert(null)}
                  className="py-3 px-4 rounded-xl border border-border text-foreground font-semibold text-xs hover:bg-muted transition-colors"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {children}
    </div>
  );
}
