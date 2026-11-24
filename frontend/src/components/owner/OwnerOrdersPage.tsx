'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShoppingBag, UtensilsCrossed, LayoutDashboard, Tag, BarChart3, Settings, LogOut,
  Menu, Search, Clock, ChevronDown, RefreshCw, User, MapPin, Palette,
  Mail, Phone, CreditCard, Receipt, Check, Wallet, Banknote, Sparkles, Star, AlertTriangle, ChefHat, Trash2, Utensils, Printer, FileText
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api, { getSocketUrl } from '@/services/api';
import { io, Socket } from 'socket.io-client';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { WaiterBell } from '@/components/owner/WaiterBell';
import { OwnerSidebar } from '@/components/owner/OwnerSidebar';
import { isItemAddon } from '@/utils/orderAddon';
import { CounterOrderVerification } from '@/components/owner/CounterOrderVerification';
import { printKitchenOrderTicket } from '@/utils/kotPrint';
import { printCustomerBill } from '@/utils/billPrint';
import { downloadInvoicePdf, downloadGstRegisterPdf, type InvoiceRestaurantInfo } from '@/utils/pdfInvoice';
import { ManualKotModal } from '@/components/owner/ManualKotModal';
import { PREDEFINED_REJECTION_REASONS } from '@/utils/orderRejection';
import { formatTableLabel } from '@/utils/tableCode';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { label: 'Coupons', icon: Tag, href: '/owner/coupons' },
  { label: 'Reviews', icon: Star, href: '/owner/reviews' },
  { label: 'Analytics', icon: BarChart3, href: '/owner/analytics' },
  { label: 'Customize', icon: Palette, href: '/owner/customize' },
  { label: 'Settings', icon: Settings, href: '/owner/settings' },
];

const ORDER_STATUSES = ['ALL', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  CONFIRMED: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  PREPARING: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  READY: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  DELIVERED: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  CANCELLED: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
};

type Order = {
  id: string;
  status: string;
  addOnStatus?: string | null;
  lastAddOnAt?: string | null;
  paymentMethod: string;
  paymentStatus: string;
  verificationCode?: string | null;
  counterPaymentMethod?: string | null;
  paymentConfirmedBy?: string | null;
  paymentConfirmedAt?: string | null;
  subtotal: number;
  gstAmount: number;
  deliveryFee: number;
  packagingFee: number;
  discount: number;
  total: number;
  addressId: string | null;
  tableNumber: string | null;
  guestName: string | null;
  guestPhone: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
  preparingAt: string | null;
  bakingAt: string | null;
  readyAt: string | null;
  onTheWayAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  user: { name: string; phone: string | null; email: string | null } | null;
  address: { flat: string; street: string; area: string; city: string; pincode: string } | null;
  items: Array<{
    id?: string;
    quantity: number;
    menuItem: { name: string; image?: string | null };
    subtotal: number;
    unitPrice: number;
    addOns?: any;
    isAddon?: boolean;
    isServed?: boolean;
    servedAt?: string | null;
    createdAt?: string;
  }>;
};

