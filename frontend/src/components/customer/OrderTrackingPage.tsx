'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Send,
  Plus,
  Bell,
  Droplets,
  Receipt,
  Sparkles,
  UtensilsCrossed,
  ShoppingBag,
  MoreHorizontal,
  CheckCircle2,
  Clock,
  XCircle,
  HelpCircle,
  Phone,
  MapPin,
  X,
  FileText,
  Star,
  Check,
} from 'lucide-react';
import { getImageUrl } from '@/lib/image';
import { io, Socket } from 'socket.io-client';
import api, { getSocketUrl } from '@/services/api';
import { useAuthStore } from '@/store/auth.store';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { InvoiceDownload } from './InvoiceDownload';
import { QuickServiceModal, QuickServiceType } from './QuickServiceModal';
import { playNewOrderSound, processRealTimeEvent } from '@/utils/audio';
import { applyThemeColor } from '@/utils/theme';

// ─── Interfaces ─────────────────────────────────────────────────────────────

interface OrderItem {
  id: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  isAddon?: boolean;
  notes?: string;
  addOns?: any;
  menuItem?: {
    name: string;
    image?: string | null;
  };
  variant?: {
    name: string;
  } | null;
}

interface Order {
  id: string;
  restaurantId: string;
  status: string; // PENDING, CONFIRMED, DELIVERED, CANCELLED
  addOnStatus?: string | null;
  subtotal: number;
  gstAmount: number;
  deliveryFee: number;
  packagingFee: number;
  discount: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  verificationCode?: string | null;
  tableNumber: string | null;
  batchNumber?: number | null;
  createdAt: string;
  restaurant: {
    name: string;
    logo: string | null;
    themeColor: string | null;
    phone: string | null;
    address?: string | null;
    city?: string | null;
  };
  items: OrderItem[];
  tableSession?: {
    id: string;
    sessionCode: string;
    tableAccessCode?: string | null;
    totalAmount?: number;
    paidAmount?: number;
    status: string;
  } | null;
}

interface OrderTrackingPageProps {
  orderId: string;
  restaurantSlug: string;
}

