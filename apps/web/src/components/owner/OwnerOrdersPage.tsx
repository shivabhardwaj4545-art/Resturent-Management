'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  ShoppingBag, UtensilsCrossed, LayoutDashboard, Tag, BarChart3, Settings, LogOut,
  Menu, Search, Clock, ChevronDown, RefreshCw, User, MapPin
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { label: 'Coupons', icon: Tag, href: '/owner/coupons' },
  { label: 'Analytics', icon: BarChart3, href: '/owner/analytics' },
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
  id: string; status: string; total: number; createdAt: string;
  tableNumber: string | null; guestName: string | null;
  user: { name: string } | null;
  items: Array<{ quantity: number; menuItem: { name: string }; subtotal: number }>;
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
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.patch(`/owner/orders/${id}/status`, { status });
    },
    onSuccess: () => {
      toast.success('Order status updated');
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
    },
    onError: () => toast.error('Failed to update order status'),
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
          <button onClick={() => refetch()} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
            <RefreshCw className="w-4 h-4" />
          </button>
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
                    <div className="px-4 pb-4 border-t border-border pt-3 space-y-3">
                      <div className="space-y-1.5">
                        {order.items.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">{item.quantity}× {item.menuItem.name}</span>
                            <span>₹{item.subtotal.toFixed(0)}</span>
                          </div>
                        ))}
                      </div>
                      {NEXT_STATUS[order.status]?.length > 0 && (
                        <div className="flex gap-2 flex-wrap pt-2">
                          {NEXT_STATUS[order.status].map((next) => (
                            <button key={next} onClick={() => updateStatusMutation.mutate({ id: order.id, status: next })}
                              disabled={updateStatusMutation.isPending}
                              className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-colors disabled:opacity-50 ${next === 'CANCELLED' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 hover:bg-red-200' : 'bg-primary text-primary-foreground hover:bg-primary/90'}`}>
                              Mark as {next}
                            </button>
                          ))}
                        </div>
                      )}
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
