'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import { Loader2, DollarSign, BellRing, Banknote, ShoppingBag, Check, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getSocketUrl } from '@/lib/api';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import { useWaiterStore, WaiterCall } from '@/store/waiter.store';
import { playNewOrderSound, playWaiterCallSound, processRealTimeEvent, requestDesktopNotificationPermission, sendDesktopNotification } from '@/utils/audio';

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
  const { activeWaiterAlert, activeNewOrderAlert, activeGeneralNotificationAlert, setActiveWaiterAlert, setActiveNewOrderAlert, setActiveGeneralNotificationAlert } = useWaiterStore();

  useEffect(() => {
    setMounted(true);
    requestDesktopNotificationPermission();
  }, []);

  useEffect(() => {
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
  const processedEventsRef = useRef<Map<string, number>>(new Map());

  // Global socket connection for waiter calls and new orders
  useEffect(() => {
    const targetRestId = restaurantData?.id || (user as any)?.restaurantId;

    const socket: Socket = io(
      getSocketUrl(),
      { transports: ['websocket', 'polling'], withCredentials: true }
    );
    socketRef.current = socket;
    useWaiterStore.getState().setSocket(socket);

    const joinRooms = () => {
      const currentRestId = restaurantData?.id || (user as any)?.restaurantId;
      if (currentRestId) {
        socket.emit('join:restaurant', currentRestId);
      }
      if (user?.id) {
        socket.emit('join:user', user.id);
      }
    };

    if (socket.connected) {
      joinRooms();
    }

    socket.on('connect', joinRooms);

    // 1. Waiter calls or payment requests
    const handleWaiterCallEvent = (payload: { 
      tableNumber: string; 
      calledAt: string; 
      restaurantId?: string;
      type?: 'default' | 'payment' | 'addons'; 
      amount?: number; 
      paymentMethod?: string;
      itemsSummary?: string;
    }) => {
      const eventKey = `waiter-${payload.tableNumber}-${payload.type || 'default'}-${payload.calledAt || ''}`;
      const now = Date.now();
      if (processedEventsRef.current.has(eventKey) && now - (processedEventsRef.current.get(eventKey) || 0) < 3000) {
        return;
      }
      processedEventsRef.current.set(eventKey, now);

      const waiterCallObj: WaiterCall = {
        id: `${payload.tableNumber}-${now}`,
        ...payload,
      };
      useWaiterStore.getState().addWaiterCall(payload, true);

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

      processRealTimeEvent(
        'waiter_called',
        () => {
          useWaiterStore.getState().setActiveWaiterAlert(waiterCallObj);
        },
        {
          title: `🔔 ${typeLabel}`,
          body: detailLabel,
          tag: `waiter-${payload.tableNumber}-${payload.calledAt || Date.now()}`,
        },
        'owner'
      );

      toast.info(`${typeLabel}: ${detailLabel}`, {
        duration: 10000,
        icon: '🔔',
      });
      queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
      queryClient.refetchQueries({ queryKey: ['owner-notifications'] });
    };

    socket.on('waiter:called', handleWaiterCallEvent);
    socket.on('waiter_called', handleWaiterCallEvent);

    // 2. New order received
    const handleNewOrderEvent = (order: any) => {
      if (!order) return;

      const eventKey = `order-${order.id || Date.now()}`;
      const now = Date.now();
      if (order.id && processedEventsRef.current.has(eventKey) && now - (processedEventsRef.current.get(eventKey) || 0) < 3000) {
        return;
      }
      if (order.id) {
        processedEventsRef.current.set(eventKey, now);
      }

      useWaiterStore.getState().addNewOrder(order);

      const orderIdShort = order.id ? String(order.id).slice(-8).toUpperCase() : 'NEW';
      const itemsLabel = order.items?.map((i: any) => `${i.menuItem?.name || i.name || 'Item'} × ${i.quantity}`).join(', ') || 'New order received';
      const locationLabel = order.tableNumber ? `Table ${order.tableNumber}` : 'Home Delivery';
      const totalLabel = order.total ? `₹${Number(order.total).toFixed(2)}` : '';

      processRealTimeEvent(
        'new_order',
        () => {
          useWaiterStore.getState().setActiveNewOrderAlert(order);
        },
        {
          title: `🛍️ NEW ORDER RECEIVED #${orderIdShort}`,
          body: `${locationLabel} ${totalLabel ? `• ${totalLabel}` : ''}\nItems: ${itemsLabel}`,
          tag: `order-${order.id || Date.now()}`,
        },
        'owner'
      );
      
      toast.success(`🛍️ New Order Received! #${orderIdShort} for ₹${order.total ? Number(order.total).toFixed(0) : ''}`, {
        description: itemsLabel,
        duration: 12000,
        icon: '🛍️',
      });
      
      queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['owner-recent-orders-popover'] });
      queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
      queryClient.refetchQueries({ queryKey: ['owner-orders'] });
      queryClient.refetchQueries({ queryKey: ['owner-recent-orders-popover'] });
      queryClient.refetchQueries({ queryKey: ['owner-notifications'] });
    };

    socket.on('order:new', handleNewOrderEvent);
    socket.on('new_order', handleNewOrderEvent);
    socket.on('kitchen:new_order', handleNewOrderEvent);

    // 3. Order status updated
    const handleStatusUpdated = (payload?: any) => {
      const orderId = payload?.id || payload?.orderId;
      if (orderId) {
        useWaiterStore.getState().removeNewOrder(orderId);
        const currentAlert = useWaiterStore.getState().activeNewOrderAlert;
        if (currentAlert?.id === orderId) {
          setActiveNewOrderAlert(null);
        }
      }
      queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['owner-recent-orders-popover'] });
      queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
      queryClient.refetchQueries({ queryKey: ['owner-orders'] });
      queryClient.refetchQueries({ queryKey: ['owner-dashboard'] });
      queryClient.refetchQueries({ queryKey: ['owner-recent-orders-popover'] });
      queryClient.refetchQueries({ queryKey: ['owner-notifications'] });
    };

    socket.on('order:status_updated', handleStatusUpdated);
    socket.on('order_status_changed', handleStatusUpdated);
    socket.on('order_cancelled', handleStatusUpdated);
    socket.on('driver_assigned', handleStatusUpdated);

    // 4. Broadcast & Direct Chat Notifications
    socket.on('notification:new', (notif: any) => {
      if (notif.type !== 'NEW_ORDER' && notif.type !== 'WAITER_CALL') {
        const notifObj = {
          id: notif.id || `notif-${Date.now()}`,
          title: notif.title || 'New Notification Alert',
          message: notif.message || notif.body || '',
          type: notif.type || 'NOTIFICATION',
          createdAt: notif.createdAt || new Date().toISOString(),
        };

        processRealTimeEvent('waiter_called', () => {
          setActiveGeneralNotificationAlert(notifObj);
        });
      } else {
        playAlertBeep();
      }

      if (notif.title) {
        sendDesktopNotification(notif.title, {
          body: notif.message || notif.body || '',
          tag: `notif-${notif.id || Date.now()}`,
        });

        toast.info(notif.title, {
          description: notif.message,
          duration: 10000,
          icon: '🔔',
        });
      }
      queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
      queryClient.invalidateQueries({ queryKey: ['chat-contacts'] });
      queryClient.refetchQueries({ queryKey: ['owner-notifications'] });
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

  // Auto-open modal popup for any unhandled pending waiter call or new order
  const { waiterCalls, newOrders } = useWaiterStore();
  useEffect(() => {
    if (!activeWaiterAlert && waiterCalls.length > 0) {
      useWaiterStore.getState().setActiveWaiterAlert(waiterCalls[0]);
    }
  }, [waiterCalls, activeWaiterAlert]);

  useEffect(() => {
    if (!activeNewOrderAlert && newOrders.length > 0) {
      const pendingOrder = newOrders.find(
        (o) => !o.status || !['DELIVERED', 'CANCELLED', 'COMPLETED', 'SERVED'].includes(String(o.status).toUpperCase())
      );
      if (pendingOrder) {
        useWaiterStore.getState().setActiveNewOrderAlert(pendingOrder);
      }
    }
  }, [newOrders, activeNewOrderAlert]);

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
      {/* Global Waiter Call Alert Modal */}
      <AnimatePresence>
        {activeWaiterAlert && (() => {
          const isPayment = activeWaiterAlert.type === 'payment';
          const isAddons = activeWaiterAlert.type === 'addons';
          const isPayOnCounter = activeWaiterAlert.paymentMethod === 'COD';
          const isPayToWaiter = activeWaiterAlert.paymentMethod === 'PAY_TO_WAITER';
          
          let headerTitle = 'WAITER CALL REQUEST';
          let headerSubtitle = 'Customer requested staff assistance at table';
          let badgeText = 'TABLE CALL';
          let icon = <BellRing className="w-6 h-6 text-white animate-bounce" />;
          let headerGradient = 'from-amber-500 via-orange-500 to-red-500';
          let borderClass = 'border-amber-500';
          let buttonLabel = 'Acknowledge Call';
          let gradientClass = 'from-amber-600 to-orange-600';

          if (isPayment) {
            if (isPayOnCounter) {
              headerTitle = 'COUNTER CASH CHECKOUT';
              headerSubtitle = 'Customer wants to pay cash directly at billing counter';
              badgeText = 'COUNTER CASH';
              icon = <Banknote className="w-6 h-6 text-white animate-pulse" />;
              headerGradient = 'from-emerald-600 via-teal-600 to-green-600';
              borderClass = 'border-emerald-500';
              buttonLabel = 'Confirm Counter Cash Checkout';
              gradientClass = 'from-emerald-600 to-teal-600';
            } else {
              headerTitle = 'PAY TO WAITER REQUEST';
              headerSubtitle = 'Customer requested waiter to collect payment';
              badgeText = 'WAITER CASH';
              icon = <DollarSign className="w-6 h-6 text-white animate-pulse" />;
              headerGradient = 'from-blue-600 via-indigo-600 to-purple-600';
              borderClass = 'border-blue-500';
              buttonLabel = 'Send Waiter for Payment';
              gradientClass = 'from-blue-600 to-indigo-600';
            }
          } else if (isAddons) {
            headerTitle = 'ADD-ON ITEMS ADDED';
            headerSubtitle = isPayOnCounter 
              ? 'Add-on order placed (Pay on Counter)' 
              : isPayToWaiter 
                ? 'Add-on order placed (Pay to Waiter)' 
                : 'Customer added extra items to order';
            badgeText = 'ADD-ON ORDER';
            icon = <ShoppingBag className="w-6 h-6 text-white animate-bounce" />;
            headerGradient = 'from-orange-600 via-amber-600 to-yellow-500';
            borderClass = 'border-orange-500';
            buttonLabel = 'Accept Add-on Order';
            gradientClass = 'from-orange-600 to-amber-600';
          }

          return (
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
                className={`bg-card border-2 ${borderClass} rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden text-card-foreground`}
              >
                {/* Header Banner */}
                <div className={`bg-gradient-to-r ${headerGradient} p-5 text-white flex items-center justify-between`}>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs shadow-inner">
                      {icon}
                    </div>
                    <div>
                      <span className="text-[10px] font-extrabold uppercase tracking-widest bg-white/25 px-2.5 py-0.5 rounded-full">
                        {badgeText}
                      </span>
                      <h3 className="font-display font-extrabold text-xl leading-tight mt-0.5">
                        {headerTitle}
                      </h3>
                      <p className="text-xs text-white/90 font-medium">
                        {headerSubtitle}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => useWaiterStore.getState().setActiveWaiterAlert(null)}
                    className="p-2 rounded-full hover:bg-white/20 transition-colors text-white"
                    title="Dismiss alert"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Table & Call Info Body */}
                <div className="p-6 space-y-4">
                  <div className="bg-muted/60 p-4 rounded-2xl border border-border flex items-center justify-between">
                    <div>
                      <span className="text-xs text-muted-foreground font-semibold block uppercase tracking-wider">
                        Location / Table
                      </span>
                      <span className="text-2xl font-black text-foreground">
                        🍽️ Table {activeWaiterAlert.tableNumber}
                      </span>
                    </div>
                    {activeWaiterAlert.amount ? (
                      <div className="text-right">
                        <span className="text-xs text-muted-foreground font-semibold block uppercase tracking-wider">
                          Amount
                        </span>
                        <span className="text-xl font-extrabold text-orange-600 dark:text-orange-400">
                          ₹{Number(activeWaiterAlert.amount).toFixed(2)}
                        </span>
                      </div>
                    ) : null}
                  </div>

                  {/* Addons summary if available */}
                  {activeWaiterAlert.itemsSummary && (
                    <div className="bg-orange-500/10 border border-orange-500/30 p-3.5 rounded-2xl">
                      <span className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider block mb-1">
                        📦 Added Items:
                      </span>
                      <p className="text-xs font-semibold text-foreground">
                        {activeWaiterAlert.itemsSummary}
                      </p>
                    </div>
                  )}

                  {/* Call Timestamp */}
                  <div className="text-xs text-muted-foreground flex items-center gap-1.5 font-medium px-1">
                    <span>Requested at:</span>
                    <span className="font-bold text-foreground">
                      {activeWaiterAlert.calledAt ? new Date(activeWaiterAlert.calledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="p-4 border-t border-border bg-muted/30 flex items-center gap-3">
                  <button
                    onClick={() => {
                      const socket = useWaiterStore.getState().socket;
                      if (socket && activeWaiterAlert.restaurantId) {
                        socket.emit('waiter:dismiss', {
                          restaurantId: activeWaiterAlert.restaurantId,
                          tableNumber: activeWaiterAlert.tableNumber,
                        });
                      }
                      useWaiterStore.getState().dismissWaiterCall(activeWaiterAlert.id, activeWaiterAlert.tableNumber);
                      useWaiterStore.getState().setActiveWaiterAlert(null);
                    }}
                    className="py-3 px-5 rounded-xl border border-border text-foreground text-sm font-semibold hover:bg-muted transition-colors cursor-pointer"
                  >
                    Dismiss
                  </button>
                  <button
                    onClick={async () => {
                      const socket = useWaiterStore.getState().socket;
                      if (socket && activeWaiterAlert.restaurantId) {
                        socket.emit('waiter:respond', {
                          restaurantId: activeWaiterAlert.restaurantId,
                          tableNumber: activeWaiterAlert.tableNumber,
                        });
                      }
                      useWaiterStore.getState().dismissWaiterCall(activeWaiterAlert.id, activeWaiterAlert.tableNumber);
                      useWaiterStore.getState().setActiveWaiterAlert(null);
                      try {
                        await api.patch('/profile/notifications/read');
                        queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
                      } catch {}
                    }}
                    className={`flex-1 py-3 px-5 rounded-xl text-white text-sm font-bold bg-gradient-to-r ${gradientClass} hover:opacity-90 transition-opacity cursor-pointer`}
                  >
                    {buttonLabel}
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
          !activeNewOrderAlert.status ||
          !['DELIVERED', 'CANCELLED', 'COMPLETED', 'SERVED'].includes(String(activeNewOrderAlert.status).toUpperCase())
        ) && (
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
                      Order #{activeNewOrderAlert.id ? String(activeNewOrderAlert.id).slice(-8).toUpperCase() : 'NEW'}
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
                    const orderId = activeNewOrderAlert.id;
                    try {
                      await api.patch(`/owner/orders/${orderId}/status`, { status: 'CONFIRMED' });
                      toast.success(`Order #${orderId.slice(-8).toUpperCase()} Confirmed!`);
                      useWaiterStore.getState().removeNewOrder(orderId);
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

      {/* Global General Notification Alert Modal */}
      <AnimatePresence>
        {activeGeneralNotificationAlert && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs"
          >
            <motion.div
              initial={{ scale: 0.85, y: 30 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.85, y: 30 }}
              transition={{ type: 'spring', stiffness: 300, damping: 24 }}
              className="bg-card border-2 border-primary/60 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden text-card-foreground relative"
            >
              {/* Top Banner */}
              <div className="bg-gradient-to-r from-primary via-orange-500 to-amber-500 p-5 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center backdrop-blur-xs">
                    <BellRing className="w-5 h-5 text-white animate-bounce" />
                  </div>
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full">
                      {activeGeneralNotificationAlert.type || 'Notification'}
                    </span>
                    <h3 className="font-display font-extrabold text-lg leading-tight line-clamp-1">
                      {activeGeneralNotificationAlert.title}
                    </h3>
                  </div>
                </div>
                <button
                  onClick={() => setActiveGeneralNotificationAlert(null)}
                  className="p-1.5 rounded-full hover:bg-white/20 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5 text-white" />
                </button>
              </div>

              {/* Message Content */}
              <div className="p-6 space-y-4">
                <div className="bg-muted/50 p-4 rounded-2xl border border-border/50">
                  <p className="text-sm font-medium text-foreground leading-relaxed whitespace-pre-wrap">
                    {activeGeneralNotificationAlert.message || 'You have received a new update.'}
                  </p>
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  Received at {new Date(activeGeneralNotificationAlert.createdAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="p-4 border-t border-border bg-muted/30 flex gap-2">
                <button
                  onClick={() => setActiveGeneralNotificationAlert(null)}
                  className="flex-1 py-3 px-4 rounded-xl bg-primary hover:bg-primary/90 text-white font-bold text-xs shadow-md transition-all text-center cursor-pointer"
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