export function OrderTrackingPage({ orderId, restaurantSlug }: OrderTrackingPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [mounted, setMounted] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string>('PENDING');
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [activeServiceModal, setActiveServiceModal] = useState<QuickServiceType | null>(null);
  const [showBillModal, setShowBillModal] = useState(false);
  const [showMoreModal, setShowMoreModal] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // ── Fetch Order ───────────────────────────────────────────────────────────
  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const res = await api.get(`/orders/${orderId}`, { skipToast: true });
      return res.data?.data?.order as Order;
    },
    enabled: mounted && !!orderId,
    refetchInterval: 12000,
  });

  // ── Synchronize dynamic restaurant theme color across UI ────────────────
  const themeColor = order?.restaurant?.themeColor;
  useEffect(() => {
    if (themeColor) {
      applyThemeColor(themeColor);
      if (typeof window !== 'undefined' && restaurantSlug) {
        localStorage.setItem(`restaurant_theme_${restaurantSlug}`, themeColor);
      }
    } else if (typeof window !== 'undefined' && restaurantSlug) {
      const cached = localStorage.getItem(`restaurant_theme_${restaurantSlug}`);
      if (cached) {
        applyThemeColor(cached);
      }
    }
  }, [themeColor, restaurantSlug]);

  // Keep local status synchronized
  const lastNotifiedStatusRef = useRef<string | null>(null);
  const lastNotifiedAddOnStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (order?.status) {
      setCurrentStatus(order.status);
      if (!lastNotifiedStatusRef.current) {
        lastNotifiedStatusRef.current = order.status;
      }
    }
    if (order?.addOnStatus) {
      if (!lastNotifiedAddOnStatusRef.current) {
        lastNotifiedAddOnStatusRef.current = order.addOnStatus;
      }
    }
  }, [order?.status, order?.addOnStatus]);

  // Persist session order storage for companions & add-ons
  useEffect(() => {
    if (orderId && typeof window !== 'undefined') {
      localStorage.setItem('active_table_order_id', orderId);
      localStorage.setItem(`active_table_order_id_${restaurantSlug}`, orderId);
      sessionStorage.setItem('qr_restaurant_addon_order_id', orderId);
      if (order?.id) {
        sessionStorage.setItem('qr_restaurant_addon_order_num', order.id.slice(-8).toUpperCase());
      }
    }
  }, [orderId, order?.id, restaurantSlug]);

  // ── Socket.IO Real-Time Order & Acceptance Listeners ──────────────────────
  useEffect(() => {
    if (!orderId) return;

    const socket: Socket = io(getSocketUrl(), {
      transports: ['polling', 'websocket'],
      withCredentials: true,
    });

    socket.emit('join:order', orderId);

    const handleStatusUpdate = (data: {
      orderId: string;
      status?: string;
      addOnStatus?: string | null;
      paymentStatus?: string;
      reason?: string;
    }) => {
      if (data.orderId === orderId) {
        if (data.reason) {
          setCancelReason(data.reason);
        }
        processRealTimeEvent('order_status_changed', () => {
          if (data.addOnStatus && data.addOnStatus !== lastNotifiedAddOnStatusRef.current) {
            lastNotifiedAddOnStatusRef.current = data.addOnStatus;
            if (data.addOnStatus === 'CONFIRMED') {
              playNewOrderSound();
              toast.success('🎉 Add-on Accepted! Your items are now being prepared.');
            } else if (data.addOnStatus === 'CANCELLED') {
              toast.error(data.reason ? `Add-on Rejected: ${data.reason}` : 'Add-on request could not be accepted by the counter.');
            }
          }

          if (data.status) {
            setCurrentStatus(data.status);
            if (data.status !== lastNotifiedStatusRef.current) {
              lastNotifiedStatusRef.current = data.status;
              if (data.status === 'CONFIRMED' && !data.addOnStatus) {
                playNewOrderSound();
                toast.success('🎉 Order Accepted! Your food is now being prepared.');
              } else if (data.status === 'CANCELLED') {
                toast.error(`Order Not Accepted${data.reason ? `: ${data.reason}` : ''}`);
              } else if (data.status === 'DELIVERED') {
                toast.success('🍽️ Your food has been served. Enjoy your meal!');
              }
            }
          }
        });
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      }
    };

    socket.on('order:status_updated', handleStatusUpdate);
    socket.on('order_status_changed', handleStatusUpdate);

    socket.on('order_cancelled', (data: any) => {
      if (data?.orderId === orderId) {
        setCurrentStatus('CANCELLED');
        if (data.reason) {
          setCancelReason(data.reason);
        }
        toast.error(`Order Not Accepted${data.reason ? `: ${data.reason}` : ''}`);
        queryClient.invalidateQueries({ queryKey: ['order', orderId] });
      }
    });

    socket.on('table-session:updated', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    });

    return () => {
      socket.disconnect();
    };
  }, [orderId, queryClient]);

  // Auto-redirect to menu when order is cancelled
  useEffect(() => {
    if (currentStatus === 'CANCELLED' || order?.status === 'CANCELLED') {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('active_table_order_id');
        localStorage.removeItem(`active_table_order_id_${restaurantSlug}`);
        sessionStorage.removeItem('qr_restaurant_addon_order_id');
        sessionStorage.removeItem('qr_restaurant_addon_order_num');
      }
      const timer = setTimeout(() => {
        router.push(`/r/${restaurantSlug}`);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [currentStatus, order?.status, restaurantSlug, router]);

  // ── Add More Items Handler ────────────────────────────────────────────────
  const handleAddMoreItems = () => {
    if (!order) return;
    sessionStorage.setItem('qr_restaurant_addon_order_id', orderId);
    sessionStorage.setItem('qr_restaurant_addon_order_num', order.id.slice(-8).toUpperCase());
    if (typeof window !== 'undefined') {
      localStorage.setItem('active_table_order_id', orderId);
      localStorage.setItem(`active_table_order_id_${restaurantSlug}`, orderId);
    }
    router.push(`/r/${restaurantSlug}`);
  };

  const cleanTableNumber = useMemo(() => {
    if (!order?.tableNumber) return 'Table 01';
    const raw = order.tableNumber.trim();
    if (raw.toLowerCase().includes('room') || raw.toLowerCase().includes('suite')) {
      return raw.toLowerCase().startsWith('room') ? raw : `Room ${raw}`;
    }
    return raw.toLowerCase().startsWith('table') ? raw : `Table ${raw}`;
  }, [order?.tableNumber]);

  // Loading Skeleton
  if (isLoading || !mounted) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col justify-between max-w-md mx-auto p-4 animate-pulse">
        <div className="space-y-4 pt-4">
          <div className="h-14 bg-neutral-200 dark:bg-neutral-800 rounded-2xl" />
          <div className="h-56 bg-blue-100 dark:bg-blue-950/40 rounded-3xl" />
          <div className="h-64 bg-white dark:bg-neutral-900 rounded-3xl" />
        </div>
      </div>
    );
  }

  // Error State
  if (isError || !order) {
    return (
      <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950 flex flex-col items-center justify-center p-6 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mb-4">
          <XCircle className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-neutral-900 dark:text-white mb-2">Order Not Found</h2>
        <p className="text-sm text-neutral-500 mb-6">We could not locate this order. Please scan the table QR code again.</p>
        <Link
          href={`/r/${restaurantSlug}`}
          className="px-6 py-3 rounded-2xl bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-sm shadow-md transition-all"
        >
          Back to Menu
        </Link>
      </div>
    );
  }

  const isAddonPending = order?.addOnStatus === 'PENDING';
  const isPending = currentStatus === 'PENDING' || isAddonPending;
  const isAccepted = !isAddonPending && (currentStatus === 'CONFIRMED' || currentStatus === 'PREPARING' || currentStatus === 'BAKING' || currentStatus === 'READY');
  const isRejected = currentStatus === 'CANCELLED';
  const isDelivered = !isAddonPending && currentStatus === 'DELIVERED';

  return (
    <div className="min-h-screen bg-[#F8F9FA] dark:bg-neutral-950 flex flex-col justify-between max-w-md mx-auto relative pb-28 selection:bg-primary/20">
      {/* ── 1. HEADER (Logo, Restaurant Name, Table Badge) ───────────────────── */}
      <header className="px-5 pt-4 pb-3 flex items-center justify-between sticky top-0 z-30 bg-[#F8F9FA]/90 dark:bg-neutral-950/90 backdrop-blur-md">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-full overflow-hidden bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xs flex items-center justify-center shrink-0">
            {order.restaurant?.logo ? (
              <img
                src={getImageUrl(order.restaurant.logo)}
                alt={order.restaurant.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <UtensilsCrossed className="w-5 h-5 text-primary" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="font-extrabold text-base text-neutral-900 dark:text-white tracking-tight truncate max-w-[170px] sm:max-w-[200px]">
              {order.restaurant?.name || 'Restaurant'}
            </h1>
            <p className="text-[11px] font-semibold text-neutral-500 dark:text-neutral-400 truncate">
              {order.restaurant?.city || 'Dine-in Order'}
            </p>
          </div>
        </div>

        {/* Rounded Table Number Badge */}
        <div className="shrink-0 px-3 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200/80 dark:border-neutral-800 shadow-2xs">
          <span className="text-xs font-black text-primary uppercase tracking-wide">
            {cleanTableNumber}
          </span>
        </div>
      </header>

      {/* Main Body Content */}
      <main className="px-5 space-y-4 pt-1 flex-1">
        {/* ── 2. LARGE LIGHT-BLUE CONFIRMATION CARD ──────────────────────────── */}
        <div
          className={`rounded-3xl p-6 sm:p-7 text-center transition-all border shadow-xs ${
            isRejected
              ? 'bg-red-50 dark:bg-red-950/30 border-red-200/80 dark:border-red-900/40 text-red-950 dark:text-red-200'
              : 'bg-[#EBF5FB] dark:bg-blue-950/30 border-[#D4E6F1] dark:border-blue-900/40 text-neutral-900 dark:text-white'
          }`}
        >
          {/* Centered Circular Icon Container */}
          <div className="w-16 h-16 rounded-full bg-white dark:bg-neutral-900 shadow-sm flex items-center justify-center mx-auto mb-4 border border-blue-100 dark:border-blue-900/60">
            {isRejected ? (
              <XCircle className="w-8 h-8 text-red-500" />
            ) : isAccepted ? (
              <Check className="w-8 h-8 text-[#1E88E5]" />
            ) : (
              <Send className="w-7 h-7 text-[#1E88E5] translate-x-0.5 -translate-y-0.5" />
            )}
          </div>

          {/* Heading */}
          <h2 className="font-extrabold text-base sm:text-lg leading-snug mb-1.5 px-2">
            {isAddonPending && 'Add-on Order Submitted! Wait for Confirmation'}
            {!isAddonPending && isPending && 'Your order has been sent to the restaurant for confirmation.'}
            {isAccepted && 'Order Accepted!'}
            {isRejected && 'Order Not Accepted'}
            {isDelivered && 'Order Served & Completed!'}
          </h2>

          {/* Supporting Message */}
          <div className="text-xs text-neutral-600 dark:text-neutral-300 font-medium leading-relaxed max-w-xs mx-auto space-y-2">
            {isAddonPending && <p>Your add-on request has been sent to the counter. The staff will accept and print your KOT shortly.</p>}
            {!isAddonPending && isPending && <p>We'll notify you once it is accepted or if there is any issue.</p>}
            {isAccepted && <p>Your order has been accepted and sent to the kitchen.</p>}
            {isRejected && (
              <div className="space-y-2.5">
                {cancelReason ? (
                  <div className="font-semibold text-rose-600 dark:text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5 text-xs">
                    Reason: {cancelReason}
                  </div>
                ) : (
                  <p>The restaurant could not accept your order at this moment.</p>
                )}
                <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                  Redirecting back to the menu in a few seconds...
                </p>
                <div>
                  <Link
                    href={`/r/${restaurantSlug}`}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-xs font-bold shadow-xs hover:opacity-90 transition-opacity"
                  >
                    <UtensilsCrossed className="w-3.5 h-3.5" /> Return to Menu Now
                  </Link>
                </div>
              </div>
            )}
            {isDelivered && <p>Your food has been served. Enjoy your meal!</p>}
          </div>

          {/* Verification Code pill if counter verification is active */}
          {order.verificationCode && (
            <div className="mt-3.5 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/80 dark:bg-neutral-900/80 border border-primary/20 text-[11px] font-bold text-neutral-700 dark:text-neutral-300">
              <span>Code:</span>
              <span className="font-mono text-primary font-black">
                #{order.verificationCode}
              </span>
            </div>
          )}
        </div>

        {/* ── 3. ORDER DETAILS CARD (White, rounded, subtle shadow) ─────────── */}
        <div className="bg-white dark:bg-neutral-900 rounded-3xl p-5 shadow-xs border border-neutral-200/60 dark:border-neutral-800 space-y-3.5">
          {/* Header Row: Order Details Title & Order Number Badge */}
          <div className="flex items-center justify-between pb-1">
            <h3 className="font-extrabold text-sm text-neutral-900 dark:text-white">
              Order Details
            </h3>
            <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700">
              #{order.id.slice(-6).toUpperCase()}
            </span>
          </div>

          {/* Item Breakdown */}
          <div className="space-y-3 pt-1">
            {order.items.map((item, idx) => {
              const itemName = item.menuItem?.name || 'Dish Item';
              const variantName = item.variant?.name ? `(${item.variant.name})` : '';

              return (
                <div key={item.id || idx} className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Item Thumbnail */}
                    <div className="w-12 h-12 rounded-2xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 border border-neutral-200/60 dark:border-neutral-700/60 shrink-0 flex items-center justify-center">
                      {item.menuItem?.image ? (
                        <img
                          src={getImageUrl(item.menuItem.image)}
                          alt={itemName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <UtensilsCrossed className="w-5 h-5 text-neutral-400" />
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="font-bold text-xs text-neutral-900 dark:text-white truncate">
                        {itemName} {variantName}
                        {item.isAddon && (
                          <span className="ml-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                            Add-on
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400 font-medium">
                        Qty: {item.quantity} × ₹{item.unitPrice}
                      </p>
                    </div>
                  </div>

                  <span className="font-extrabold text-xs text-neutral-900 dark:text-white shrink-0">
                    ₹{item.subtotal.toFixed(2)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Clean Horizontal Divider */}
          <div className="border-t border-neutral-100 dark:border-neutral-800 pt-3">
            <div className="flex items-center justify-between font-extrabold text-sm text-neutral-900 dark:text-white">
              <span>Order Total</span>
              <span className="text-base font-black text-neutral-900 dark:text-white">
                ₹{order.total.toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* ── 4. ADD MORE ITEMS BUTTON (Theme outline, plus icon, full width) ── */}
        <button
          type="button"
          onClick={handleAddMoreItems}
          className="w-full py-3.5 px-4 rounded-2xl border-2 border-primary text-primary hover:bg-primary/10 active:scale-98 font-extrabold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-2xs"
        >
          <Plus className="w-4 h-4 text-primary" />
          <span>+ Add More Items</span>
        </button>

        {/* ── 5. FOUR QUICK SERVICE BUTTONS (Exactly 1 horizontal row) ───────── */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          {/* 1. Call Waiter */}
          <button
            type="button"
            onClick={() => setActiveServiceModal('GENERAL_ASSISTANCE')}
            className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-800 shadow-2xs hover:border-primary transition-all cursor-pointer active:scale-95 group text-center"
          >
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <Bell className="w-4 h-4" />
            </div>
            <span className="text-[10.5px] font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
              Call Waiter
            </span>
          </button>

          {/* 2. Request Water */}
          <button
            type="button"
            onClick={() => setActiveServiceModal('WATER')}
            className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-800 shadow-2xs hover:border-primary transition-all cursor-pointer active:scale-95 group text-center"
          >
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <Droplets className="w-4 h-4" />
            </div>
            <span className="text-[10.5px] font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
              Request Water
            </span>
          </button>

          {/* 3. Request Bill */}
          <button
            type="button"
            onClick={() => setActiveServiceModal('BILL')}
            className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-800 shadow-2xs hover:border-primary transition-all cursor-pointer active:scale-95 group text-center"
          >
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <Receipt className="w-4 h-4" />
            </div>
            <span className="text-[10.5px] font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
              Request Bill
            </span>
          </button>

          {/* 4. Table Cleaning */}
          <button
            type="button"
            onClick={() => setActiveServiceModal('CLEANING')}
            className="flex flex-col items-center justify-center p-2.5 rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200/70 dark:border-neutral-800 shadow-2xs hover:border-primary transition-all cursor-pointer active:scale-95 group text-center"
          >
            <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="text-[10.5px] font-bold text-neutral-800 dark:text-neutral-200 leading-tight">
              Table Cleaning
            </span>
          </button>
        </div>
      </main>

      {/* ── 6. BOTTOM NAVIGATION (Menu | Order | Bill | More) ───────────────── */}
      <nav className="fixed bottom-0 inset-x-0 max-w-md mx-auto z-40 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-md border-t border-neutral-200/80 dark:border-neutral-800 pb-safe shadow-lg">
        <div className="grid grid-cols-4 h-16 items-center px-2">
          {/* 1. Menu */}
          <Link
            href={`/r/${restaurantSlug}`}
            className="flex flex-col items-center justify-center gap-1 text-neutral-400 hover:text-primary transition-colors"
          >
            <UtensilsCrossed className="w-5 h-5" />
            <span className="text-[11px] font-semibold">Menu</span>
          </Link>

          {/* 2. Order (Selected Tab with Theme Indicator) */}
          <div className="flex flex-col items-center justify-center gap-1 text-primary relative">
            <ShoppingBag className="w-5 h-5" />
            <span className="text-[11px] font-bold">Order</span>
            {/* Selected theme indicator dot */}
            <span className="w-1.5 h-1.5 rounded-full bg-primary absolute -top-1" />
          </div>

          {/* 3. Bill */}
          <button
            type="button"
            onClick={() => setShowBillModal(true)}
            className="flex flex-col items-center justify-center gap-1 text-neutral-400 hover:text-primary transition-colors cursor-pointer"
          >
            <Receipt className="w-5 h-5" />
            <span className="text-[11px] font-semibold">Bill</span>
          </button>

          {/* 4. More */}
          <button
            type="button"
            onClick={() => setShowMoreModal(true)}
            className="flex flex-col items-center justify-center gap-1 text-neutral-400 hover:text-primary transition-colors cursor-pointer"
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[11px] font-semibold">More</span>
          </button>
        </div>
      </nav>

      {/* ── QUICK SERVICE MODAL (For the 4 Service Buttons) ─────────────────── */}
      <QuickServiceModal
        isOpen={Boolean(activeServiceModal)}
        onClose={() => setActiveServiceModal(null)}
        serviceType={activeServiceModal}
        tableNumber={order.tableNumber || '1'}
        restaurantSlug={restaurantSlug}
        restaurantId={order.restaurantId}
        themeColor={order.restaurant?.themeColor}
      />

      {/* ── BILL MODAL / RUNNING BILL OVERVIEW ──────────────────────────────── */}
      <AnimatePresence>
        {showBillModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              className="w-full sm:max-w-md bg-white dark:bg-neutral-900 border-t sm:border border-neutral-200 dark:border-neutral-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col space-y-4 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Receipt className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-neutral-900 dark:text-white">
                      Running Bill Summary
                    </h3>
                    <p className="text-xs text-neutral-500">{cleanTableNumber}</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowBillModal(false)}
                  className="p-1 rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-2xl border border-neutral-200/60 dark:border-neutral-700/60 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Subtotal:</span>
                  <span className="font-bold">₹{order.subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">GST Tax:</span>
                  <span className="font-bold">₹{order.gstAmount.toFixed(2)}</span>
                </div>
                {order.discount > 0 && (
                  <div className="flex justify-between text-emerald-600">
                    <span>Discount:</span>
                    <span className="font-bold">-₹{order.discount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-extrabold pt-2 border-t border-neutral-200 dark:border-neutral-700">
                  <span>Payable Total:</span>
                  <span className="text-primary font-black">
                    ₹{order.total.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="p-3 bg-primary/10 border border-primary/20 rounded-2xl text-center">
                <p className="text-xs font-bold text-neutral-900 dark:text-white">
                  Please settle your bill at the restaurant counter.
                </p>
                <p className="text-[11px] text-primary mt-0.5 font-medium">
                  Counter accepts Cash, UPI, and Cards.
                </p>
              </div>

              {order.paymentStatus === 'PAID' && (
                <InvoiceDownload order={order as any} themeColor={order.restaurant?.themeColor || '#E85D04'} />
              )}

              <button
                type="button"
                onClick={() => setShowBillModal(false)}
                className="w-full py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-bold text-xs"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── MORE MODAL (Restaurant Info & Support) ─────────────────────────── */}
      <AnimatePresence>
        {showMoreModal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              className="w-full sm:max-w-md bg-white dark:bg-neutral-900 border-t sm:border border-neutral-200 dark:border-neutral-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
                <h3 className="font-extrabold text-base text-neutral-900 dark:text-white">
                  Restaurant Info & Assistance
                </h3>
                <button
                  onClick={() => setShowMoreModal(false)}
                  className="p-1 rounded-full text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2 text-xs">
                <p className="font-bold text-neutral-800 dark:text-neutral-200">
                  {order.restaurant?.name}
                </p>
                {order.restaurant?.address && (
                  <p className="text-neutral-500 flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-primary shrink-0" />
                    <span>{order.restaurant.address}</span>
                  </p>
                )}
                {order.restaurant?.phone && (
                  <p className="text-neutral-500 flex items-center gap-1.5">
                    <Phone className="w-4 h-4 text-primary shrink-0" />
                    <span>{order.restaurant.phone}</span>
                  </p>
                )}
              </div>

              {order.tableSession?.sessionCode && (
                <div className="p-3 bg-neutral-50 dark:bg-neutral-800/60 rounded-2xl border border-neutral-200/80 dark:border-neutral-700 text-center">
                  <p className="text-[11px] text-neutral-500 font-medium">Shared Dining Session Code:</p>
                  <p className="text-lg font-mono font-black text-primary">
                    #{order.tableSession.sessionCode}
                  </p>
                  <p className="text-[10px] text-neutral-400">Share with friends to join this table session.</p>
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowMoreModal(false)}
                className="w-full py-3 rounded-2xl bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-200 font-bold text-xs"
              >
                Close
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
