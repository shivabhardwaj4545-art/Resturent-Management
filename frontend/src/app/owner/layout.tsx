'use client';

import { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useAuthStore } from '@/store/auth.store';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Loader2, DollarSign, BellRing, Banknote, ShoppingBag, Check, X, Bed, Lock, Sparkles, AlertTriangle } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { getSocketUrl } from '@/services/api';
import { AnimatePresence, motion } from 'framer-motion';
import { io, Socket } from 'socket.io-client';
import { useWaiterStore, WaiterCall } from '@/store/waiter.store';
import { playNewOrderSound, playWaiterCallSound, playOrderStatusSound, processRealTimeEvent, requestDesktopNotificationPermission, sendDesktopNotification } from '@/utils/audio';
import { OwnerSidebar, OWNER_NAV_ITEMS } from '@/components/owner/OwnerSidebar';
import { isItemAddon } from '@/utils/orderAddon';
import { printKitchenOrderTicket } from '@/utils/kotPrint';
import { toast } from 'sonner';

import { applyThemeColor, hexToHsl } from '@/utils/theme';
import { PREDEFINED_REJECTION_REASONS } from '@/utils/orderRejection';

// Safe alert sound for generic alerts
function playAlertBeep() {
  try {
    playOrderStatusSound();
  } catch { /* silent fail */ }
}

function formatTableLabel(raw?: string | number | null): string {
  if (raw === undefined || raw === null || raw === '') return 'Table';
  const trimmed = String(raw).trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('room') || lower.startsWith('suite')) {
    const stripped = trimmed.replace(/^(room|suite)\s*(room|suite)?\s*/i, '').trim();
    return stripped ? `Room ${stripped}` : trimmed;
  }
  if (lower.startsWith('table')) {
    const strippedTable = trimmed.replace(/^(table\s*)+/i, '').trim();
    return strippedTable ? `Table ${strippedTable}` : 'Table';
  }
  if (/^\d+$/.test(trimmed)) {
    return `Table ${trimmed}`;
  }
  return trimmed;
}

