'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShoppingBag, UtensilsCrossed, LayoutDashboard, Tag, BarChart3, Settings, LogOut,
  Menu, Search, Clock, ChevronDown, RefreshCw, User, MapPin, Palette,
  Mail, Phone, CreditCard, Receipt, Check, Wallet, Banknote, Sparkles
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { WaiterBell } from '@/components/owner/WaiterBell';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { label: 'Coupons', icon: Tag, href: '/owner/coupons' },
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

const NEXT_STATUS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

type Order = {
  id: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
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
  items: Array<{ quantity: number; menuItem: { name: string }; subtotal: number; unitPrice: number; addOns?: any }>;
};

const formatTime = (timeStr: string | null | undefined) => {
  if (!timeStr) return 'Pending';
  const date = new Date(timeStr);
  const isToday = new Date().toDateString() === date.toDateString();
  const timeOpt: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (isToday) {
    return date.toLocaleTimeString('en-IN', timeOpt);
  } else {
    return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} ${date.toLocaleTimeString('en-IN', timeOpt)}`;
  }
};

export function OwnerOrdersPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expandedOrder, setExpandedOrder] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['owner-orders', statusFilter, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '15', ...(statusFilter !== 'ALL' && { status: statusFilter }), ...(search && { search }) });
      const res = await api.get(`/owner/orders?${params}`);
      return res.data as { data: { orders: Order[] }; pagination: { total: number; totalPages: number } };
    },
    refetchInterval: 15000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status, addOnStatus }: { id: string; status?: string; addOnStatus?: string }) => {
      await api.patch(`/owner/orders/${id}/status`, { status, addOnStatus });
    },
    onSuccess: () => {
      toast.success('Order status updated');
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
    },
    onError: () => toast.error('Failed to update order status'),
  });

  const confirmPaymentMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/owner/orders/${id}/payment`);
    },
    onSuccess: () => {
      toast.success('Payment marked as PAID');
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
    },
    onError: () => toast.error('Failed to update payment status'),
  });

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally { logout(); router.push('/login'); }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`fixed lg:relative left-0 top-0 h-full z-30 w-64 bg-card border-r border-border flex flex-col transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <UtensilsCrossed className="w-4 h-4 text-white" />
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
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <Icon className="w-4 h-4" />{item.label}
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
          <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-xl hover:bg-muted">
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display font-bold text-xl">Orders</h1>
            {data?.pagination.total !== undefined && (
              <span className="text-sm text-muted-foreground">({data.pagination.total} total)</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <WaiterBell />
            <button onClick={() => refetch()} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search order ID or customer..." className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
            </div>
            <div className="flex gap-2 overflow-x-auto">
              {ORDER_STATUSES.map((s) => (
                <button key={s} onClick={() => { setStatusFilter(s); setPage(1); }}
                  className={`px-3 py-2 rounded-xl text-xs font-medium whitespace-nowrap transition-all ${statusFilter === s ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:bg-muted'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Orders */}
          {isLoading ? (
            <div className="space-y-3">{[1,2,3,4].map(i => <div key={i} className="h-24 skeleton rounded-2xl" />)}</div>
          ) : (
            <div className="space-y-3">
              {data?.data.orders.map((order) => (
                <motion.div key={order.id} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
                  className="bg-card border border-border rounded-2xl overflow-hidden">
                  <div className="flex items-center gap-4 p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedOrder(expandedOrder === order.id ? null : order.id)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className="font-mono font-bold text-sm">#{order.id.slice(-8).toUpperCase()}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[order.status] ?? ''}`}>{order.status}</span>
                        {order.tableNumber && (
                          <span className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="w-3 h-3" />Table {order.tableNumber}</span>
                        )}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                          order.paymentMethod === 'RAZORPAY' ? 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-400 dark:border-purple-900/30' :
                          order.paymentMethod === 'WALLET' ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:border-amber-900/30' :
                          order.paymentMethod === 'PAY_TO_WAITER' ? 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-400 dark:border-blue-900/30' :
                          'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-900/30'
                        }`}>
                          {order.paymentMethod === 'RAZORPAY' ? 'Online' : order.paymentMethod === 'WALLET' ? 'Wallet' : order.paymentMethod === 'PAY_TO_WAITER' ? 'Pay to Waiter' : 'Pay on Counter'}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {order.guestName ?? order.user?.name ?? 'Guest'} •
                        {' '}{order.items.slice(0,2).map(i => i.menuItem.name).join(', ')}
                        {order.items.length > 2 && ` +${order.items.length - 2} more`}
                      </p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="font-bold">₹{order.total.toFixed(0)}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 justify-end">
                        <Clock className="w-3 h-3" />
                        {new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expandedOrder === order.id ? 'rotate-180' : ''}`} />
                  </div>

                  {expandedOrder === order.id && (
                    <div className="px-5 pb-5 border-t border-border pt-4 bg-muted/10">
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
                        
                        {/* Left Pane - Items and Billing Details (spans 2 columns on large screens) */}
                        <div className="lg:col-span-2 space-y-5">
                          
                          {/* Order Items Table */}
                          <div className="space-y-2">
                            <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Order Items</p>
                            <div className="bg-card border border-border rounded-xl overflow-hidden divide-y divide-border">
                              {order.items.map((item, idx) => (
                                <div key={idx} className="flex items-center justify-between p-3 text-sm">
                                  <div className="flex-1">
                                    <span className="font-medium text-foreground">{item.menuItem.name}</span>
                                    <span className="text-xs text-muted-foreground ml-2">
                                      ({item.quantity} × ₹{item.unitPrice || (item.subtotal / item.quantity).toFixed(0)})
                                    </span>
                                    {item.addOns && Array.isArray(item.addOns) && item.addOns.length > 0 && (
                                      <div className="text-[11px] text-muted-foreground mt-0.5 ml-2">
                                        + {item.addOns.map((ao: any) => ao.name).join(', ')}
                                      </div>
                                    )}
                                  </div>
                                  <span className="font-semibold text-foreground">₹{item.subtotal.toFixed(0)}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Sub-grid: Customer info and Receipt Billing */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                            
                            {/* Customer & Address Details */}
                            <div className="space-y-3 bg-card border border-border p-4 rounded-xl flex flex-col justify-between">
                              <div>
                                <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                                  <User className="w-3.5 h-3.5" /> Customer Details
                                </p>
                                <div className="space-y-2 text-sm">
                                  <p className="font-semibold text-foreground">
                                    {order.guestName ?? order.user?.name ?? 'Guest Customer'}
                                  </p>
                                  {(order.guestPhone || order.user?.phone) && (
                                    <p className="text-muted-foreground flex items-center gap-2">
                                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                                      <a href={`tel:${order.guestPhone ?? order.user?.phone}`} className="hover:text-primary transition-colors">
                                        {order.guestPhone ?? order.user?.phone}
                                      </a>
                                    </p>
                                  )}
                                  {order.user?.email && (
                                    <p className="text-muted-foreground flex items-center gap-2 truncate">
                                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                                      <a href={`mailto:${order.user.email}`} className="hover:text-primary transition-colors truncate">
                                        {order.user.email}
                                      </a>
                                    </p>
                                  )}
                                </div>
                              </div>
                              
                              <div className="border-t border-border pt-3 mt-3">
                                {order.address ? (
                                  <div className="space-y-1">
                                    <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 mb-1">
                                      <MapPin className="w-3.5 h-3.5 flex-shrink-0" /> Delivery Address
                                    </p>
                                    <p className="text-muted-foreground text-xs leading-relaxed">
                                      {order.address.flat}, {order.address.street}, {order.address.area}, {order.address.city} - {order.address.pincode}
                                    </p>
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider">Order Mode</p>
                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                                      Dine-In {order.tableNumber ? `(Table ${order.tableNumber})` : ''}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Billing details / Receipt Summary */}
                            <div className="space-y-3 bg-card border border-border p-4 rounded-xl">
                              <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                                <Receipt className="w-3.5 h-3.5" /> Receipt Summary
                              </p>
                              <div className="space-y-2 text-xs text-muted-foreground">
                                <div className="flex justify-between">
                                  <span>Subtotal</span>
                                  <span className="text-foreground font-medium">₹{order.subtotal?.toFixed(2) ?? '0.00'}</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>GST ({process.env.NEXT_PUBLIC_GST_RATE ?? '18'}%)</span>
                                  <span className="text-foreground font-medium">₹{order.gstAmount?.toFixed(2) ?? '0.00'}</span>
                                </div>
                                {order.deliveryFee > 0 && (
                                  <div className="flex justify-between">
                                    <span>Delivery Fee</span>
                                    <span className="text-foreground font-medium">₹{order.deliveryFee.toFixed(2)}</span>
                                  </div>
                                )}
                                {order.packagingFee > 0 && (
                                  <div className="flex justify-between">
                                    <span>Packaging Fee</span>
                                    <span className="text-foreground font-medium">₹{order.packagingFee.toFixed(2)}</span>
                                  </div>
                                )}
                                {order.discount > 0 && (
                                  <div className="flex justify-between text-green-600 dark:text-green-400 font-medium">
                                    <span>Discount</span>
                                    <span>-₹{order.discount.toFixed(2)}</span>
                                  </div>
                                )}
                                <div className="flex justify-between text-foreground text-sm font-bold border-t border-border pt-2 mt-2">
                                  <span>Grand Total</span>
                                  <span className="text-primary text-base font-extrabold">₹{order.total?.toFixed(2) ?? '0.00'}</span>
                                </div>
                              </div>
                            </div>

                          </div>
                        </div>

                        {/* Right Pane - Timeline & Payment Information & Actions */}
                        <div className="space-y-5">
                          
                          {/* Payment status, type and Action buttons */}
                          <div className="bg-card border border-border p-4 rounded-xl space-y-4">
                            <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <CreditCard className="w-3.5 h-3.5" /> Payment Details
                            </p>
                            <div className="flex gap-2 flex-wrap">
                              {/* Payment Method Badge */}
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                                order.paymentMethod === 'RAZORPAY' ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300' :
                                order.paymentMethod === 'WALLET' ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' :
                                order.paymentMethod === 'PAY_TO_WAITER' ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300' :
                                'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                              }`}>
                                {order.paymentMethod === 'RAZORPAY' ? <CreditCard className="w-3 h-3" /> :
                                 order.paymentMethod === 'WALLET' ? <Wallet className="w-3 h-3" /> :
                                 order.paymentMethod === 'PAY_TO_WAITER' ? <User className="w-3 h-3" /> :
                                 <Banknote className="w-3 h-3" />}
                                {order.paymentMethod === 'RAZORPAY' ? 'Razorpay' : order.paymentMethod === 'WALLET' ? 'Wallet' : order.paymentMethod === 'PAY_TO_WAITER' ? 'Pay to Waiter' : 'Pay on Counter'}
                              </span>
                              
                              {/* Payment Status Badge */}
                              <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ${
                                order.paymentStatus === 'PAID' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' :
                                order.paymentStatus === 'FAILED' ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300' :
                                order.paymentStatus === 'REFUNDED' ? 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-300' :
                                'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300'
                              }`}>
                                {order.paymentStatus}
                              </span>
                            </div>

                            {/* Additional Payment Info / Action */}
                            <div className="pt-2 border-t border-border space-y-2">
                              {order.paymentStatus === 'PAID' ? (
                                <p className="text-xs font-semibold text-green-600 dark:text-green-400 flex items-center gap-1">
                                  {order.paymentMethod === 'RAZORPAY' ? (
                                    <>✅ Paid Online via Razorpay</>
                                  ) : order.paymentMethod === 'PAY_TO_WAITER' ? (
                                    <>💵 Paid to Waiter</>
                                  ) : (
                                    <>💵 Cash Received / Paid at Counter</>
                                  )}
                                </p>
                              ) : (
                                <button
                                  onClick={() => confirmPaymentMutation.mutate(order.id)}
                                  disabled={confirmPaymentMutation.isPending}
                                  className="w-full py-2 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  {confirmPaymentMutation.isPending 
                                    ? 'Confirming...' 
                                    : order.paymentMethod === 'RAZORPAY'
                                    ? 'Confirm Direct Online Payment'
                                    : order.paymentMethod === 'PAY_TO_WAITER' 
                                    ? 'Confirm Payment Paid to Waiter' 
                                    : 'Mark as Paid (Received Cash)'}
                                </button>
                              )}
                            </div>
                            {/* Add-on Order Journey Banner & Actions */}
                            {(order as any).addOnStatus && (
                              <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 rounded-xl p-3 space-y-2 my-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 font-bold text-xs text-blue-700 dark:text-blue-300">
                                    <Sparkles className="w-4 h-4 animate-spin text-blue-500" />
                                    <span>⚡ Add-on Items Status: {(order as any).addOnStatus}</span>
                                  </div>
                                  {(order as any).lastAddOnAt && (
                                    <span className="text-[10px] text-blue-600 dark:text-blue-400">
                                      Added {new Date((order as any).lastAddOnAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                  )}
                                </div>
                                <div className="flex gap-2 flex-wrap">
                                  {(order as any).addOnStatus !== 'PREPARING' && (
                                    <button
                                      onClick={() => updateStatusMutation.mutate({ id: order.id, addOnStatus: 'PREPARING' })}
                                      disabled={updateStatusMutation.isPending}
                                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-all shadow-sm flex items-center gap-1"
                                    >
                                      👨‍🍳 Mark Add-ons Preparing
                                    </button>
                                  )}
                                  {(order as any).addOnStatus !== 'READY' && (
                                    <button
                                      onClick={() => updateStatusMutation.mutate({ id: order.id, addOnStatus: 'READY' })}
                                      disabled={updateStatusMutation.isPending}
                                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-amber-600 hover:bg-amber-700 text-white transition-all shadow-sm flex items-center gap-1"
                                    >
                                      🍽️ Mark Add-ons Ready
                                    </button>
                                  )}
                                  {(order as any).addOnStatus !== 'DELIVERED' && (
                                    <button
                                      onClick={() => updateStatusMutation.mutate({ id: order.id, addOnStatus: 'DELIVERED' })}
                                      disabled={updateStatusMutation.isPending}
                                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-sm flex items-center gap-1"
                                    >
                                      ✅ Mark Add-ons Served
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Action Buttons */}
                            {NEXT_STATUS[order.status]?.length > 0 && (
                              <div className="flex gap-2 flex-wrap pt-2 border-t border-border">
                                {NEXT_STATUS[order.status].map((next) => (
                                  <button key={next} onClick={() => updateStatusMutation.mutate({ id: order.id, status: next })}
                                    disabled={updateStatusMutation.isPending}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all disabled:opacity-50 flex items-center gap-1 shadow-sm ${
                                      next === 'CANCELLED' 
                                        ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200' 
                                        : 'bg-primary text-primary-foreground hover:bg-primary/95 hover:shadow-md'
                                    }`}>
                                    {next !== 'CANCELLED' && <Check className="w-3 h-3" />}
                                    Mark as {next}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Visual Progress Timeline */}
                          <div className="bg-card border border-border p-4 rounded-xl space-y-4">
                            <p className="font-semibold text-xs text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                              <Clock className="w-3.5 h-3.5" /> Lifecycle Timeline
                            </p>
                            
                            <div className="relative pl-3 space-y-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-[2px] before:bg-border">
                              
                              {/* Placed Step */}
                              <div className="relative pl-5">
                                <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-primary/20" />
                                <div className="text-xs">
                                  <p className="font-semibold text-foreground">Placed</p>
                                  <p className="text-muted-foreground text-[10px] mt-0.5">{formatTime(order.createdAt)}</p>
                                </div>
                              </div>

                              {/* Confirmed Step */}
                              <div className="relative pl-5">
                                <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full transition-all ${
                                  order.confirmedAt ? 'bg-primary ring-4 ring-primary/20' : 'bg-card border-2 border-muted-foreground/35'
                                }`} />
                                <div className="text-xs">
                                  <p className={`font-semibold ${order.confirmedAt ? 'text-foreground' : 'text-muted-foreground'}`}>Confirmed</p>
                                  <p className="text-muted-foreground text-[10px] mt-0.5">{formatTime(order.confirmedAt)}</p>
                                </div>
                              </div>

                              {/* Kitchen (Preparing / Baking) Step */}
                              <div className="relative pl-5">
                                <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full transition-all ${
                                  (order.preparingAt || order.bakingAt) ? 'bg-primary ring-4 ring-primary/20' : 'bg-card border-2 border-muted-foreground/35'
                                }`} />
                                <div className="text-xs">
                                  <p className={`font-semibold ${(order.preparingAt || order.bakingAt) ? 'text-foreground' : 'text-muted-foreground'}`}>Preparing</p>
                                  <p className="text-muted-foreground text-[10px] mt-0.5">{formatTime(order.preparingAt || order.bakingAt)}</p>
                                </div>
                              </div>

                              {/* Ready Step */}
                              <div className="relative pl-5">
                                <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full transition-all ${
                                  order.readyAt ? 'bg-primary ring-4 ring-primary/20' : 'bg-card border-2 border-muted-foreground/35'
                                }`} />
                                <div className="text-xs">
                                  <p className={`font-semibold ${order.readyAt ? 'text-foreground' : 'text-muted-foreground'}`}>Ready</p>
                                  <p className="text-muted-foreground text-[10px] mt-0.5">{formatTime(order.readyAt)}</p>
                                </div>
                              </div>

                              {/* Delivered / Served Step */}
                              {order.status !== 'CANCELLED' ? (
                                <div className="relative pl-5">
                                  <span className={`absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full transition-all ${
                                    order.deliveredAt ? 'bg-green-500 ring-4 ring-green-500/20' : 'bg-card border-2 border-muted-foreground/35'
                                  }`} />
                                  <div className="text-xs">
                                    <p className={`font-semibold ${order.deliveredAt ? 'text-foreground' : 'text-muted-foreground'}`}>
                                      {order.addressId || order.address ? 'Delivered' : 'Served'}
                                    </p>
                                    <p className="text-muted-foreground text-[10px] mt-0.5">{formatTime(order.deliveredAt)}</p>
                                  </div>
                                </div>
                              ) : (
                                <div className="relative pl-5">
                                  <span className="absolute left-0 top-1.5 w-2.5 h-2.5 rounded-full bg-red-500 ring-4 ring-red-500/20" />
                                  <div className="text-xs">
                                    <p className="font-semibold text-red-500">Cancelled</p>
                                    <p className="text-muted-foreground text-[10px] mt-0.5">{formatTime(order.cancelledAt)}</p>
                                  </div>
                                </div>
                              )}

                            </div>
                          </div>

                        </div>

                      </div>
                    </div>
                  )}
                </motion.div>
              ))}
              {data?.data.orders.length === 0 && (
                <div className="text-center py-20 text-muted-foreground">
                  <ShoppingBag className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>No orders found</p>
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
        </div>
      </main>
    </div>
  );
}
