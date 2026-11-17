'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  UtensilsCrossed,
  Receipt,
  Check,
  Search,
  RefreshCw,
  CreditCard,
  Banknote,
  X,
  Layers,
  ShieldCheck,
  ArrowRight,
  Filter,
  SlidersHorizontal,
  ChevronRight,
  Menu,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api, { getSocketUrl } from '@/services/api';
import { toast } from 'sonner';
import { io } from 'socket.io-client';
import { WaiterBell } from '@/components/owner/WaiterBell';
import { OwnerSidebar } from '@/components/owner/OwnerSidebar';

interface TableSessionDetail {
  id: string;
  sessionCode: string;
  startedAt: string;
  durationMinutes: number;
  orderCount: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  orderStatus: string;
  sessionManagementModeSnapshot: string;
  notes?: string | null;
}

interface TableClearanceItem {
  tableNumber: string;
  status: 'AVAILABLE' | 'OCCUPIED' | 'PAYMENT_PENDING' | 'PAID_AWAITING_CLEARANCE';
  displayStatus: string;
  isDisabled: boolean;
  session: TableSessionDetail | null;
}

interface ClearanceDashboardData {
  tables: TableClearanceItem[];
  summary: {
    totalTables: number;
    awaitingClearanceCount: number;
    occupiedCount: number;
    paymentPendingCount: number;
    availableCount: number;
    sessionManagementMode: 'AUTO' | 'MANUAL';
  };
}