export default function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, isBootstrapping } = useAuthStore();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [isAcceptingOrder, setIsAcceptingOrder] = useState(false);
  const [rejectOrderTarget, setRejectOrderTarget] = useState<any | null>(null);
  const [selectedRejectReason, setSelectedRejectReason] = useState<string>(PREDEFINED_REJECTION_REASONS[0]);
  const [customRejectReason, setCustomRejectReason] = useState<string>('');
  const [isRejecting, setIsRejecting] = useState<boolean>(false);
  const { activeWaiterAlert, activeNewOrderAlert, activeGeneralNotificationAlert, setActiveWaiterAlert, setActiveNewOrderAlert, setActiveGeneralNotificationAlert } = useWaiterStore();

  useEffect(() => {
    setMounted(true);
    requestDesktopNotificationPermission();
  }, []);

  useEffect(() => {
    if (mounted && !isBootstrapping) {
      if (!isAuthenticated || !user) {
        router.push('/login');
      } else if (user.role !== 'RESTAURANT_OWNER') {
        router.push('/');
      }
    }
  }, [mounted, isBootstrapping, user, isAuthenticated, router]);

  const pathname = usePathname();
  const { data: restaurantData } = useQuery({
    queryKey: ['owner-restaurant-layout'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as {
        id: string;
        name?: string;
        themeColor: string | null;
        disabledTabs?: string[] | null;
        featureFlags?: {
          kotMode?: 'DIGITAL_KDS' | 'PRINT_KOT';
          [key: string]: any;
        };
      };
    },
    enabled: !!user && user.role === 'RESTAURANT_OWNER',
  });

  const disabledTabs: string[] = Array.isArray(restaurantData?.disabledTabs) ? restaurantData.disabledTabs : [];
  const currentTab = OWNER_NAV_ITEMS.find((item) => item.href !== '/owner' && pathname?.startsWith(item.href));
  const isCurrentTabDisabled = Boolean(currentTab && disabledTabs.includes(currentTab.key));

  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const processedEventsRef = useRef<Map<string, number>>(new Map());

  // Global socket connection for waiter calls and new orders
  useEffect(() => {
    const targetRestId = restaurantData?.id || (user as any)?.restaurantId;

    const socket: Socket = io(
      getSocketUrl(),
      { transports: ['polling', 'websocket'], withCredentials: true }
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
    socket.on('connect_error', (err) => {
      console.warn('Real-time socket notice:', err.message);
    });

    // 1. Waiter calls or room service / payment requests
    const handleWaiterCallEvent = (payload: {
      tableNumber: string;
      calledAt: string;
      restaurantId?: string;
      type?: 'default' | 'payment' | 'addons';
      amount?: number;
      paymentMethod?: string;
      itemsSummary?: string;
      purpose?: string;
      customNote?: string;
    }) => {
      const currentRestId = payload.restaurantId || restaurantData?.id || (user as any)?.restaurantId;
      const eventKey = `waiter-${payload.tableNumber}-${payload.type || 'default'}-${payload.calledAt || ''}`;
      const now = Date.now();
      if (processedEventsRef.current.has(eventKey) && now - (processedEventsRef.current.get(eventKey) || 0) < 3000) {
        return;
      }
      processedEventsRef.current.set(eventKey, now);

      const isRoom = payload.tableNumber.toLowerCase().includes('room') || payload.tableNumber.toLowerCase().includes('suite');
      const roomLabel = formatTableLabel(payload.tableNumber);

      const waiterCallObj: WaiterCall = {
        id: `${payload.tableNumber}-${now}`,
        ...payload,
        restaurantId: currentRestId,
      };
      useWaiterStore.getState().addWaiterCall(waiterCallObj, true);

      const isPayOnCounter = payload.paymentMethod === 'COD';
      const isPayToWaiter = payload.paymentMethod === 'PAY_TO_WAITER';

      let typeLabel = isRoom ? 'Room Service' : 'Waiter Call';
      let detailLabel = `${roomLabel} requested assistance`;

      if (payload.type === 'payment') {
        typeLabel = isPayOnCounter ? 'Counter Cash Checkout' : 'Pay to Waiter';
        detailLabel = `${roomLabel} requests checkout via ${isPayOnCounter ? 'Counter Cash' : 'Waiter'}${payload.amount ? ` (₹${payload.amount})` : ''}`;
      } else if (payload.type === 'addons') {
        typeLabel = isPayOnCounter
          ? 'Add-on Pay on Counter'
          : isPayToWaiter
            ? 'Add-on Pay to Waiter'
            : 'Add-on Items Added';
        detailLabel = `${roomLabel} added items${payload.amount ? ` (₹${payload.amount})` : ''}${payload.itemsSummary ? `: ${payload.itemsSummary}` : ''}`;
      } else if (payload.purpose) {
        typeLabel = isRoom ? `Room Service (${payload.purpose})` : `Waiter Call (${payload.purpose})`;
        detailLabel = payload.customNote
          ? `${payload.purpose} for ${roomLabel}: "${payload.customNote}"`
          : `${payload.purpose} requested for ${roomLabel}`;
      }

      processRealTimeEvent(
        'waiter_called',
        () => {
          useWaiterStore.getState().setActiveWaiterAlert(waiterCallObj);
        },
        {
          title: isRoom ? `🛎️ ${typeLabel}` : `🔔 ${typeLabel}`,
          body: detailLabel,
          tag: `waiter-${payload.tableNumber}-${payload.calledAt || Date.now()}`,
        },
        'owner'
      );

      queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
      queryClient.refetchQueries({ queryKey: ['owner-notifications'] });
    };

    socket.on('waiter:called', handleWaiterCallEvent);
    socket.on('waiter_called', handleWaiterCallEvent);

    // 2. New order received
    const handleNewOrderEvent = (order: any) => {
      if (!order) return;

      const isAddonOrder = Boolean(order.isNewAddon || order.isAddon || order.addOnStatus === 'PENDING');
      const orderId = order.id || order.orderId;
      const eventKey = isAddonOrder ? `order-addon-${orderId}-${Date.now()}` : `order-${orderId || Date.now()}`;
      const now = Date.now();
      if (!isAddonOrder && orderId && processedEventsRef.current.has(eventKey) && now - (processedEventsRef.current.get(eventKey) || 0) < 3000) {
        return;
      }
      if (orderId) {
        processedEventsRef.current.set(eventKey, now);
      }

      const normalizedOrder = {
        ...order,
        id: orderId,
        isAddon: isAddonOrder,
        isNewAddon: isAddonOrder,
        addOnStatus: order.addOnStatus || (isAddonOrder ? 'PENDING' : null),
      };

      useWaiterStore.getState().addNewOrder(normalizedOrder);

      const orderIdShort = normalizedOrder.id ? String(normalizedOrder.id).slice(-8).toUpperCase() : 'NEW';
      const itemsLabel = normalizedOrder.items?.map((i: any) => `${i.menuItem?.name || i.name || 'Item'} × ${i.quantity}`).join(', ') || 'New order received';
      const locationLabel = normalizedOrder.tableNumber ? formatTableLabel(normalizedOrder.tableNumber) : 'Home Delivery';
      const totalLabel = normalizedOrder.total ? `₹${Number(normalizedOrder.total).toFixed(2)}` : '';
      const alertTitle = isAddonOrder ? `⚡ ADD-ON ORDER RECEIVED #${orderIdShort}` : `🛍️ NEW ORDER RECEIVED #${orderIdShort}`;

      processRealTimeEvent(
        'new_order',
        () => {
          useWaiterStore.getState().setActiveNewOrderAlert(normalizedOrder);
        },
        {
          title: alertTitle,
          body: `${locationLabel} ${totalLabel ? `• ${totalLabel}` : ''}\nItems: ${itemsLabel}`,
          tag: `order-${normalizedOrder.id || Date.now()}`,
        },
        'owner'
      );

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
    socket.on('order:new_addon', handleNewOrderEvent);

    // 3. Order status updated
    const handleStatusUpdated = (payload?: any) => {
      const orderId = payload?.id || payload?.orderId;
      if (payload?.isNewAddon) {
        // Do not dismiss alert if a new add-on was placed
        return;
      }
      if (orderId) {
        useWaiterStore.getState().removeNewOrder(orderId);
        const currentAlert = useWaiterStore.getState().activeNewOrderAlert;
        const currentAlertId = currentAlert?.id || (currentAlert as any)?.orderId;
        if (!currentAlert || currentAlertId === orderId) {
          setActiveNewOrderAlert(null);
          useWaiterStore.getState().setActiveNewOrderAlert(null);
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

    const handleDismissAlert = (payload?: any) => {
      if (payload?.addOnStatus === 'PENDING' || payload?.isNewAddon) return;
      const orderId = payload?.id || payload?.orderId;
      if (orderId) {
        useWaiterStore.getState().removeNewOrder(orderId);
      }
      const currentAlert = useWaiterStore.getState().activeNewOrderAlert;
      const currentAlertId = currentAlert?.id || (currentAlert as any)?.orderId;
      if (!orderId || currentAlertId === orderId) {
        setActiveNewOrderAlert(null);
        useWaiterStore.getState().setActiveNewOrderAlert(null);
      }
    };

    socket.on('order:status_updated', handleStatusUpdated);
    socket.on('order_status_changed', handleStatusUpdated);
    socket.on('order_cancelled', handleStatusUpdated);
    socket.on('driver_assigned', handleStatusUpdated);
    socket.on('order:dismiss_alert', handleDismissAlert);

    // 4. Broadcast & Direct Chat Notifications
    socket.on('notification:new', (notif: any) => {
      if (notif.type === 'NEW_ORDER') {
        if (notif.data) {
          handleNewOrderEvent(notif.data);
        } else {
          playNewOrderSound();
        }
      } else if (notif.type === 'WAITER_CALL') {
        if (notif.data) {
          handleWaiterCallEvent(notif.data);
        } else {
          playWaiterCallSound();
        }
      } else {
        const notifObj = {
          id: notif.id || `notif-${Date.now()}`,
          title: notif.title || 'New Notification Alert',
          message: notif.message || notif.body || '',
          type: notif.type || 'NOTIFICATION',
          createdAt: notif.createdAt || new Date().toISOString(),
        };

        processRealTimeEvent('order_status_changed', () => {
          setActiveGeneralNotificationAlert(notifObj);
        });
      }

      if (notif.title && notif.type !== 'NEW_ORDER' && notif.type !== 'WAITER_CALL') {
        sendDesktopNotification(notif.title, {
          body: notif.message || notif.body || '',
          tag: `notif-${notif.id || Date.now()}`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
      queryClient.invalidateQueries({ queryKey: ['chat-messages'] });
      queryClient.invalidateQueries({ queryKey: ['chat-contacts'] });
      queryClient.refetchQueries({ queryKey: ['owner-notifications'] });
    });

    const handleFeaturesUpdated = () => {
      queryClient.invalidateQueries({ queryKey: ['owner-restaurant-layout'] });
      queryClient.invalidateQueries({ queryKey: ['owner-restaurant-sidebar'] });
      queryClient.invalidateQueries({ queryKey: ['owner-restaurant'] });
      queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
      queryClient.invalidateQueries({ queryKey: ['owner-kitchen-staff'] });
    };

    socket.on('restaurant:features_updated', handleFeaturesUpdated);
    socket.on('restaurant:updated', handleFeaturesUpdated);

    return () => {
      socket.off('restaurant:features_updated', handleFeaturesUpdated);
      socket.off('restaurant:updated', handleFeaturesUpdated);
      socket.disconnect();
      useWaiterStore.getState().setSocket(null);
    };
  }, [restaurantData?.id, user?.id, queryClient]);

  // Ensure socket joins restaurant and user rooms whenever id becomes available
  useEffect(() => {
    const currentRestId = restaurantData?.id || (user as any)?.restaurantId;
    if (socketRef.current) {
      if (currentRestId) {
        socketRef.current.emit('join:restaurant', currentRestId);
      }
      if (user?.id) {
        socketRef.current.emit('join:user', user.id);
      }
    }
  }, [restaurantData?.id, user?.id]);

  const themeColor = restaurantData?.themeColor ?? '#E85D04';
  const { primary: primaryHsl, foreground: foregroundHsl } = hexToHsl(themeColor);

  useEffect(() => {
    applyThemeColor(themeColor);
  }, [themeColor]);

  // Auto-open modal popup for any unhandled pending waiter call or new order


  if (!mounted || isBootstrapping || !user || user.role !== 'RESTAURANT_OWNER') {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-sm font-medium text-muted-foreground">Authenticating session...</p>
      </div>
    );
  }

  return (
    <div
      style={{
        '--primary': primaryHsl,
        '--primary-foreground': foregroundHsl,
        '--secondary': primaryHsl,
        '--secondary-foreground': foregroundHsl,
        '--ring': primaryHsl,
      } as React.CSSProperties}
      className="min-h-screen relative"
    >
      {/* Global Waiter Call & Hotel Room Service Alert Modal (Portalled to document.body) */}
      {mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {activeWaiterAlert && (() => {
            const isPayment = activeWaiterAlert.type === 'payment';
            const isAddons = activeWaiterAlert.type === 'addons';
            const isPayOnCounter = activeWaiterAlert.paymentMethod === 'COD';
            const isPayToWaiter = activeWaiterAlert.paymentMethod === 'PAY_TO_WAITER';
            const isRoom = activeWaiterAlert.tableNumber.toLowerCase().includes('room') || activeWaiterAlert.tableNumber.toLowerCase().includes('suite');
            const roomLabel = formatTableLabel(activeWaiterAlert.tableNumber);

            let headerTitle = isRoom ? 'HOTEL ROOM SERVICE' : 'WAITER CALL REQUEST';
            let headerSubtitle = isRoom ? `Guest in ${roomLabel} requested hotel room service` : 'Customer requested staff assistance at table';
            let badgeText = isRoom ? 'ROOM SERVICE' : 'TABLE CALL';
            let icon = isRoom ? <Bed className="w-6 h-6 text-white animate-bounce" /> : <BellRing className="w-6 h-6 text-white animate-bounce" />;
            let headerGradient = isRoom ? 'from-amber-600 via-orange-600 to-rose-600' : 'from-amber-500 via-orange-500 to-red-500';
            let borderClass = isRoom ? 'border-amber-500' : 'border-amber-500';
            let buttonLabel = isRoom ? 'Acknowledge Room Service' : 'Acknowledge Call';
            let gradientClass = isRoom ? 'from-amber-600 to-rose-600' : 'from-amber-600 to-orange-600';

            if (isRoom && activeWaiterAlert.purpose) {
              headerTitle = `ROOM SERVICE: ${activeWaiterAlert.purpose.toUpperCase()}`;
              headerSubtitle = activeWaiterAlert.customNote
                ? `Note: "${activeWaiterAlert.customNote}"`
                : `${activeWaiterAlert.purpose} requested for ${roomLabel}`;
            }

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
                className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs pointer-events-auto"
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
                      onClick={() => {
                        if (activeWaiterAlert) {
                          const socket = useWaiterStore.getState().socket;
                          const restId = activeWaiterAlert.restaurantId || restaurantData?.id || (user as any)?.restaurantId;
                          if (socket && restId) {
                            socket.emit('waiter:dismiss', {
                              restaurantId: restId,
                              tableNumber: activeWaiterAlert.tableNumber,
                            });
                          }
                          useWaiterStore.getState().dismissWaiterCall(activeWaiterAlert.id, activeWaiterAlert.tableNumber);
                          useWaiterStore.getState().setActiveWaiterAlert(null);
                          api.patch('/profile/notifications/read').then(() => {
                            queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
                          }).catch(() => { });
                        }
                      }}
                      className="p-2 rounded-full hover:bg-white/20 transition-colors text-white cursor-pointer"
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
                          {isRoom ? 'Hotel Room' : 'Location / Table'}
                        </span>
                        <span className="text-2xl font-black text-foreground">
                          {isRoom ? `🛏️ ${roomLabel}` : `🍽️ ${roomLabel}`}
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

                    {/* Calling Purpose & Custom Note */}
                    {(activeWaiterAlert.purpose || activeWaiterAlert.customNote) && (
                      <div className="bg-primary/10 border border-primary/30 p-3.5 rounded-2xl space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-primary uppercase tracking-wider">
                            🎯 Service Requested:
                          </span>
                          {activeWaiterAlert.purpose && (
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-primary text-white">
                              {activeWaiterAlert.purpose}
                            </span>
                          )}
                        </div>
                        {activeWaiterAlert.customNote && (
                          <p className="text-xs font-semibold text-foreground bg-background/60 p-2.5 rounded-xl border border-border/50 italic">
                            "{activeWaiterAlert.customNote}"
                          </p>
                        )}
                      </div>
                    )}

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
                        const restId = activeWaiterAlert.restaurantId || restaurantData?.id || (user as any)?.restaurantId;
                        if (socket && restId) {
                          socket.emit('waiter:dismiss', {
                            restaurantId: restId,
                            tableNumber: activeWaiterAlert.tableNumber,
                          });
                        }
                        useWaiterStore.getState().dismissWaiterCall(activeWaiterAlert.id, activeWaiterAlert.tableNumber);
                        useWaiterStore.getState().setActiveWaiterAlert(null);
                        api.patch('/profile/notifications/read').then(() => {
                          queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
                        }).catch(() => { });
                      }}
                      className="py-3 px-5 rounded-xl border border-border text-foreground text-sm font-semibold hover:bg-muted transition-colors cursor-pointer"
                    >
                      Dismiss
                    </button>
                    <button
                      onClick={async () => {
                        const socket = useWaiterStore.getState().socket;
                        const restId = activeWaiterAlert.restaurantId || restaurantData?.id || (user as any)?.restaurantId;
                        if (socket && restId) {
                          socket.emit('waiter:respond', {
                            restaurantId: restId,
                            tableNumber: activeWaiterAlert.tableNumber,
                          });
                        }
                        useWaiterStore.getState().dismissWaiterCall(activeWaiterAlert.id, activeWaiterAlert.tableNumber);
                        useWaiterStore.getState().setActiveWaiterAlert(null);
                        try {
                          await api.patch('/profile/notifications/read');
                          queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
                        } catch { }
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
        </AnimatePresence>,
        document.body
      )}

      {/* Global New Order / Add-on Alert Modal (Portalled to document.body) */}
      {mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {activeNewOrderAlert && (
            (activeNewOrderAlert.status === 'PENDING' || !activeNewOrderAlert.status || activeNewOrderAlert.addOnStatus === 'PENDING') &&
            activeNewOrderAlert.status !== 'CANCELLED' &&
            activeNewOrderAlert.status !== 'DELIVERED' &&
            (activeNewOrderAlert.status !== 'CONFIRMED' || activeNewOrderAlert.addOnStatus === 'PENDING')
          ) && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs pointer-events-auto"
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
                        {activeNewOrderAlert.isNewAddon || activeNewOrderAlert.isAddon ? (
                          <Sparkles className="w-5 h-5 text-white animate-spin" />
                        ) : (
                          <ShoppingBag className="w-5 h-5 text-white animate-bounce" />
                        )}
                      </div>
                      <div>
                        <span className="text-[10px] font-extrabold uppercase tracking-widest bg-white/20 px-2 py-0.5 rounded-full">
                          {activeNewOrderAlert.isNewAddon || activeNewOrderAlert.isAddon ? '⚡ Add-on Order Notification' : 'New Order Notification'}
                        </span>
                        <h3 className="font-display font-extrabold text-xl leading-tight">
                          {activeNewOrderAlert.isNewAddon || activeNewOrderAlert.isAddon ? 'Add-on #' : 'Order #'}{activeNewOrderAlert.id ? String(activeNewOrderAlert.id).slice(-8).toUpperCase() : 'NEW'}
                        </h3>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveNewOrderAlert(null)}
                      className="p-1.5 rounded-full hover:bg-white/20 transition-colors cursor-pointer"
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
                          {activeNewOrderAlert.tableNumber ? `🍽️ ${formatTableLabel(activeNewOrderAlert.tableNumber)}` : '🏠 Home Delivery'}
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
                          {activeNewOrderAlert.items.map((item: any, idx: number) => {
                            const isAddon = isItemAddon(item, activeNewOrderAlert);
                            return (
                              <div key={idx} className="flex justify-between items-center text-xs py-1 border-b border-border/30 last:border-0 gap-2">
                                <span className="font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
                                  {item.menuItem?.name || item.name || 'Item'} × {item.quantity}
                                  {isAddon && (
                                    <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500/25 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                      ⚡ ADD-ON
                                    </span>
                                  )}
                                </span>
                                <span className={`font-mono ${isAddon ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-muted-foreground'}`}>
                                  ₹{Number(item.subtotal || (item.unitPrice * item.quantity) || 0).toFixed(0)}
                                </span>
                              </div>
                            );
                          })}
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
                  <div className="p-4 border-t border-border bg-muted/30 flex gap-3">
                    <button
                      disabled={isAcceptingOrder}
                      onClick={async () => {
                        if (isAcceptingOrder) return;
                        setIsAcceptingOrder(true);
                        const currentOrder = { ...activeNewOrderAlert };
                        const orderId = currentOrder.id || (currentOrder as any)?.orderId;
                        const isAddon = Boolean(currentOrder.isNewAddon || currentOrder.isAddon || currentOrder.addOnStatus === 'PENDING');
                        const patchPayload = isAddon ? { addOnStatus: 'CONFIRMED' } : { status: 'CONFIRMED' };

                        // Close modal immediately on this device
                        setActiveNewOrderAlert(null);
                        useWaiterStore.getState().setActiveNewOrderAlert(null);
                        useWaiterStore.getState().removeNewOrder(orderId);

                        try {
                          const res = await api.patch(`/owner/orders/${orderId}/status`, patchPayload);
                          queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
                          queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
                          if (res.data?.alreadyProcessed) {
                            toast.info('Order was already accepted on another device.');
                          } else {
                            const returnedOrder = res.data?.data?.order;
                            const orderToPrint = {
                              ...currentOrder,
                              ...(returnedOrder || {}),
                              items: (currentOrder.items && currentOrder.items.length > 0)
                                ? currentOrder.items
                                : (returnedOrder?.items || []),
                            };
                            printKitchenOrderTicket({
                              order: orderToPrint,
                              restaurantName: restaurantData?.name || 'Restaurant',
                              isAddonOnly: isAddon,
                            });
                            toast.success(isAddon ? 'Add-on accepted!' : 'Order accepted!');
                          }
                        } catch (err: any) {
                          toast.error(err?.response?.data?.message || 'Failed to accept order');
                        } finally {
                          setIsAcceptingOrder(false);
                        }
                      }}
                      className="flex-1 py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      {isAcceptingOrder ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                      <span>{activeNewOrderAlert.isNewAddon || activeNewOrderAlert.isAddon ? 'Accept Add-on' : 'Accept Order'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejectOrderTarget(activeNewOrderAlert);
                        setSelectedRejectReason(PREDEFINED_REJECTION_REASONS[0]);
                        setCustomRejectReason('');
                      }}
                      className="flex-1 py-3 px-4 rounded-xl bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-950/40 dark:text-red-400 dark:hover:bg-red-900/50 font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                    >
                      <X className="w-4 h-4" />
                      <span>{activeNewOrderAlert.isNewAddon || activeNewOrderAlert.isAddon || activeNewOrderAlert.addOnStatus === 'PENDING' ? 'Reject Add-on' : 'Reject Order'}</span>
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
        </AnimatePresence>,
        document.body
      )}

      {/* Polite Rejection Modal with Predefined Reasons (Portalled to document.body) */}
      {mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {rejectOrderTarget && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs pointer-events-auto"
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="bg-card border-2 border-red-500/40 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden text-card-foreground"
              >
                {/* Header */}
                <div className="bg-gradient-to-r from-red-600 to-rose-600 p-5 text-white flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-white/20 flex items-center justify-center">
                      <AlertTriangle className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-display font-extrabold text-lg leading-tight">
                        {rejectOrderTarget.isNewAddon || rejectOrderTarget.isAddon || rejectOrderTarget.addOnStatus === 'PENDING' ? 'Reject Add-on Request' : 'Reject Order'}
                      </h3>
                      <p className="text-xs text-white/80">
                        Order #{rejectOrderTarget.id ? String(rejectOrderTarget.id).slice(-8).toUpperCase() : 'NEW'}
                        {rejectOrderTarget.tableNumber ? ` • ${formatTableLabel(rejectOrderTarget.tableNumber)}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setRejectOrderTarget(null)}
                    className="p-1.5 rounded-full hover:bg-white/20 transition-colors cursor-pointer"
                  >
                    <X className="w-5 h-5 text-white" />
                  </button>
                </div>

                {/* Body: Predefined polite reasons */}
                <div className="p-5 space-y-3.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Select a polite reason to inform the customer:
                  </p>
                  <div className="space-y-2">
                    {PREDEFINED_REJECTION_REASONS.map((reason) => {
                      const isSelected = selectedRejectReason === reason;
                      return (
                        <label
                          key={reason}
                          className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                            isSelected
                              ? 'border-red-500 bg-red-50/60 dark:bg-red-950/25 text-foreground font-semibold'
                              : 'border-border hover:bg-muted/50 text-muted-foreground'
                          }`}
                        >
                          <input
                            type="radio"
                            name="rejectReason"
                            value={reason}
                            checked={isSelected}
                            onChange={() => setSelectedRejectReason(reason)}
                            className="mt-0.5 text-red-600 focus:ring-red-500"
                          />
                          <span className="leading-relaxed">{reason}</span>
                        </label>
                      );
                    })}
                  </div>

                  {selectedRejectReason === 'Other / Custom reason' && (
                    <div className="pt-1">
                      <textarea
                        value={customRejectReason}
                        onChange={(e) => setCustomRejectReason(e.target.value)}
                        placeholder="Type a polite reason for the customer..."
                        rows={2}
                        className="w-full p-2.5 text-xs rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-red-500/20 resize-none"
                      />
                    </div>
                  )}
                </div>

                {/* Footer Buttons */}
                <div className="p-4 border-t border-border bg-muted/20 flex gap-2.5">
                  <button
                    type="button"
                    onClick={() => setRejectOrderTarget(null)}
                    className="flex-1 py-2.5 px-4 rounded-xl border border-border font-semibold text-xs hover:bg-muted transition-colors text-foreground text-center cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    disabled={isRejecting}
                    onClick={async () => {
                      if (isRejecting) return;
                      setIsRejecting(true);
                      const finalReason = selectedRejectReason === 'Other / Custom reason'
                        ? (customRejectReason.trim() || 'Order could not be accepted at this time.')
                        : selectedRejectReason;
                      const orderId = rejectOrderTarget.id || rejectOrderTarget.orderId;
                      const isAddon = Boolean(rejectOrderTarget.isNewAddon || rejectOrderTarget.isAddon || rejectOrderTarget.addOnStatus === 'PENDING');
                      const patchPayload = isAddon
                        ? { addOnStatus: 'CANCELLED', reason: finalReason }
                        : { status: 'CANCELLED', reason: finalReason };

                      // Close modals immediately
                      setActiveNewOrderAlert(null);
                      useWaiterStore.getState().setActiveNewOrderAlert(null);
                      useWaiterStore.getState().removeNewOrder(orderId);
                      setRejectOrderTarget(null);

                      try {
                        await api.patch(`/owner/orders/${orderId}/status`, patchPayload);
                        queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
                        queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
                        toast.success(isAddon ? 'Add-on rejected & customer notified' : 'Order rejected & customer notified');
                      } catch {
                        toast.error('Failed to reject order');
                      } finally {
                        setIsRejecting(false);
                      }
                    }}
                    className="flex-1 py-2.5 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isRejecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    <span>Confirm Rejection</span>
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Global General Notification Alert Modal (Portalled to document.body) */}
      {mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {activeGeneralNotificationAlert && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs pointer-events-auto"
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
        </AnimatePresence>,
        document.body
      )}

      {isCurrentTabDisabled ? (
        <div className="flex h-screen bg-background overflow-hidden">
          <OwnerSidebar />
          <main className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-muted/10">
            <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mb-4 shadow-lg animate-bounce">
              <Lock className="w-8 h-8" />
            </div>
            <h2 className="text-xl font-display font-extrabold text-foreground mb-2">
              "{currentTab?.label}" is Currently Disabled
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
              Access to the <strong>{currentTab?.label}</strong> management tab has been temporarily disabled by platform administration for your restaurant.
            </p>
            <Link
              href="/owner/dashboard"
              className="px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold shadow-md hover:bg-primary/95 transition-all"
            >
              Return to Dashboard
            </Link>
          </main>
        </div>
      ) : (
        children
      )}
    </div>
  );
}
