'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Menu,
  Clock,
  CheckCircle2,
  AlertCircle,
  UtensilsCrossed,
  Receipt,
  Check,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  CreditCard,
  Banknote,
  X,
  Layers,
  Eye,
  Lock,
  ArrowRight,
  UserCheck,
  Printer,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import api, { getSocketUrl } from '@/services/api';
import { toast } from 'sonner';
import { io } from 'socket.io-client';
import { WaiterBell } from '@/components/owner/WaiterBell';
import { OwnerSidebar } from '@/components/owner/OwnerSidebar';

interface BatchItem {
  id: string;
  itemName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  customizations?: any;
  specialInstructions?: string | null;
  addedBy?: string | null;
}

interface OrderBatch {
  id: string;
  batchNumber: number;
  status: 'OPEN' | 'SUBMITTED' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'SERVED' | 'COMPLETED' | 'CANCELLED';
  subtotal: number;
  tax: number;
  total: number;
  notes?: string | null;
  submittedAt?: string | null;
  servedAt?: string | null;
  completedAt?: string | null;
  items: BatchItem[];
}

interface TableSessionSummary {
  id: string;
  tableNumber: string;
  sessionCode: string;
  guestCount: number;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  currentBatchNumber: number;
  currentBatchStatus: string;
  currentBatch?: OrderBatch | null;
  totalBatches: number;
  sessionTotal: number;
  paymentStatus: 'PAID' | 'PENDING';
  createdAt: string;
  updatedAt: string;
}