export default function TableClearancePage() {
  const { user, isAuthenticated } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'AWAITING_CLEARANCE' | 'OCCUPIED' | 'PAYMENT_PENDING' | 'AVAILABLE'>('ALL');
  const [confirmClearTable, setConfirmClearTable] = useState<TableClearanceItem | null>(null);

  // Auth Protection
  useEffect(() => {
    if (!isAuthenticated || !user) {
      router.push('/login');
    }
  }, [isAuthenticated, user, router]);

  // Fetch Table Clearance Dashboard Data
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['table-clearance-overview'],
    queryFn: async () => {
      const res = await api.get('/owner/table-clearance');
      return res.data.data as ClearanceDashboardData;
    },
    refetchInterval: 6000,
  });

  const tables = data?.tables || [];
  const summary = data?.summary || {
    totalTables: 0,
    awaitingClearanceCount: 0,
    occupiedCount: 0,
    paymentPendingCount: 0,
    availableCount: 0,
    sessionManagementMode: 'MANUAL',
  };

  // Real-time socket listener for live table updates
  useEffect(() => {
    const socket = io(getSocketUrl(), { transports: ['polling', 'websocket'] });
    const restaurantId = (user as any)?.restaurantId || (user as any)?.kitchenRestaurantId;

    if (restaurantId) {
      socket.emit('join:restaurant', restaurantId);
    }

    const handleTableUpdate = () => {
      qc.invalidateQueries({ queryKey: ['table-clearance-overview'] });
      qc.invalidateQueries({ queryKey: ['table-sessions-active'] });
    };

    socket.on('table:update', handleTableUpdate);
    socket.on('tableSession:update', handleTableUpdate);

    return () => {
      socket.off('table:update', handleTableUpdate);
      socket.off('tableSession:update', handleTableUpdate);
      socket.disconnect();
    };
  }, [user, qc]);

  // Clear Table Mutation
  const clearMutation = useMutation({
    mutationFn: async ({ tableNumber, sessionId }: { tableNumber: string; sessionId?: string }) => {
      const res = await api.post('/owner/table-clearance/clear', { tableNumber, sessionId });
      return res.data;
    },
    onSuccess: (resData) => {
      toast.success(resData.message || 'Table cleared successfully! Table is now available.');
      setConfirmClearTable(null);
      qc.invalidateQueries({ queryKey: ['table-clearance-overview'] });
      qc.invalidateQueries({ queryKey: ['table-sessions-active'] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.message || err.message || 'Failed to clear table.';
      toast.error(msg, { duration: 5000 });
    },
  });

  // Filter and search logic
  const filteredTables = useMemo(() => {
    return tables.filter((t) => {
      const matchesSearch = t.tableNumber.toLowerCase().includes(searchQuery.trim().toLowerCase());
      if (!matchesSearch) return false;

      if (activeFilter === 'ALL') return true;
      if (activeFilter === 'AWAITING_CLEARANCE') return t.status === 'PAID_AWAITING_CLEARANCE';
      if (activeFilter === 'OCCUPIED') return t.status === 'OCCUPIED';
      if (activeFilter === 'PAYMENT_PENDING') return t.status === 'PAYMENT_PENDING';
      if (activeFilter === 'AVAILABLE') return t.status === 'AVAILABLE';
      return true;
    });
  }, [tables, searchQuery, activeFilter]);

  return (
    <div className="flex h-screen bg-background overflow-hidden text-foreground">
      {/* Sidebar Navigation */}
      <OwnerSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        {/* Top Header */}
        <header className="h-16 px-4 sm:px-6 border-b border-border bg-card/80 backdrop-blur-md sticky top-0 z-30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl text-muted-foreground hover:bg-muted"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-display font-bold text-lg sm:text-xl text-foreground">Table Clearance</h1>
                <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  {summary.sessionManagementMode === 'AUTO' ? 'Auto Mode' : 'Manual Mode'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Manage table occupancy and physically clear tables during rush hours
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-2 rounded-xl border border-border bg-card hover:bg-muted text-muted-foreground transition-all flex items-center justify-center"
              title="Refresh Tables"
            >
              <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin text-primary' : ''}`} />
            </button>
            <Link
              href="/owner/settings"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border text-xs font-semibold text-muted-foreground hover:bg-muted transition-colors"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Settings
            </Link>
            <WaiterBell />
          </div>
        </header>

        {/* Content Body */}
        <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl w-full mx-auto">
          {/* Quick Stats Banner */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
            {/* 1. Awaiting Clearance Counter (Prominent) */}
            <div
              onClick={() => setActiveFilter('AWAITING_CLEARANCE')}
              className={`col-span-2 sm:col-span-1 p-4 rounded-2xl border transition-all cursor-pointer relative overflow-hidden ${
                summary.awaitingClearanceCount > 0
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'bg-card border-border hover:border-border/80'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Awaiting Clearance
                </span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold font-display">
                  {summary.awaitingClearanceCount}
                </span>
                <span className="text-xs text-muted-foreground">Tables</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Paid • Needs physical clearing</p>
            </div>

            {/* 2. Occupied Tables */}
            <div
              onClick={() => setActiveFilter('OCCUPIED')}
              className="p-4 rounded-2xl border border-border bg-card hover:border-border/80 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Occupied</span>
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold font-display">{summary.occupiedCount}</span>
                <span className="text-xs text-muted-foreground">Dining</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Active customer sessions</p>
            </div>

            {/* 3. Payment Pending */}
            <div
              onClick={() => setActiveFilter('PAYMENT_PENDING')}
              className="p-4 rounded-2xl border border-border bg-card hover:border-border/80 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Payment Pending
                </span>
                <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold font-display">{summary.paymentPendingCount}</span>
                <span className="text-xs text-muted-foreground">Unsettled</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Food served / bill pending</p>
            </div>

            {/* 4. Available Tables */}
            <div
              onClick={() => setActiveFilter('AVAILABLE')}
              className="p-4 rounded-2xl border border-border bg-card hover:border-border/80 transition-all cursor-pointer"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Available</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-extrabold font-display">{summary.availableCount}</span>
                <span className="text-xs text-muted-foreground">of {summary.totalTables}</span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Ready for new diners</p>
            </div>
          </div>

          {/* Mode Advisory Banner */}
          {summary.sessionManagementMode === 'MANUAL' ? (
            <div className="p-3.5 rounded-xl bg-muted/40 border border-border flex items-center justify-between text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                <span>
                  <strong className="text-foreground">Manual Table Clearance Mode:</strong> Payment does not automatically release tables. Click <strong className="text-foreground">Clear Table</strong> when diners leave.
                </span>
              </div>
              <Link href="/owner/settings" className="text-primary hover:underline whitespace-nowrap ml-2 font-medium">
                Change Mode →
              </Link>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                <span>
                  <strong>Auto Session Reset Mode:</strong> Tables are automatically released as soon as all orders are paid.
                </span>
              </div>
              <Link href="/owner/settings" className="text-emerald-600 dark:text-emerald-400 hover:underline whitespace-nowrap ml-2 font-medium">
                Change Mode →
              </Link>
            </div>
          )}

          {/* Search & Filter Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            {/* Search Input */}
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search table or room number..."
                className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-xl text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
              {[
                { id: 'ALL', label: 'All Tables', count: tables.length },
                { id: 'AWAITING_CLEARANCE', label: 'Awaiting Clearance', count: summary.awaitingClearanceCount },
                { id: 'OCCUPIED', label: 'Occupied', count: summary.occupiedCount },
                { id: 'PAYMENT_PENDING', label: 'Payment Pending', count: summary.paymentPendingCount },
                { id: 'AVAILABLE', label: 'Available', count: summary.availableCount },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveFilter(f.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-1.5 ${
                    activeFilter === f.id
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-card border border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <span>{f.label}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                    activeFilter === f.id ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}>
                    {f.count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Tables Grid */}
          {isLoading ? (
            <div className="py-20 text-center">
              <RefreshCw className="w-8 h-8 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm text-muted-foreground font-medium">Loading restaurant table statuses...</p>
            </div>
          ) : filteredTables.length === 0 ? (
            <div className="py-16 text-center border border-dashed border-border rounded-2xl bg-card p-8">
              <Layers className="w-10 h-10 text-muted-foreground/60 mx-auto mb-3" />
              <h3 className="font-bold text-base text-foreground">No tables found</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {searchQuery
                  ? `No tables match "${searchQuery}". Clear your search query.`
                  : 'No tables currently match this filter criteria.'}
              </p>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-4 px-4 py-2 rounded-xl bg-muted text-foreground text-xs font-semibold hover:bg-muted/80 transition-colors"
                >
                  Clear Search
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredTables.map((item) => {
                const isAwaitingClearance = item.status === 'PAID_AWAITING_CLEARANCE';
                const isOccupied = item.status === 'OCCUPIED';
                const isPaymentPending = item.status === 'PAYMENT_PENDING';
                const isAvailable = item.status === 'AVAILABLE';

                return (
                  <motion.div
                    key={item.tableNumber}
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`rounded-2xl border p-4 sm:p-5 flex flex-col justify-between transition-all relative overflow-hidden bg-card ${
                      isAwaitingClearance
                        ? 'border-amber-500/50 shadow-md ring-1 ring-amber-500/20'
                        : isOccupied
                        ? 'border-rose-500/30 shadow-sm'
                        : isPaymentPending
                        ? 'border-orange-500/30 shadow-sm'
                        : 'border-border opacity-95 hover:border-emerald-500/40'
                    }`}
                  >
                    {/* Top Row: Table Name & Status Badge */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <h3 className="font-display font-extrabold text-lg text-foreground tracking-tight">
                            {item.tableNumber}
                          </h3>
                          {item.isDisabled && (
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                              Disabled
                            </span>
                          )}
                        </div>

                        {/* Status Badge */}
                        <div className="flex items-center gap-1.5">
                          {isAwaitingClearance && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                              <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                              Awaiting Clearance
                            </span>
                          )}
                          {isPaymentPending && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-orange-500/15 text-orange-600 dark:text-orange-400 border border-orange-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                              Payment Pending
                            </span>
                          )}
                          {isOccupied && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              Occupied
                            </span>
                          )}
                          {isAvailable && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              Available
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Session Information Body */}
                      {item.session ? (
                        <div className="space-y-2.5 py-2 border-t border-border/60 text-xs">
                          {/* Session ID & Duration */}
                          <div className="flex items-center justify-between text-muted-foreground">
                            <span>Code: #{item.session.sessionCode}</span>
                            <span className="flex items-center gap-1 font-medium text-foreground">
                              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                              {item.session.durationMinutes}m ago
                            </span>
                          </div>

                          {/* Orders Count & Total */}
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-muted-foreground">
                              {item.session.orderCount} {item.session.orderCount === 1 ? 'order' : 'orders'}
                            </span>
                            <div className="text-right">
                              <div className="font-extrabold font-display text-sm text-foreground">
                                ₹{item.session.totalAmount.toFixed(2)}
                              </div>
                            </div>
                          </div>

                          {/* Payment Status Pill */}
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-muted-foreground">Payment:</span>
                            <span
                              className={`font-extrabold text-[10px] px-2 py-0.5 rounded-md border ${
                                item.session.paymentStatus === 'PAID'
                                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                                  : item.session.paymentStatus === 'PARTIALLY_PAID'
                                  ? 'bg-amber-500/10 text-amber-600 border-amber-500/30'
                                  : 'bg-rose-500/10 text-rose-600 border-rose-500/30'
                              }`}
                            >
                              {item.session.paymentStatus === 'PAID'
                                ? '✓ PAID'
                                : item.session.paymentStatus === 'PARTIALLY_PAID'
                                ? '⏳ PARTIALLY PAID'
                                : '⏳ UNPAID'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="py-6 text-center text-xs text-muted-foreground border-t border-border/40">
                          <CheckCircle2 className="w-5 h-5 text-emerald-500/60 mx-auto mb-1.5" />
                          <p>Ready for next guests</p>
                        </div>
                      )}
                    </div>

                    {/* Bottom Action Footer */}
                    <div className="pt-3 border-t border-border/60 mt-2">
                      {isAvailable ? (
                        <div className="text-center py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                          Table Ready
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmClearTable(item)}
                          disabled={clearMutation.isPending}
                          className={`w-full py-2.5 px-3 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 ${
                            isAwaitingClearance
                              ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20 active:scale-[0.98]'
                              : 'bg-muted hover:bg-muted/80 text-foreground active:scale-[0.98]'
                          }`}
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          Clear Table
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal: Clear Table */}
      <AnimatePresence>
        {confirmClearTable && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-3xl max-w-md w-full p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between pb-2 border-b border-border">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <h3 className="font-display font-bold text-lg text-foreground">
                    Clear {confirmClearTable.tableNumber}?
                  </h3>
                </div>
                <button
                  onClick={() => setConfirmClearTable(null)}
                  className="p-1 rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground leading-relaxed">
                  Clearing this table will permanently close the current table session (Code #{confirmClearTable.session?.sessionCode}) and reset the table status to <strong className="text-emerald-500">AVAILABLE</strong> for new diners scanning the QR code.
                </p>

                {confirmClearTable.session && (
                  <div className="p-3.5 rounded-2xl bg-muted/40 border border-border space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Session Total:</span>
                      <span className="font-bold text-foreground">
                        ₹{confirmClearTable.session.totalAmount.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Payment Status:</span>
                      <span
                        className={`font-bold ${
                          confirmClearTable.session.paymentStatus === 'PAID'
                            ? 'text-emerald-500'
                            : 'text-amber-500'
                        }`}
                      >
                        {confirmClearTable.session.paymentStatus === 'PAID' ? '✓ Fully Paid' : '⏳ Unpaid Orders Exist'}
                      </span>
                    </div>
                  </div>
                )}

                {confirmClearTable.session?.paymentStatus !== 'PAID' && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Notice: This table still has unsettled orders. Clearance will only succeed if orders are paid or settled at the counter.
                    </span>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmClearTable(null)}
                  className="px-4 py-2.5 rounded-xl border border-border text-xs font-semibold hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() =>
                    clearMutation.mutate({
                      tableNumber: confirmClearTable.tableNumber,
                      sessionId: confirmClearTable.session?.id,
                    })
                  }
                  disabled={clearMutation.isPending}
                  className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold shadow-md transition-all flex items-center gap-1.5"
                >
                  {clearMutation.isPending ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  Confirm &amp; Clear Table
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