const formatTime = (timeStr: string | null | undefined) => {
  if (!timeStr) return 'Pending';
  const date = new Date(timeStr);
  if (isNaN(date.getTime())) return 'Pending';
  return date.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const formatAmount = (val: number | null | undefined) => {
  const num = Number(val) || 0;
  return num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
};

export function getOrderPaymentMode(order: Order): 'CASH' | 'UPI' | 'CARD' | 'ONLINE' | 'WALLET' | 'PENDING' {
  if (order.paymentStatus !== 'PAID') return 'PENDING';
  const cMethod = (order.counterPaymentMethod || '').toUpperCase();
  const pMethod = (order.paymentMethod || '').toUpperCase();

  if (cMethod === 'UPI' || cMethod === 'COUNTER_UPI' || pMethod === 'UPI_INTENT') return 'UPI';
  if (cMethod === 'CARD') return 'CARD';
  if (pMethod === 'RAZORPAY') return 'ONLINE';
  if (pMethod === 'WALLET') return 'WALLET';
  return 'CASH';
}

export function OwnerOrdersPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'orders' | 'counter'>('orders');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [paymentModeFilter, setPaymentModeFilter] = useState<'ALL' | 'CASH' | 'UPI' | 'CARD' | 'ONLINE' | 'PENDING'>('ALL');
  const [editingPaymentOrderId, setEditingPaymentOrderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);
  const [showManualKotModal, setShowManualKotModal] = useState(false);
  const [rejectOrderTarget, setRejectOrderTarget] = useState<{ orderId: string; isAddon?: boolean } | null>(null);
  const [selectedRejectReason, setSelectedRejectReason] = useState<string>(PREDEFINED_REJECTION_REASONS[0]);
  const [customRejectReason, setCustomRejectReason] = useState<string>('');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['owner-orders', statusFilter, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '25', ...(statusFilter !== 'ALL' && { status: statusFilter }), ...(search && { search }) });
      const res = await api.get(`/owner/orders?${params}`);
      return res.data as {
        data: {
          orders: Order[];
          paymentSummary?: {
            totalPaid: number;
            paidCount: number;
            cash: { total: number; count: number };
            upi: { total: number; count: number };
            card: { total: number; count: number };
            online: { total: number; count: number };
            pending: { total: number; count: number };
          };
          restaurant?: any;
        };
        pagination: { total: number; totalPages: number };
      };
    },
    refetchInterval: 15000,
  });

  const rawOrders = data?.data.orders || [];

  const paymentSummary = useMemo(() => {
    if (data?.data.paymentSummary) return data.data.paymentSummary;
    let totalPaid = 0;
    let cashTotal = 0;
    let cashCount = 0;
    let upiTotal = 0;
    let upiCount = 0;
    let cardTotal = 0;
    let cardCount = 0;
    let onlineTotal = 0;
    let onlineCount = 0;
    let pendingTotal = 0;
    let pendingCount = 0;

    for (const o of rawOrders) {
      const tot = Number(o.total || 0);
      if (o.paymentStatus === 'PAID') {
        totalPaid += tot;
        const mode = getOrderPaymentMode(o);
        if (mode === 'UPI') {
          upiTotal += tot;
          upiCount++;
        } else if (mode === 'CARD') {
          cardTotal += tot;
          cardCount++;
        } else if (mode === 'ONLINE') {
          onlineTotal += tot;
          onlineCount++;
        } else {
          cashTotal += tot;
          cashCount++;
        }
      } else {
        pendingTotal += tot;
        pendingCount++;
      }
    }

    return {
      totalPaid,
      paidCount: cashCount + upiCount + cardCount + onlineCount,
      cash: { total: cashTotal, count: cashCount },
      upi: { total: upiTotal, count: upiCount },
      card: { total: cardTotal, count: cardCount },
      online: { total: onlineTotal, count: onlineCount },
      pending: { total: pendingTotal, count: pendingCount },
    };
  }, [data?.data.paymentSummary, rawOrders]);

  const displayedOrders = useMemo(() => {
    if (paymentModeFilter === 'ALL') return rawOrders;
    return rawOrders.filter((o) => {
      const mode = getOrderPaymentMode(o);
      if (paymentModeFilter === 'PENDING') return o.paymentStatus !== 'PAID';
      return mode === paymentModeFilter;
    });
  }, [rawOrders, paymentModeFilter]);

  const { data: restaurantData } = useQuery({
    queryKey: ['owner-restaurant-layout'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as {
        id: string;
        name?: string;
        legalBusinessName?: string;
        address?: string;
        city?: string;
        state?: string;
        pincode?: string;
        phone?: string;
        gstin?: string;
        fssaiNumber?: string;
        featureFlags?: {
          kotMode?: 'PRINT_KOT' | 'DISABLED' | string;
          kotEnabled?: boolean;
          [key: string]: any;
        };
      };
    },
  });

  const isPrintKotMode = Boolean(restaurantData?.featureFlags?.kotEnabled !== false && (restaurantData?.featureFlags as any)?.kotMode !== 'DISABLED');
  const restaurantName = restaurantData?.name || (data as any)?.data?.restaurant?.name || 'Restaurant';

  const currentRestaurantInfo: InvoiceRestaurantInfo = {
    name: restaurantName,
    legalBusinessName: restaurantData?.legalBusinessName || (data as any)?.data?.restaurant?.legalBusinessName,
    address: restaurantData?.address || (data as any)?.data?.restaurant?.address,
    city: restaurantData?.city || (data as any)?.data?.restaurant?.city,
    state: restaurantData?.state || (data as any)?.data?.restaurant?.state,
    pincode: restaurantData?.pincode || (data as any)?.data?.restaurant?.pincode,
    phone: restaurantData?.phone || (data as any)?.data?.restaurant?.phone,
    gstin: restaurantData?.gstin || (data as any)?.data?.restaurant?.gstin,
    fssaiNumber: restaurantData?.fssaiNumber || (data as any)?.data?.restaurant?.fssaiNumber,
  };

  const restId = restaurantData?.id || (data as any)?.data?.restaurant?.id;

  useEffect(() => {
    if (!restId) return;

    const socket: Socket = io(getSocketUrl(), {
      transports: ['polling', 'websocket'],
      reconnectionAttempts: 10,
    });

    const joinRest = () => {
      socket.emit('join:restaurant', restId);
    };

    if (socket.connected) {
      joinRest();
    }
    socket.on('connect', joinRest);

    const handleRefresh = () => {
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      qc.invalidateQueries({ queryKey: ['owner-recent-orders'] });
      qc.invalidateQueries({ queryKey: ['kitchen-orders'] });
    };

    socket.on('order:new', handleRefresh);
    socket.on('new_order', handleRefresh);
    socket.on('order:status_updated', handleRefresh);
    socket.on('order_status_changed', handleRefresh);
    socket.on('order_cancelled', handleRefresh);
    socket.on('order_deleted', handleRefresh);
    socket.on('order:dismiss_alert', handleRefresh);

    return () => {
      socket.disconnect();
    };
  }, [restId, qc]);

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, addOnStatus, reason }: { id: string; status?: string; addOnStatus?: string; reason?: string }) => {
      await api.patch(`/owner/orders/${id}/status`, { status, addOnStatus, reason });
    },
    onSuccess: () => {
      toast.success('Order status updated');
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      qc.invalidateQueries({ queryKey: ['owner-recent-orders'] });
      qc.invalidateQueries({ queryKey: ['kitchen-orders'] });
    },
    onError: () => toast.error('Failed to update order status'),
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async ({ id, instrument }: { id: string; instrument?: string }) => {
      await api.patch(`/owner/orders/${id}/payment`, { instrument: instrument || 'CASH' });
    },
    onSuccess: (_, vars) => {
      toast.success(`Payment confirmed via ${vars.instrument || 'Cash'}!`);
      setEditingPaymentOrderId(null);
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      qc.invalidateQueries({ queryKey: ['owner-recent-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-analytics'] });
    },
    onError: () => toast.error('Failed to update payment status'),
  });

  const rejectPaymentMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/owner/orders/${id}/payment-reject`);
    },
    onSuccess: () => {
      toast.warning('Customer notified: payment not received');
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      qc.invalidateQueries({ queryKey: ['owner-recent-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-analytics'] });
    },
    onError: () => toast.error('Failed to send payment notification'),
  });

  const deleteOrderMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/owner/orders/${id}`);
    },
    onSuccess: () => {
      toast.success('Order deleted successfully');
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      qc.invalidateQueries({ queryKey: ['owner-recent-orders'] });
      qc.invalidateQueries({ queryKey: ['kitchen-orders'] });
    },
    onError: () => toast.error('Failed to delete order'),
  });

  const clearHistoryMutation = useMutation({
    mutationFn: async () => {
      await api.delete(`/owner/orders/history/clear?status=${statusFilter}`);
    },
    onSuccess: (res: any) => {
      toast.success(res?.data?.message || 'Order history cleared');
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
      qc.invalidateQueries({ queryKey: ['owner-recent-orders'] });
      qc.invalidateQueries({ queryKey: ['kitchen-orders'] });
    },
    onError: () => toast.error('Failed to clear order history'),
  });

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally { logout(); router.push('/login'); }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <OwnerSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-3.5 sm:px-5 py-3 border-b border-border bg-background/95 backdrop-blur-sm gap-2 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 shrink">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-xl hover:bg-muted shrink-0">
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display font-bold text-base sm:text-xl truncate">Orders</h1>
            {data?.pagination.total !== undefined && (
              <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">({data.pagination.total} total)</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            {isPrintKotMode && (
              <button
                onClick={() => setShowManualKotModal(true)}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-xs flex items-center gap-1.5 shadow-sm transition-all cursor-pointer shrink-0"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>+ New Manual KOT</span>
              </button>
            )}
            <WaiterBell />
            <button onClick={() => refetch()} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground shrink-0">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Navigation Tabs: All Orders vs Counter Verification */}
        <div className="flex items-center gap-2 px-3.5 sm:px-5 pt-2 pb-0 border-b border-border bg-card/60 shrink-0">
          <button
            onClick={() => setActiveTab('orders')}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-1.5 ${activeTab === 'orders'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>All Orders</span>
          </button>
          <button
            onClick={() => setActiveTab('counter')}
            className={`pb-2.5 px-3 text-xs sm:text-sm font-bold border-b-2 transition-all flex items-center gap-1.5 ${activeTab === 'counter'
                ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
          >
            <Banknote className="w-4 h-4" />
            <span>Counter Order Verification</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-extrabold border border-emerald-500/20">
              New
            </span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {activeTab === 'counter' ? (
            <CounterOrderVerification />
          ) : (
            <>
              {/* ── Payment Collections by Mode Section ── */}
              <div className="bg-card border border-border rounded-2xl p-3.5 sm:p-4 space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                      <Banknote className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-xs sm:text-sm font-bold text-foreground">Payment Collections by Mode</h2>
                      <p className="text-[11px] text-muted-foreground">Click any mode to filter the orders below</p>
                    </div>
                  </div>
                  {paymentModeFilter !== 'ALL' && (
                    <button
                      onClick={() => setPaymentModeFilter('ALL')}
                      className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>Filtered: {paymentModeFilter}</span>
                      <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[10px]">✕ Clear Filter</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5">
                  {/* Total Paid */}
                  <button
                    onClick={() => setPaymentModeFilter('ALL')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentModeFilter === 'ALL'
                        ? 'bg-primary/5 border-primary ring-2 ring-primary/20 shadow-2xs'
                        : 'bg-background hover:bg-muted/40 border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between text-muted-foreground mb-1">
                      <span className="text-[10px] font-bold tracking-wider uppercase">Total Collected</span>
                      <span className="text-xs">💰</span>
                    </div>
                    <p className="font-extrabold text-sm sm:text-base text-foreground">₹{formatAmount(paymentSummary.totalPaid)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{paymentSummary.paidCount} paid orders</p>
                  </button>

                  {/* Cash */}
                  <button
                    onClick={() => setPaymentModeFilter(paymentModeFilter === 'CASH' ? 'ALL' : 'CASH')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentModeFilter === 'CASH'
                        ? 'bg-emerald-500/10 border-emerald-500 ring-2 ring-emerald-500/20 shadow-2xs'
                        : 'bg-background hover:bg-muted/40 border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 mb-1">
                      <span className="text-[10px] font-bold tracking-wider uppercase">Cash</span>
                      <span className="text-xs">💵</span>
                    </div>
                    <p className="font-extrabold text-sm sm:text-base text-emerald-600 dark:text-emerald-400">₹{formatAmount(paymentSummary.cash.total)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{paymentSummary.cash.count} orders</p>
                  </button>

                  {/* UPI */}
                  <button
                    onClick={() => setPaymentModeFilter(paymentModeFilter === 'UPI' ? 'ALL' : 'UPI')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentModeFilter === 'UPI'
                        ? 'bg-teal-500/10 border-teal-500 ring-2 ring-teal-500/20 shadow-2xs'
                        : 'bg-background hover:bg-muted/40 border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between text-teal-700 dark:text-teal-300 mb-1">
                      <span className="text-[10px] font-bold tracking-wider uppercase">UPI / QR</span>
                      <span className="text-xs">📱</span>
                    </div>
                    <p className="font-extrabold text-sm sm:text-base text-teal-600 dark:text-teal-400">₹{formatAmount(paymentSummary.upi.total)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{paymentSummary.upi.count} orders</p>
                  </button>

                  {/* Card */}
                  <button
                    onClick={() => setPaymentModeFilter(paymentModeFilter === 'CARD' ? 'ALL' : 'CARD')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentModeFilter === 'CARD'
                        ? 'bg-blue-500/10 border-blue-500 ring-2 ring-blue-500/20 shadow-2xs'
                        : 'bg-background hover:bg-muted/40 border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between text-blue-700 dark:text-blue-300 mb-1">
                      <span className="text-[10px] font-bold tracking-wider uppercase">Card</span>
                      <span className="text-xs">💳</span>
                    </div>
                    <p className="font-extrabold text-sm sm:text-base text-blue-600 dark:text-blue-400">₹{formatAmount(paymentSummary.card.total)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{paymentSummary.card.count} orders</p>
                  </button>

                  {/* Online */}
                  <button
                    onClick={() => setPaymentModeFilter(paymentModeFilter === 'ONLINE' ? 'ALL' : 'ONLINE')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentModeFilter === 'ONLINE'
                        ? 'bg-purple-500/10 border-purple-500 ring-2 ring-purple-500/20 shadow-2xs'
                        : 'bg-background hover:bg-muted/40 border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between text-purple-700 dark:text-purple-300 mb-1">
                      <span className="text-[10px] font-bold tracking-wider uppercase">Online</span>
                      <span className="text-xs">🌐</span>
                    </div>
                    <p className="font-extrabold text-sm sm:text-base text-purple-600 dark:text-purple-400">₹{formatAmount(paymentSummary.online.total)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{paymentSummary.online.count} orders</p>
                  </button>

                  {/* Unpaid */}
                  <button
                    onClick={() => setPaymentModeFilter(paymentModeFilter === 'PENDING' ? 'ALL' : 'PENDING')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      paymentModeFilter === 'PENDING'
                        ? 'bg-amber-500/10 border-amber-500 ring-2 ring-amber-500/20 shadow-2xs'
                        : 'bg-background hover:bg-muted/40 border-border'
                    }`}
                  >
                    <div className="flex items-center justify-between text-amber-700 dark:text-amber-400 mb-1">
                      <span className="text-[10px] font-bold tracking-wider uppercase">Unpaid</span>
                      <span className="text-xs">⏳</span>
                    </div>
                    <p className="font-extrabold text-sm sm:text-base text-amber-600 dark:text-amber-400">₹{formatAmount(paymentSummary.pending.total)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{paymentSummary.pending.count} orders</p>
                  </button>
                </div>
              </div>

              {/* Filters */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1 min-w-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder="Search order ID or customer..." className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div className="flex gap-2 items-center overflow-x-auto no-scrollbar pb-1 min-w-0 max-w-full">
                  {(isPrintKotMode
                    ? [
                        { key: 'ALL', label: 'All Orders' },
                        { key: 'PENDING', label: 'Pending (New)' },
                        { key: 'CONFIRMED', label: 'Sent to Kitchen' },
                        { key: 'CANCELLED', label: 'Cancelled' },
                      ]
                    : ORDER_STATUSES.map((s) => ({ key: s, label: s }))
                  ).map(({ key, label }) => (
                    <button key={key} onClick={() => { setStatusFilter(key); setPage(1); }}
                      className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-all ${statusFilter === key ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-card border border-border text-muted-foreground hover:bg-muted'}`}>
                      {label}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      if (confirm(`Are you sure you want to clear order history for status "${statusFilter}"? This will delete these order records.`)) {
                        clearHistoryMutation.mutate();
                      }
                    }}
                    disabled={clearHistoryMutation.isPending || !data?.data.orders.length}
                    className="flex items-center gap-1 px-3 py-2 bg-red-500/10 text-red-600 hover:bg-red-500/20 dark:bg-red-950/40 dark:hover:bg-red-950/60 dark:text-red-400 border border-red-200 dark:border-red-900/50 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
                    title="Delete completed/cancelled order history"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Clear History</span>
                  </button>
                  <button
                    onClick={() => {
                      if (!data?.data.orders.length) {
                        toast.error('No orders available to download.');
                        return;
                      }
                      downloadGstRegisterPdf(data.data.orders, currentRestaurantInfo);
                      toast.success(`Downloaded GST Bills PDF (${data.data.orders.length} orders)!`);
                    }}
                    disabled={!data?.data.orders.length}
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-all disabled:opacity-50 cursor-pointer shadow-sm"
                    title="Download official GST Tax Invoices & Sales Register in PDF format"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Download GST Bills (PDF)</span>
                  </button>
                </div>
              </div>

              {/* Orders */}
              {isLoading ? (
                <div className="space-y-3">{[1, 2, 3, 4].map(i => <div key={i} className="h-24 skeleton rounded-2xl" />)}</div>
              ) : (
                <div className="space-y-3">
                  {displayedOrders.map((order) => (
                    <motion.div key={order.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                      className="bg-card border border-border rounded-2xl overflow-hidden shadow-2xs">
                      <div className="flex items-center gap-3 sm:gap-4 p-3.5 sm:p-4 cursor-pointer hover:bg-muted/30 transition-colors flex-wrap sm:flex-nowrap"
                        onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-sm">#{order.id.slice(-8).toUpperCase()}</span>
                            {order.verificationCode && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-black bg-primary/10 text-primary border border-primary/20">
                                CODE #{order.verificationCode}
                              </span>
                            )}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[order.status] ?? ''}`}>
                              {isPrintKotMode
                                ? (order.status === 'CONFIRMED' ? 'SENT TO KITCHEN' : order.status === 'DELIVERED' ? 'COMPLETED' : order.status)
                                : order.status}
                            </span>
                            {order.tableNumber && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1 font-medium">
                                <MapPin className="w-3 h-3 text-primary" />
                                {formatTableLabel(order.tableNumber)}
                              </span>
                            )}

                            {/* Mode of Payment Badge */}
                            {(() => {
                              const mode = getOrderPaymentMode(order);
                              if (order.paymentStatus === 'PAID') {
                                if (mode === 'UPI') {
                                  return (
                                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-teal-500/10 text-teal-700 dark:text-teal-300 border border-teal-500/30 flex items-center gap-1">
                                      <span>📱</span> Paid via UPI
                                    </span>
                                  );
                                }
                                if (mode === 'CARD') {
                                  return (
                                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-500/30 flex items-center gap-1">
                                      <span>💳</span> Paid via Card
                                    </span>
                                  );
                                }
                                if (mode === 'ONLINE') {
                                  return (
                                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-purple-500/10 text-purple-700 dark:text-purple-300 border border-purple-500/30 flex items-center gap-1">
                                      <span>🌐</span> Paid Online
                                    </span>
                                  );
                                }
                                if (mode === 'WALLET') {
                                  return (
                                    <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                      <span>👛</span> Paid via Wallet
                                    </span>
                                  );
                                }
                                return (
                                  <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                                    <span>💵</span> Paid via Cash
                                  </span>
                                );
                              }
                              return (
                                <span className="text-[11px] px-2.5 py-0.5 rounded-full font-bold bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> Unpaid
                                </span>
                              );
                            })()}
                          </div>

                          <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5 truncate">
                            <User className="w-3 h-3 shrink-0" />
                            <span className="font-semibold text-foreground/80">{order.guestName ?? order.user?.name ?? 'Guest'}</span>
                            <span>•</span>
                            <span className="truncate">{order.items.map((i) => `${i.menuItem?.name || 'Item'} (x${i.quantity})`).join(', ')}</span>
                          </p>
                        </div>

                        <div className="text-right flex-shrink-0">
                          <p className="font-extrabold text-base text-foreground">₹{formatAmount(order.total)}</p>
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1 justify-end">
                            <Clock className="w-3 h-3" />
                            {formatTime(order.createdAt)}
                          </p>
                        </div>

                        {/* Quick 1-Click Pay Mode Buttons for Unpaid Orders */}
                        {order.paymentStatus !== 'PAID' && (
                          <div className="flex items-center gap-1 bg-muted/80 p-1 rounded-xl border border-border shrink-0" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10px] font-extrabold text-muted-foreground uppercase px-1 hidden md:inline">Mark Paid:</span>
                            <button
                              onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'CASH' })}
                              disabled={confirmPaymentMutation.isPending}
                              className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                              title="Mark Paid via Cash"
                            >
                              <span>💵 Cash</span>
                            </button>
                            <button
                              onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'UPI' })}
                              disabled={confirmPaymentMutation.isPending}
                              className="px-2 py-1 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                              title="Mark Paid via UPI (GPay/PhonePe/QR)"
                            >
                              <span>📱 UPI</span>
                            </button>
                            <button
                              onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'CARD' })}
                              disabled={confirmPaymentMutation.isPending}
                              className="px-2 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-2xs flex items-center gap-1 cursor-pointer"
                              title="Mark Paid via Card"
                            >
                              <span>💳 Card</span>
                            </button>
                          </div>
                        )}

                        {isPrintKotMode && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              printKitchenOrderTicket({ order, restaurantName });
                            }}
                            className="px-2.5 py-1.5 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/30 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
                            title="Print Kitchen Order Ticket (KOT)"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Print KOT</span>
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            printCustomerBill({ order, restaurant: currentRestaurantInfo });
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
                          title="Print Customer Tax Invoice / Bill (GST)"
                        >
                          <Receipt className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Print Bill</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadInvoicePdf(order, currentRestaurantInfo);
                            toast.success(`GST Tax Invoice PDF for #${order.id.slice(-8).toUpperCase()} downloaded!`);
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
                          title="Download Official GST Tax Invoice in PDF format"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">Download Bill (PDF)</span>
                          <span className="sm:hidden">PDF</span>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (confirm(`Are you sure you want to delete order #${order.id.slice(-8).toUpperCase()}?`)) {
                              deleteOrderMutation.mutate(order.id);
                            }
                          }}
                          disabled={deleteOrderMutation.isPending}
                          className="p-1.5 text-muted-foreground hover:text-red-600 hover:bg-red-500/10 rounded-lg transition-colors shrink-0"
                          title="Delete Order"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expandedOrder === order.id ? 'rotate-180' : ''}`} />
                      </div>

                      {expandedOrder === order.id && (
                        <div className="px-5 pb-5 border-t border-border pt-4 bg-muted/10">
                          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

                            {/* Left Column: Dishes Ordered & Compact Info */}
                            <div className="lg:col-span-7 space-y-4">
                              {/* Order Items List */}
                              {(() => {
                                const initialItems = order.items.filter((item) => !isItemAddon(item, order));
                                const addonItems = order.items.filter((item) => isItemAddon(item, order));
                                const hasAddons = addonItems.length > 0;

                                return (
                                  <div className="space-y-3">
                                    {/* Initial Items */}
                                    <div className="space-y-1.5">
                                      <div className="flex items-center justify-between">
                                        <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                          <Utensils className="w-3.5 h-3.5" />
                                          {hasAddons ? `Initial Items (${initialItems.length})` : 'Order Items'}
                                        </p>
                                        {hasAddons && (
                                          <span className="text-[11px] font-medium text-muted-foreground">
                                            Ordered {formatTime(order.createdAt)}
                                          </span>
                                        )}
                                      </div>
                                      <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border shadow-2xs">
                                        {initialItems.map((item, idx) => (
                                          <div key={idx} className="flex items-center justify-between p-3 text-sm">
                                            <div className="flex-1 min-w-0 pr-3">
                                              <p className="font-semibold text-foreground truncate">{item.menuItem.name}</p>
                                              <p className="text-xs text-muted-foreground mt-0.5">
                                                {item.quantity} × ₹{formatAmount(item.unitPrice || (item.subtotal / item.quantity))}
                                              </p>
                                              {item.addOns && Array.isArray(item.addOns) && item.addOns.length > 0 && (
                                                <div className="text-[11px] text-muted-foreground mt-0.5">
                                                  + {item.addOns.map((ao: any) => ao.name).join(', ')}
                                                </div>
                                              )}
                                            </div>
                                            <div className="text-right shrink-0">
                                              <span className="font-bold text-foreground">₹{formatAmount(item.subtotal)}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>

                                    {/* Add-on Items Section */}
                                    {hasAddons && (
                                      <div className="space-y-2 p-3.5 rounded-2xl bg-gradient-to-br from-amber-500/10 via-orange-500/5 to-transparent border-2 border-amber-500/30 dark:border-amber-500/25 shadow-xs">
                                        <div className="flex items-center justify-between flex-wrap gap-2">
                                          <div className="flex items-center gap-2">
                                            <span className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-500 flex items-center justify-center shrink-0">
                                              <Sparkles className="w-3.5 h-3.5" />
                                            </span>
                                            <div>
                                              <p className="font-black text-xs text-amber-600 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                                                ⚡ Add-on Items ({addonItems.length})
                                              </p>
                                              {order.lastAddOnAt && (
                                                <p className="text-[10px] text-muted-foreground font-medium">
                                                  Added {formatTime(order.lastAddOnAt)}
                                                </p>
                                              )}
                                            </div>
                                          </div>
                                          {order.addOnStatus && (
                                            <span className="text-[10px] px-2.5 py-0.5 rounded-full font-black uppercase tracking-wider bg-amber-500 text-slate-950 shadow-xs">
                                              {order.addOnStatus}
                                            </span>
                                          )}
                                        </div>

                                        <div className="bg-card/90 border border-amber-500/30 rounded-xl overflow-hidden divide-y divide-amber-500/15">
                                          {addonItems.map((item, idx) => (
                                            <div key={idx} className="flex items-center justify-between p-3 text-sm bg-amber-500/5">
                                              <div className="flex-1 min-w-0 pr-3">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                  <span className="font-bold text-foreground truncate">{item.menuItem.name}</span>
                                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider uppercase bg-amber-500/25 text-amber-600 dark:text-amber-300 border border-amber-500/40">
                                                    ⚡ ADD-ON
                                                  </span>
                                                </div>
                                                <p className="text-xs text-muted-foreground mt-0.5">
                                                  {item.quantity} × ₹{formatAmount(item.unitPrice || (item.subtotal / item.quantity))}
                                                </p>
                                                {item.addOns && Array.isArray(item.addOns) && item.addOns.length > 0 && (
                                                  <div className="text-[11px] text-muted-foreground mt-0.5">
                                                    + {item.addOns.map((ao: any) => ao.name).join(', ')}
                                                  </div>
                                                )}
                                              </div>
                                              <div className="text-right shrink-0">
                                                <span className="font-bold text-amber-600 dark:text-amber-400">
                                                  ₹{formatAmount(item.subtotal)}
                                                </span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Compact Customer & Dining Info Bar */}
                              <div className="bg-card border border-border px-3.5 py-2.5 rounded-xl flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
                                <div className="flex items-center gap-2">
                                  <User className="w-3.5 h-3.5 text-primary shrink-0" />
                                  <span className="font-bold text-foreground">{order.guestName ?? order.user?.name ?? 'Walk-in Guest'}</span>
                                  {(order.guestPhone || order.user?.phone) && (
                                    <a href={`tel:${order.guestPhone ?? order.user?.phone}`} className="hover:text-primary transition-colors font-medium">
                                      • {order.guestPhone ?? order.user?.phone}
                                    </a>
                                  )}
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="font-bold text-foreground flex items-center gap-1">
                                    <MapPin className="w-3.5 h-3.5 text-primary" />
                                    {order.tableNumber
                                      ? formatTableLabel(order.tableNumber)
                                      : 'Dine-In'}
                                  </span>
                                  <span className="text-[11px] flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> {formatTime(order.createdAt)}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Right Column: Receipt Summary & Payment & Settlement Hub */}
                            <div className="lg:col-span-5 space-y-4">
                              {/* Receipt Summary */}
                              <div className="bg-card border border-border p-4 rounded-xl space-y-3">
                                <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                  <Receipt className="w-3.5 h-3.5" /> Receipt Summary
                                </p>
                                <div className="space-y-2 text-xs text-muted-foreground">
                                  <div className="flex justify-between">
                                    <span>Subtotal</span>
                                    <span className="text-foreground font-medium">₹{formatAmount(order.subtotal)}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>GST ({process.env.NEXT_PUBLIC_GST_RATE ?? '5'}%)</span>
                                    <span className="text-foreground font-medium">₹{formatAmount(order.gstAmount)}</span>
                                  </div>
                                  {order.deliveryFee > 0 && (
                                    <div className="flex justify-between">
                                      <span>Delivery Fee</span>
                                      <span className="text-foreground font-medium">₹{formatAmount(order.deliveryFee)}</span>
                                    </div>
                                  )}
                                  {order.packagingFee > 0 && (
                                    <div className="flex justify-between">
                                      <span>Packaging Fee</span>
                                      <span className="text-foreground font-medium">₹{formatAmount(order.packagingFee)}</span>
                                    </div>
                                  )}
                                  {order.discount > 0 && (
                                    <div className="flex justify-between text-green-600 dark:text-green-400 font-medium">
                                      <span>Discount</span>
                                      <span>-₹{formatAmount(order.discount)}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between text-foreground text-sm font-bold border-t border-border pt-2 mt-2">
                                    <span>Grand Total</span>
                                    <span className="text-primary text-base font-extrabold">₹{formatAmount(order.total)}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Payment & Settlement Status */}
                              <div className="bg-card border border-border p-4 rounded-xl space-y-3">
                                <div className="flex items-center justify-between">
                                  <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                    <CreditCard className="w-3.5 h-3.5" /> Payment Status
                                  </p>
                                  <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                    order.paymentStatus === 'PAID'
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
                                      : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20'
                                  }`}>
                                    {order.paymentStatus === 'PAID' ? 'PAID' : 'PENDING'}
                                  </span>
                                </div>

                                {order.paymentStatus === 'PAID' ? (
                                  <div className="space-y-2">
                                    <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300 text-xs space-y-1">
                                      <div className="flex items-center justify-between">
                                        <span className="font-bold flex items-center gap-1.5 text-sm">
                                          <Check className="w-4 h-4 text-emerald-500" />
                                          Paid via {getOrderPaymentMode(order)}
                                        </span>
                                        <button
                                          onClick={() => setEditingPaymentOrderId(editingPaymentOrderId === order.id ? null : order.id)}
                                          className="text-[11px] font-bold text-primary hover:underline cursor-pointer"
                                        >
                                          {editingPaymentOrderId === order.id ? 'Cancel' : 'Change Mode'}
                                        </button>
                                      </div>
                                      <p className="text-[11px] text-muted-foreground">
                                        Amount: ₹{formatAmount(order.total)} • Fully Settled
                                      </p>
                                    </div>

                                    {editingPaymentOrderId === order.id && (
                                      <div className="p-2.5 bg-muted/70 rounded-xl border border-border space-y-2">
                                        <p className="text-[11px] font-bold text-foreground">Switch Payment Mode to:</p>
                                        <div className="grid grid-cols-3 gap-1.5">
                                          <button
                                            onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'CASH' })}
                                            disabled={confirmPaymentMutation.isPending}
                                            className="py-1.5 px-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs cursor-pointer text-center"
                                          >
                                            💵 Cash
                                          </button>
                                          <button
                                            onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'UPI' })}
                                            disabled={confirmPaymentMutation.isPending}
                                            className="py-1.5 px-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs cursor-pointer text-center"
                                          >
                                            📱 UPI
                                          </button>
                                          <button
                                            onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'CARD' })}
                                            disabled={confirmPaymentMutation.isPending}
                                            className="py-1.5 px-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs cursor-pointer text-center"
                                          >
                                            💳 Card
                                          </button>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <p className="text-xs font-bold text-foreground">Mark as Paid — Select Mode:</p>
                                    <div className="grid grid-cols-3 gap-2">
                                      <button
                                        onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'CASH' })}
                                        disabled={confirmPaymentMutation.isPending}
                                        className="py-2.5 px-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition-all cursor-pointer"
                                      >
                                        <span className="text-base">💵</span>
                                        <span>Cash</span>
                                      </button>
                                      <button
                                        onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'UPI' })}
                                        disabled={confirmPaymentMutation.isPending}
                                        className="py-2.5 px-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition-all cursor-pointer"
                                      >
                                        <span className="text-base">📱</span>
                                        <span>UPI / QR</span>
                                      </button>
                                      <button
                                        onClick={() => confirmPaymentMutation.mutate({ id: order.id, instrument: 'CARD' })}
                                        disabled={confirmPaymentMutation.isPending}
                                        className="py-2.5 px-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex flex-col items-center justify-center gap-1 shadow-sm transition-all cursor-pointer"
                                      >
                                        <span className="text-base">💳</span>
                                        <span>Card</span>
                                      </button>
                                    </div>
                                    {order.paymentMethod === 'RAZORPAY' && (
                                      <button
                                        onClick={() => rejectPaymentMutation.mutate(order.id)}
                                        disabled={rejectPaymentMutation.isPending}
                                        className="w-full py-2 px-3 text-xs font-semibold rounded-xl bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-900/50 transition-all disabled:opacity-50 flex items-center justify-center gap-1.5"
                                      >
                                        <AlertTriangle className="w-3.5 h-3.5" />
                                        {rejectPaymentMutation.isPending ? 'Notifying Customer...' : 'Payment Not Received — Notify Customer'}
                                      </button>
                                    )}
                                  </div>
                                )}

                                {/* Kitchen Actions if order is PENDING */}
                                {order.status === 'PENDING' && (
                                  <div className="pt-2.5 border-t border-border flex gap-2">
                                    <button
                                      onClick={() => {
                                        updateStatusMutation.mutate({ id: order.id, status: 'CONFIRMED' });
                                        if (isPrintKotMode) {
                                          printKitchenOrderTicket({ order, restaurantName });
                                        }
                                      }}
                                      disabled={updateStatusMutation.isPending}
                                      className="flex-1 py-2 px-3 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                                    >
                                      {isPrintKotMode ? (
                                        <>
                                          <Printer className="w-3.5 h-3.5" />
                                          Accept & Print KOT
                                        </>
                                      ) : (
                                        <>
                                          <Check className="w-3.5 h-3.5" />
                                          Accept Order
                                        </>
                                      )}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setSelectedRejectReason(PREDEFINED_REJECTION_REASONS[0]);
                                        setCustomRejectReason('');
                                        setRejectOrderTarget({ orderId: order.id, isAddon: false });
                                      }}
                                      disabled={updateStatusMutation.isPending}
                                      className="py-2 px-3 text-xs font-semibold rounded-xl bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 transition-all cursor-pointer"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}

                                {order.status === 'CONFIRMED' && order.addOnStatus === 'PENDING' && (
                                  <div className="pt-2.5 border-t border-border flex gap-2">
                                    <button
                                      onClick={() => {
                                        updateStatusMutation.mutate({ id: order.id, addOnStatus: 'CONFIRMED' });
                                        if (isPrintKotMode) {
                                          printKitchenOrderTicket({ order: { ...order, isAddon: true }, restaurantName, isAddonOnly: true });
                                        }
                                      }}
                                      disabled={updateStatusMutation.isPending}
                                      className="flex-1 py-2 px-3 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm cursor-pointer animate-pulse"
                                    >
                                      {isPrintKotMode ? (
                                        <>
                                          <Printer className="w-3.5 h-3.5" />
                                          Accept & Print Add-on KOT
                                        </>
                                      ) : (
                                        <>
                                          <Check className="w-3.5 h-3.5" />
                                          Accept Add-on
                                        </>
                                      )}
                                    </button>
                                    <button
                                      onClick={() => {
                                        setSelectedRejectReason(PREDEFINED_REJECTION_REASONS[0]);
                                        setCustomRejectReason('');
                                        setRejectOrderTarget({ orderId: order.id, isAddon: true });
                                      }}
                                      disabled={updateStatusMutation.isPending}
                                      className="py-2 px-3 text-xs font-semibold rounded-xl bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200 transition-all cursor-pointer"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>

                          </div>
                        </div>
                      )}
                    </motion.div>
                  ))}
                  {displayedOrders.length === 0 && (
                    <div className="text-center py-20 text-muted-foreground">
                      <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>No orders found for the selected filter</p>
                    </div>
                  )}
                </div>
              )}

              {data && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-end gap-2">
                  <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition-colors">Previous</button>
                  <span className="text-sm">{page} / {data.pagination.totalPages}</span>
                  <button disabled={page === data.pagination.totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-40 transition-colors">Next</button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Cashier + New Manual KOT Fast Entry Drawer */}
      <ManualKotModal
        isOpen={showManualKotModal}
        onClose={() => setShowManualKotModal(false)}
        restaurantName={restaurantName}
      />

      {/* Polite Rejection Modal with Predefined Reasons */}
      {rejectOrderTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-card border border-border rounded-2xl p-5 max-w-md w-full shadow-2xl space-y-4">
            <div>
              <h3 className="font-bold text-base text-foreground">
                {rejectOrderTarget.isAddon ? 'Reject Add-on Request' : 'Reject Order'}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select a polite reason to notify the customer and automatically return them to the menu.
              </p>
            </div>

            <div className="space-y-2">
              {PREDEFINED_REJECTION_REASONS.map((r) => (
                <label
                  key={r}
                  className={`flex items-start gap-2.5 p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    selectedRejectReason === r
                      ? 'border-primary bg-primary/5 font-semibold text-foreground'
                      : 'border-border/70 hover:bg-muted/50 text-muted-foreground'
                  }`}
                >
                  <input
                    type="radio"
                    name="tableRejectReason"
                    value={r}
                    checked={selectedRejectReason === r}
                    onChange={() => setSelectedRejectReason(r)}
                    className="mt-0.5 text-primary focus:ring-primary"
                  />
                  <span>{r}</span>
                </label>
              ))}
            </div>

            {selectedRejectReason === 'Other / Custom reason' && (
              <textarea
                placeholder="Enter custom polite reason for customer..."
                value={customRejectReason}
                onChange={(e) => setCustomRejectReason(e.target.value)}
                className="w-full p-2.5 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground resize-none h-20"
              />
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setRejectOrderTarget(null);
                  setSelectedRejectReason(PREDEFINED_REJECTION_REASONS[0]);
                  setCustomRejectReason('');
                }}
                className="flex-1 py-2 px-3 rounded-xl border border-border font-semibold text-xs hover:bg-muted transition-colors text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const finalReason = selectedRejectReason === 'Other / Custom reason'
                    ? (customRejectReason.trim() || 'Unable to accept this order at this time.')
                    : selectedRejectReason;
                  const target = rejectOrderTarget;
                  setRejectOrderTarget(null);
                  if (target.isAddon) {
                    await updateStatusMutation.mutateAsync({ id: target.orderId, addOnStatus: 'CANCELLED', reason: finalReason });
                  } else {
                    await updateStatusMutation.mutateAsync({ id: target.orderId, status: 'CANCELLED', reason: finalReason });
                  }
                  setSelectedRejectReason(PREDEFINED_REJECTION_REASONS[0]);
                  setCustomRejectReason('');
                }}
                disabled={updateStatusMutation.isPending}
                className="flex-1 py-2 px-3 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-xs transition-colors disabled:opacity-50"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