export default function OwnerTableSessionsPage() {
  const { user, isAuthenticated } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [viewBillSessionId, setViewBillSessionId] = useState<string | null>(null);
  const [closeModalSession, setCloseModalSession] = useState<TableSessionSummary | null>(null);
  const [markPaidModalSession, setMarkPaidModalSession] = useState<TableSessionSummary | null>(null);
  const [cancelModalSession, setCancelModalSession] = useState<TableSessionSummary | null>(null);
  const [newSessionModal, setNewSessionModal] = useState(false);
  const [newTableNum, setNewTableNum] = useState('');
  const [newGuests, setNewGuests] = useState('4');

  // Verify Auth
  useEffect(() => {
    if (!isAuthenticated || !user) {
      router.push('/login');
    }
  }, [isAuthenticated, user, router]);

  // Fetch active sessions
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['table-sessions-active'],
    queryFn: async () => {
      const res = await api.get('/table-sessions');
      return res.data.data.sessions as TableSessionSummary[];
    },
    refetchInterval: 5000,
  });

  const sessions = data || [];

  // Fetch full details of selected session
  const { data: sessionDetailData, isLoading: detailLoading } = useQuery({
    queryKey: ['table-session-detail', selectedSessionId],
    queryFn: async () => {
      if (!selectedSessionId) return null;
      const res = await api.get(`/table-sessions/${selectedSessionId}`);
      return res.data.data.session;
    },
    enabled: !!selectedSessionId,
  });

  // Fetch session bill breakdown
  const { data: sessionBillData, isLoading: billLoading } = useQuery({
    queryKey: ['table-session-bill', viewBillSessionId],
    queryFn: async () => {
      if (!viewBillSessionId) return null;
      const res = await api.get(`/table-sessions/${viewBillSessionId}/bill`);
      return res.data.data;
    },
    enabled: !!viewBillSessionId,
  });

  // Real-time socket listener
  useEffect(() => {
    const socket = io(getSocketUrl(), { transports: ['polling', 'websocket'] });
    const restaurantId = (user as any)?.restaurantId || (user as any)?.kitchenRestaurantId;
    if (restaurantId) {
      socket.emit('join:restaurant', restaurantId);
    }

    const handleRefresh = () => {
      qc.invalidateQueries({ queryKey: ['table-sessions-active'] });
      if (selectedSessionId) {
        qc.invalidateQueries({ queryKey: ['table-session-detail', selectedSessionId] });
      }
      if (viewBillSessionId) {
        qc.invalidateQueries({ queryKey: ['table-session-bill', viewBillSessionId] });
      }
    };

    socket.on('table-session:updated', handleRefresh);
    socket.on('order:status', handleRefresh);
    socket.on('order:new', handleRefresh);
    socket.on('payment:confirmed', handleRefresh);

    socket.on('table-session:batch-unlocked', (payload: any) => {
      toast.info(payload.message || 'Next food batch unlocked for dining table! 🔔');
      handleRefresh();
    });

    return () => {
      socket.disconnect();
    };
  }, [user, selectedSessionId, viewBillSessionId, qc]);

  // Create Manual Table Session Mutation
  const createSessionMutation = useMutation({
    mutationFn: async () => {
      if (!newTableNum.trim()) throw new Error('Table number is required');
      const res = await api.post('/table-sessions/join-or-create', {
        tableNumber: newTableNum.trim(),
        guestCount: Number(newGuests) || 1,
      });
      return res.data.data.session;
    },
    onSuccess: (newSess) => {
      toast.success(`Session started for ${newSess.tableNumber} with Code #${newSess.sessionCode}! 🎉`);
      setNewSessionModal(false);
      setNewTableNum('');
      qc.invalidateQueries({ queryKey: ['table-sessions-active'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || err.message || 'Failed to start session');
    },
  });

  // Update Batch Status Mutation (Staff: Mark Served / Mark Completed)
  const updateBatchMutation = useMutation({
    mutationFn: async ({
      sessionId,
      batchId,
      status,
    }: {
      sessionId: string;
      batchId: string;
      status: string;
    }) => {
      const res = await api.patch(`/table-sessions/${sessionId}/batches/${batchId}/status`, { status });
      return res.data.data;
    },
    onSuccess: (data, vars) => {
      if (vars.status === 'SERVED') {
        toast.success('Food marked as SERVED! Table is enjoying their meal. 🍽️');
      } else if (vars.status === 'COMPLETED') {
        toast.success(`Batch completed! Next round (Batch ${data.nextBatch?.batchNumber ?? ''}) unlocked. ✨`);
      } else {
        toast.success(`Batch status updated to ${vars.status}`);
      }
      qc.invalidateQueries({ queryKey: ['table-sessions-active'] });
      qc.invalidateQueries({ queryKey: ['table-session-detail', vars.sessionId] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to update batch');
    },
  });

  // Close Table Session Mutation
  const closeSessionMutation = useMutation({
    mutationFn: async ({
      sessionId,
      paymentConfirmed,
      paymentMethod,
    }: {
      sessionId: string;
      paymentConfirmed: boolean;
      paymentMethod: string;
    }) => {
      const res = await api.post(`/table-sessions/${sessionId}/close`, {
        paymentConfirmed,
        counterPaymentMethod: paymentMethod,
      });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Table session closed successfully! Table is now available for new guests. 🏁');
      setCloseModalSession(null);
      setSelectedSessionId(null);
      setViewBillSessionId(null);
      qc.invalidateQueries({ queryKey: ['table-sessions-active'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to close table session');
    },
  });

  // Mark Session As Paid Mutation
  const markPaidMutation = useMutation({
    mutationFn: async ({
      sessionId,
      paymentMethod,
    }: {
      sessionId: string;
      paymentMethod: string;
    }) => {
      const res = await api.post(`/table-sessions/${sessionId}/mark-paid`, { paymentMethod });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Payment confirmed! Table session marked as PAID. 💰');
      setMarkPaidModalSession(null);
      qc.invalidateQueries({ queryKey: ['table-sessions-active'] });
      if (selectedSessionId) {
        qc.invalidateQueries({ queryKey: ['table-session-detail', selectedSessionId] });
      }
      if (viewBillSessionId) {
        qc.invalidateQueries({ queryKey: ['table-session-bill', viewBillSessionId] });
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to confirm payment');
    },
  });

  // Cancel Table Session & Orders Mutation
  const cancelSessionMutation = useMutation({
    mutationFn: async ({
      sessionId,
      reason,
    }: {
      sessionId: string;
      reason?: string;
    }) => {
      const res = await api.post(`/table-sessions/${sessionId}/cancel`, { reason });
      return res.data;
    },
    onSuccess: () => {
      toast.success('Table session cancelled. Table is now available. 🏁');
      setCancelModalSession(null);
      setSelectedSessionId(null);
      setViewBillSessionId(null);
      qc.invalidateQueries({ queryKey: ['table-sessions-active'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error || 'Failed to cancel session');
    },
  });

  const filteredSessions = sessions.filter(
    (s) =>
      s.tableNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.sessionCode.includes(searchQuery)
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'OPEN':
        return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
      case 'SUBMITTED':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/40 animate-pulse';
      case 'ACCEPTED':
      case 'PREPARING':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/40';
      case 'READY':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-black';
      case 'SERVED':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'COMPLETED':
        return 'bg-emerald-600/20 text-emerald-400 border-emerald-500/40';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <OwnerSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top Navigation Bar */}
        <header className="flex items-center justify-between px-3.5 sm:px-6 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm gap-2 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl hover:bg-muted shrink-0"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="font-display font-black text-base sm:text-xl text-foreground flex items-center gap-2 truncate">
                <Users className="w-5 h-5 text-primary shrink-0" />
                <span>Table Sessions &amp; Sequential Ordering</span>
              </h1>
              <p className="text-[11px] text-muted-foreground hidden sm:block">
                Manage group dining sessions, sequential rounds, food delivery, and consolidated bills.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <WaiterBell />
            <button
              onClick={() => setNewSessionModal(true)}
              className="px-3.5 py-2 bg-primary text-primary-foreground hover:bg-primary/90 font-bold text-xs sm:text-sm rounded-xl transition-all shadow-md flex items-center gap-1.5 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">Start Table Session</span>
              <span className="sm:hidden">Start</span>
            </button>
            <button
              onClick={() => refetch()}
              className="p-2 bg-card border border-border hover:bg-muted text-muted-foreground hover:text-foreground rounded-xl transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Subheader and Search Filter */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card p-4 rounded-2xl border border-border shadow-xs">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Search by table name or 4-digit code (e.g. Table 1, 4827)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-muted/40 border border-border rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-bold text-foreground">{sessions.length}</span> Active Dining Sessions
            </div>
          </div>

          {/* Active Sessions Grid */}
          {isLoading ? (
            <div className="py-24 text-center text-muted-foreground flex items-center justify-center gap-2 font-medium">
              <RefreshCw className="w-5 h-5 animate-spin text-primary" /> Loading active table sessions...
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="p-12 text-center space-y-3 bg-card rounded-3xl border border-dashed border-border max-w-xl mx-auto my-8">
              <div className="w-16 h-16 bg-muted/60 text-muted-foreground rounded-full flex items-center justify-center mx-auto">
                <UtensilsCrossed className="w-8 h-8 opacity-40" />
              </div>
              <h3 className="text-lg font-bold text-foreground">No Active Table Sessions</h3>
              <p className="text-xs sm:text-sm text-muted-foreground">
                When customers scan the QR code at their table or when staff seats guests, active table sessions with shared verification codes and sequential food rounds will appear here.
              </p>
              <button
                onClick={() => setNewSessionModal(true)}
                className="mt-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-bold rounded-xl hover:bg-primary/90 transition-all inline-flex items-center gap-1.5 shadow-sm"
              >
                <Plus className="w-4 h-4" /> Start Table Session Now
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
              {filteredSessions.map((session) => {
                const currentBatch = session.currentBatch;
                const canMarkServed = currentBatch && ['ACCEPTED', 'PREPARING', 'READY'].includes(currentBatch.status);

                return (
                  <motion.div
                    key={session.id}
                    layout
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-card border border-border rounded-3xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden"
                  >
                    <div>
                      {/* Card Header: Table name, Verification Code, Guests */}
                      <div className="flex items-start justify-between gap-2 pb-3 border-b border-border/70">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-display font-black text-lg text-foreground">
                              {session.tableNumber}
                            </h3>
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground flex items-center gap-1">
                              <Users className="w-3 h-3" /> {session.guestCount} Guests
                            </span>
                          </div>
                          <span className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5 font-mono">
                            <Clock className="w-3 h-3" /> Started{' '}
                            {new Date(session.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        {/* 4-Digit Shared Session Verification Code Badge */}
                        <div className="text-right">
                          <span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground block">
                            Shared Code
                          </span>
                          <span className="text-base font-mono font-black px-2.5 py-1 bg-primary/10 text-primary border border-primary/25 rounded-xl inline-block shadow-2xs">
                            #{session.sessionCode}
                          </span>
                        </div>
                      </div>

                      {/* Current Order Items Summary */}
                      <div className="mt-4 p-3.5 rounded-2xl bg-muted/40 border border-border/80 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-foreground flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-primary" />
                            {session.totalBatches > 1
                              ? `Order Items (Batch ${session.currentBatchNumber})`
                              : 'Order Items'}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-black uppercase border ${getStatusBadge(
                              session.currentBatchStatus
                            )}`}
                          >
                            {session.currentBatchStatus === 'SERVED'
                              ? 'SERVED'
                              : session.currentBatchStatus}
                          </span>
                        </div>

                        {currentBatch?.items && currentBatch.items.length > 0 ? (
                          <div className="space-y-1 pt-1">
                            {currentBatch.items.slice(0, 3).map((it) => (
                              <div
                                key={it.id}
                                className="text-xs text-muted-foreground flex items-center justify-between"
                              >
                                <span className="truncate max-w-[200px]">
                                  {it.quantity}x {it.itemName}
                                </span>
                                <span className="font-mono text-[11px] font-semibold text-foreground">
                                  ₹{it.subtotal.toFixed(2)}
                                </span>
                              </div>
                            ))}
                            {currentBatch.items.length > 3 && (
                              <p className="text-[10px] text-primary font-bold">
                                + {currentBatch.items.length - 3} more items in this order
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-[11px] italic text-muted-foreground">
                            Customers are currently selecting dishes.
                          </p>
                        )}

                        <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs">
                          <span className="text-muted-foreground font-medium">Batch Total:</span>
                          <span className="font-black text-foreground font-mono">
                            ₹{(currentBatch?.total || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>

                      {/* Total Session Bill Rollup */}
                      <div className="mt-3 px-3.5 py-2.5 rounded-xl bg-card border border-border flex items-center justify-between text-xs">
                        <div>
                          <span className="text-[10px] text-muted-foreground uppercase font-bold block">
                            {session.totalBatches > 1
                              ? `Total Bill (${session.totalBatches} Batches)`
                              : 'Total Bill'}
                          </span>
                          <span className="text-base font-black font-mono text-foreground">
                            ₹{session.sessionTotal.toFixed(2)}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${session.paymentStatus === 'PAID'
                              ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30'
                              : 'bg-amber-500/15 text-amber-600 border-amber-500/30'
                            }`}
                        >
                          {session.paymentStatus === 'PAID' ? '✓ PAID' : '⏳ UNPAID'}
                        </span>
                      </div>
                    </div>

                    {/* Waiter & Staff Actions */}
                    <div className="mt-5 pt-3 border-t border-border space-y-2">
                      {/* Food Serving Action (Only shown while food is preparing/ready) */}
                      {canMarkServed && (
                        <button
                          onClick={() =>
                            updateBatchMutation.mutate({
                              sessionId: session.id,
                              batchId: currentBatch.id,
                              status: 'SERVED',
                            })
                          }
                          disabled={updateBatchMutation.isPending}
                          className="w-full py-2.5 px-3 bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5"
                        >
                          <UtensilsCrossed className="w-3.5 h-3.5" /> Mark Food as SERVED to Table
                        </button>
                      )}

                        {/* Payment & Close Table Controls */ }
                      {session.paymentStatus === 'PAID' ? (
                        <button
                          onClick={() =>
                              closeSessionMutation.mutate({
                                sessionId: session.id,
                                paymentConfirmed: true,
                                paymentMethod: 'CASH',
                              })
                            }
                          disabled = { closeSessionMutation.isPending }
                          className = "w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5"
                              >
                            < CheckCircle2 className = "w-4 h-4" /> Close Table & amp; Free Table
                    </button>
                    ) : (
                    <button
                      onClick={() => setMarkPaidModalSession(session)}
                      className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5"
                    >
                      <Banknote className="w-4 h-4" /> Mark as Paid (₹{session.sessionTotal.toFixed(2)})
                    </button>
                      )}

                    {/* Secondary Action Buttons */}
                      <div className="grid grid-cols-4 gap-1.5 pt-1">
                        <button
                          onClick={() => setSelectedSessionId(session.id)}
                          className="py-1.5 px-1 bg-muted hover:bg-muted/80 rounded-xl text-xs font-semibold text-foreground text-center transition-colors truncate"
                          title="View all details & items"
                        >
                          Details
                        </button>
                        <button
                          onClick={() => setViewBillSessionId(session.id)}
                          className="py-1.5 px-1 bg-muted hover:bg-muted/80 rounded-xl text-xs font-semibold text-foreground text-center transition-colors truncate flex items-center justify-center gap-0.5"
                          title="Consolidated bill summary"
                        >
                          <Receipt className="w-3 h-3 text-muted-foreground" /> Bill
                        </button>
                        <button
                          onClick={() => {
                            if (session.paymentStatus === 'PAID') {
                              closeSessionMutation.mutate({
                                sessionId: session.id,
                                paymentConfirmed: true,
                                paymentMethod: 'CASH',
                              });
                            } else {
                              setCloseModalSession(session);
                            }
                          }}
                          className="py-1.5 px-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 rounded-xl text-xs font-bold text-center transition-colors truncate"
                          title="Finish dining & close table"
                        >
                          Close Table
                        </button>
                        <button
                          onClick={() => setCancelModalSession(session)}
                          className="py-1.5 px-1 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/20 rounded-xl text-xs font-bold text-center transition-colors truncate flex items-center justify-center gap-0.5"
                          title="Cancel order and free table"
                        >
                          <X className="w-3 h-3" /> Cancel
                        </button>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* MODAL 1: Start Manual Table Session */}
      <AnimatePresence>
        {newSessionModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-3xl p-6 w-full max-w-md shadow-2xl relative"
            >
              <button
                onClick={() => setNewSessionModal(false)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground absolute top-5 right-5"
              >
                <X className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display font-black text-lg text-foreground">Seat Table &amp; Start Session</h3>
                  <p className="text-xs text-muted-foreground">Generates a shared 4-digit code for all guests</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                    Table or Room Number *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Table 1, Table 4, Room 102"
                    value={newTableNum}
                    onChange={(e) => setNewTableNum(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-muted/40 border border-border rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                    Number of Guests (Seated)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={newGuests}
                    onChange={(e) => setNewGuests(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-muted/40 border border-border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground"
                  />
                </div>

                <div className="pt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNewSessionModal(false)}
                    className="flex-1 py-2.5 bg-muted hover:bg-muted/80 text-foreground font-semibold text-xs rounded-xl transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => createSessionMutation.mutate()}
                    disabled={createSessionMutation.isPending || !newTableNum.trim()}
                    className="flex-1 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {createSessionMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                    Start Dining Session
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 2: Full Session Detail (All Batches & Rounds) */}
      <AnimatePresence>
        {selectedSessionId && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-3xl p-6 w-full max-w-2xl max-h-[85vh] shadow-2xl flex flex-col relative"
            >
              <button
                onClick={() => setSelectedSessionId(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground absolute top-5 right-5"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="pb-4 border-b border-border flex items-center justify-between pr-8">
                <div>
                  <h3 className="font-display font-black text-xl text-foreground">
                    {sessionDetailData?.tableNumber} — Table Session Details
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    Shared Verification Code: <strong className="text-primary font-mono text-sm">#{sessionDetailData?.sessionCode}</strong>
                  </span>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto py-4 space-y-4">
                {detailLoading ? (
                  <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Loading session details...
                  </div>
                ) : !sessionDetailData?.batches || sessionDetailData.batches.length === 0 ? (
                  <p className="text-center text-xs text-muted-foreground py-8">No rounds placed yet.</p>
                ) : (
                  sessionDetailData.batches.map((batch: OrderBatch) => (
                    <div
                      key={batch.id}
                      className="p-4 rounded-2xl border border-border bg-muted/20 space-y-3"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-black text-foreground flex items-center gap-2">
                          <span>Round {batch.batchNumber}</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md border ${getStatusBadge(batch.status)}`}>
                            {batch.status}
                          </span>
                          {(batch as any).paymentStatus && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${(batch as any).paymentStatus === 'PAID' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'}`}>
                              {(batch as any).paymentStatus === 'PAID' ? '✓ PAID' : '⏳ UNPAID'}
                            </span>
                          )}
                        </span>
                        <div className="text-right">
                          <span className="font-mono font-black text-foreground block">
                            ₹{Number(batch.total || 0).toFixed(2)}
                          </span>
                          {(batch as any).order?.id && (
                            <span className="text-[10px] font-mono text-muted-foreground">
                              #{(batch as any).order.id.slice(-8).toUpperCase()}
                            </span>
                          )}
                        </div>
                      </div>

                      {batch.items && batch.items.length > 0 ? (
                        <div className="divide-y divide-border/60">
                          {batch.items.map((it) => (
                            <div key={it.id} className="py-2 flex items-start justify-between text-xs">
                              <div>
                                <span className="font-bold text-foreground">
                                  {it.quantity}x {it.itemName}
                                </span>
                                {it.addedBy && (
                                  <span className="text-[10px] text-muted-foreground block">
                                    Added by: {it.addedBy}
                                  </span>
                                )}
                                {it.specialInstructions && (
                                  <span className="text-[10px] text-amber-500 italic block">
                                    Note: {it.specialInstructions}
                                  </span>
                                )}
                              </div>
                              <span className="font-mono font-semibold text-foreground">
                                ₹{it.subtotal.toFixed(2)}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No items submitted for this round yet.</p>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="pt-3 border-t border-border flex justify-between items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setViewBillSessionId(selectedSessionId);
                    setSelectedSessionId(null);
                  }}
                  className="px-4 py-2 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <Receipt className="w-3.5 h-3.5" /> View Table Bill
                </button>
                <button
                  onClick={() => setSelectedSessionId(null)}
                  className="px-5 py-2.5 bg-muted hover:bg-muted/80 text-foreground font-semibold text-xs rounded-xl"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 3: Consolidated Session Bill */}
      <AnimatePresence>
        {viewBillSessionId && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-3xl p-6 w-full max-w-lg shadow-2xl flex flex-col relative max-h-[90vh]"
            >
              <button
                onClick={() => setViewBillSessionId(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground absolute top-5 right-5"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="pb-4 border-b border-border text-center">
                <div className="w-12 h-12 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-2">
                  <Receipt className="w-6 h-6" />
                </div>
                <h3 className="font-display font-black text-xl text-foreground">
                  {sessionBillData?.restaurant?.name || 'Restaurant'}
                </h3>
                <p className="text-xs text-muted-foreground font-mono">
                  {sessionBillData?.tableNumber} • Session Code: #{sessionBillData?.sessionCode}
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-black border">
                  {sessionBillData?.totals?.isPaid ? (
                    <span className="text-emerald-500 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> PAID {sessionBillData?.totals?.paymentMethod ? `(${sessionBillData.totals.paymentMethod})` : ''}
                    </span>
                  ) : (
                    <span className="text-amber-500 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 animate-pulse" /> PAYMENT PENDING
                    </span>
                  )}
                </div>
              </div>

              <div id="session-bill-printable" className="flex-1 overflow-y-auto py-4 space-y-4">
                {billLoading ? (
                  <div className="py-12 text-center text-muted-foreground flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-primary" /> Calculating consolidated bill...
                  </div>
                ) : !sessionBillData?.batches ? (
                  <p className="text-xs text-muted-foreground text-center">No bill data found.</p>
                ) : (
                  <>
                    <div className="space-y-3">
                      {sessionBillData.batches.map((batch: any) => (
                        <div key={batch.batchId || batch.batchNumber} className="p-3 bg-muted/30 rounded-xl border border-border/80">
                          <div className="flex items-center justify-between text-xs font-bold text-foreground mb-2">
                            <span className="flex items-center gap-1.5">
                              <span>Round {batch.batchNumber}</span>
                              <span className={`text-[9px] uppercase px-1.5 py-0.2 rounded border ${getStatusBadge(batch.status)}`}>
                                {batch.status}
                              </span>
                            </span>
                            <span className="font-mono">₹{Number(batch.total || 0).toFixed(2)}</span>
                          </div>
                          <div className="space-y-1.5">
                            {batch.items && batch.items.length > 0 ? (
                              batch.items.map((it: any) => (
                                <div key={it.id} className="text-xs text-muted-foreground flex justify-between items-center">
                                  <span>
                                    <strong className="text-foreground">{it.quantity}x</strong> {it.itemName}
                                  </span>
                                  <span className="font-mono font-medium text-foreground">₹{Number(it.subtotal || 0).toFixed(2)}</span>
                                </div>
                              ))
                            ) : (
                              <p className="text-[11px] text-muted-foreground italic">Items processed in kitchen</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Grand Totals */}
                    <div className="pt-3 border-t border-border space-y-1.5 text-xs">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Items Subtotal</span>
                        <span className="font-mono">₹{Number(sessionBillData.totals?.subtotal || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>GST &amp; Taxes (18%)</span>
                        <span className="font-mono">₹{Number(sessionBillData.totals?.tax || 0).toFixed(2)}</span>
                      </div>
                      {Number(sessionBillData.totals?.discount || 0) > 0 && (
                        <div className="flex justify-between text-emerald-500 font-bold">
                          <span>Discount Applied</span>
                          <span className="font-mono">-₹{Number(sessionBillData.totals.discount).toFixed(2)}</span>
                        </div>
                      )}
                      <div className="pt-2 border-t border-border flex justify-between text-base font-black text-foreground">
                        <span>Grand Total</span>
                        <span className="font-mono text-primary text-xl">
                          ₹{Number(sessionBillData.totals?.grandTotal || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="pt-3 border-t border-border flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="px-4 py-2.5 bg-card border border-border hover:bg-muted text-foreground font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors"
                >
                  <Printer className="w-4 h-4 text-primary" /> Print Bill
                </button>
                <button
                  onClick={() => setViewBillSessionId(null)}
                  className="px-5 py-2.5 bg-muted hover:bg-muted/80 text-foreground font-semibold text-xs rounded-xl"
                >
                  Close Bill
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 4: Close Table Session Confirmation */}
      <AnimatePresence>
        {closeModalSession && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-3xl p-6 w-full max-w-md shadow-2xl relative"
            >
              <button
                onClick={() => setCloseModalSession(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground absolute top-5 right-5"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center space-y-2 mb-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto ${closeModalSession.paymentStatus === 'PAID' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-amber-500/10 text-amber-500'}`}>
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <h3 className="font-display font-black text-lg text-foreground">
                    Close Table Session for {closeModalSession.tableNumber}?
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {closeModalSession.paymentStatus === 'PAID'
                      ? 'Payment is already settled. Close this table session to free the table for new diners.'
                      : 'Confirm that the guests have finished their meal and payment has been received at the counter.'}
                  </p>
                  <div className="p-3 bg-muted/40 rounded-xl font-mono text-sm font-black text-foreground flex items-center justify-between">
                    <span>Session Total: ₹{closeModalSession.sessionTotal.toFixed(2)}</span>
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-md border ${closeModalSession.paymentStatus === 'PAID' ? 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30' : 'bg-amber-500/15 text-amber-600 border-amber-500/30'}`}>
                      {closeModalSession.paymentStatus === 'PAID' ? '✓ PAID' : '⏳ UNPAID'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  {closeModalSession.paymentStatus === 'PAID' ? (
                    <button
                      onClick={() =>
                        closeSessionMutation.mutate({
                          sessionId: closeModalSession.id,
                          paymentConfirmed: true,
                          paymentMethod: 'CASH',
                        })
                      }
                      disabled={closeSessionMutation.isPending}
                      className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5"
                    >
                      <CheckCircle2 className="w-4 h-4" /> Close Session &amp; Free Table
                    </button>
                  ) : (
                    <>
                      <button
                        onClick={() =>
                          closeSessionMutation.mutate({
                            sessionId: closeModalSession.id,
                            paymentConfirmed: true,
                            paymentMethod: 'CASH',
                          })
                        }
                        disabled={closeSessionMutation.isPending}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5"
                      >
                        <Banknote className="w-4 h-4" /> Confirm Cash Payment &amp; Close Session
                      </button>
                      <button
                        onClick={() =>
                          closeSessionMutation.mutate({
                            sessionId: closeModalSession.id,
                            paymentConfirmed: true,
                            paymentMethod: 'COUNTER_UPI',
                          })
                        }
                        disabled={closeSessionMutation.isPending}
                        className="w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5"
                      >
                        <CreditCard className="w-4 h-4" /> Confirm UPI / Card Payment &amp; Close Session
                      </button>
                      <button
                        onClick={() =>
                          closeSessionMutation.mutate({
                            sessionId: closeModalSession.id,
                            paymentConfirmed: false,
                            paymentMethod: 'CASH',
                          })
                        }
                        disabled={closeSessionMutation.isPending}
                        className="w-full py-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5"
                      >
                        Close Table Without Settle (Keep Unpaid)
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => setCloseModalSession(null)}
                    className="w-full py-2.5 bg-muted hover:bg-muted/80 text-foreground font-semibold text-xs rounded-xl"
                  >
                    Cancel
                  </button>
                </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL 5: Mark As Paid Modal */}
      <AnimatePresence>
        {markPaidModalSession && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-3xl p-6 w-full max-w-md shadow-2xl relative"
            >
              <button
                onClick={() => setMarkPaidModalSession(null)}
                className="p-1 rounded-lg text-muted-foreground hover:text-foreground absolute top-5 right-5"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="text-center space-y-2 mb-4">
                <div className="w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto">
                  <Banknote className="w-6 h-6" />
                </div>
                <h3 className="font-display font-black text-lg text-foreground">
                  Confirm Payment for {markPaidModalSession.tableNumber}
                </h3>
                <p className="text-xs text-muted-foreground">
                  Select payment instrument used by guest at the counter.
                </p>
                <div className="p-3 bg-muted/40 rounded-xl font-mono text-sm font-black text-foreground">
                  Amount: ₹{markPaidModalSession.sessionTotal.toFixed(2)}
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <button
                  onClick={() =>
                      markPaidMutation.mutate({
                        sessionId: markPaidModalSession.id,
                        paymentMethod: 'CASH',
                      })
                    }
                  disabled = { markPaidMutation.isPending }
                  className = "w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5"
                      >
                <Banknote className="w-4 h-4" /> 💵 Cash Received
              </button>
              <button
                onClick={() =>
                    markPaidMutation.mutate({
                      sessionId: markPaidModalSession.id,
                      paymentMethod: 'COUNTER_UPI',
                    })
                  }
                  disabled = { markPaidMutation.isPending }
                  className = "w-full py-3 bg-primary hover:bg-primary/90 text-primary-foreground font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5"
                    >
              <CreditCard className="w-4 h-4" /> 📱 Counter UPI / Dynamic QR
            </button>
            <button
              onClick={() =>
                markPaidMutation.mutate({
                  sessionId: markPaidModalSession.id,
                  paymentMethod: 'CARD',
                })
              }
              disabled={markPaidMutation.isPending}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5"
            >
              <CreditCard className="w-4 h-4" /> 💳 Card / POS Machine
            </button>
            <button
              onClick={() => setMarkPaidModalSession(null)}
              className="w-full py-2.5 bg-muted hover:bg-muted/80 text-foreground font-semibold text-xs rounded-xl"
            >
              Cancel
            </button>
          </div>
            </motion.div>
    </div>
  )
}
      </AnimatePresence >

  {/* MODAL 6: Cancel Table Session & Orders Modal */ }
  <AnimatePresence>
{
  cancelModalSession && (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-card border border-border rounded-3xl p-6 w-full max-w-md shadow-2xl relative"
      >
        <button
          onClick={() => setCancelModalSession(null)}
          className="p-1 rounded-lg text-muted-foreground hover:text-foreground absolute top-5 right-5"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center space-y-2 mb-4">
          <div className="w-12 h-12 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h3 className="font-display font-black text-lg text-foreground">
            Cancel Table &amp; Orders for {cancelModalSession.tableNumber}?
          </h3>
          <p className="text-xs text-muted-foreground">
            This will cancel all ongoing food batches and orders for this table and immediately free the table for new diners.
          </p>
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl font-mono text-xs font-semibold text-red-600 dark:text-red-400">
            Shared Code: #{cancelModalSession.sessionCode} • Total: ₹{cancelModalSession.sessionTotal.toFixed(2)}
          </div>
        </div>

        <div className="space-y-2 pt-2">
          <button
            onClick={() =>
              cancelSessionMutation.mutate({
                sessionId: cancelModalSession.id,
                reason: 'Cancelled by restaurant staff',
              })
            }
            disabled={cancelSessionMutation.isPending}
            className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-1.5"
          >
            <X className="w-4 h-4" /> Confirm Cancel Order &amp; Free Table
          </button>
          <button
            onClick={() => setCancelModalSession(null)}
            className="w-full py-2.5 bg-muted hover:bg-muted/80 text-foreground font-semibold text-xs rounded-xl"
          >
            Go Back
          </button>
        </div>
      </motion.div>
    </div>
  )
}
      </AnimatePresence >
    </div >
  );
}

