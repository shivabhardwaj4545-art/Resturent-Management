'use client';

import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BellRing,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  X,
  ShieldCheck,
  Check,
  Trash2,
  Sparkles,
  Receipt,
  Menu,
  PhoneCall,
  ChevronRight,
  Filter,
  Droplets,
  Bell,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import api, { getSocketUrl } from '@/services/api';
import { toast } from 'sonner';
import { io } from 'socket.io-client';
import { WaiterBell } from '@/components/owner/WaiterBell';
import { OwnerSidebar } from '@/components/owner/OwnerSidebar';
import { formatTableLabel } from '@/utils/tableCode';

interface WaiterRequestItem {
  id: string;
  restaurantId: string;
  tableNumber: string;
  sessionId: string | null;
  requestType: string;
  reason: string | null;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
  deviceReference: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  session?: {
    id: string;
    sessionCode: string;
    tableAccessCode?: string | null;
    status: string;
    paymentStatus: string;
    totalAmount: number;
    createdAt: string;
  } | null;
}

function getServiceTypeInfo(type: string) {
  switch (type) {
    case 'WATER':
      return { label: 'Water Requested', icon: Droplets, color: 'text-blue-600 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800' };
    case 'BILL':
      return { label: 'Bill Requested', icon: Receipt, color: 'text-purple-600 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800' };
    case 'CLEANING':
      return { label: 'Table Cleaning', icon: Sparkles, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' };
    default:
      return { label: 'Call Waiter', icon: BellRing, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' };
  }
}

export default function WaiterRequestsPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();

  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED'>('ALL');
  const [selectedRequestToClear, setSelectedRequestToClear] = useState<WaiterRequestItem | null>(null);

  // Authenticate
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/owner/waiter-requests');
    }
  }, [isAuthenticated, router]);

  // Fetch waiter assistance requests
  const {
    data: requestsData,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ['owner-waiter-requests'],
    queryFn: async () => {
      const res = await api.get('/owner/waiter-requests');
      return res.data?.data as {
        requests: WaiterRequestItem[];
        pendingCount: number;
      };
    },
    refetchInterval: 10000,
  });

  // Real-time socket listener
  useEffect(() => {
    const socket = io(getSocketUrl(), {
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });

    socket.on('connect', () => {
      if (user?.restaurantId) {
        socket.emit('join-restaurant', user.restaurantId);
      }
    });

    socket.on('waiter-call', () => {
      queryClient.invalidateQueries({ queryKey: ['owner-waiter-requests'] });
      toast.info('New waiter call received from table!');
    });

    socket.on('waiter:called', () => {
      queryClient.invalidateQueries({ queryKey: ['owner-waiter-requests'] });
      toast.info('Customer requested assistance at table!');
    });

    socket.on('table:session:update', () => {
      queryClient.invalidateQueries({ queryKey: ['owner-waiter-requests'] });
    });

    return () => {
      socket.disconnect();
    };
  }, [user?.restaurantId, queryClient]);

  // Acknowledge mutation
  const acknowledgeMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await api.patch(`/owner/waiter-requests/${requestId}/acknowledge`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-waiter-requests'] });
      toast.success('Request acknowledged.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to acknowledge request.');
    },
  });

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const res = await api.patch(`/owner/waiter-requests/${requestId}/resolve`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-waiter-requests'] });
      toast.success('Request marked as resolved.');
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to resolve request.');
    },
  });

  // Clear Table from Waiter Request mutation
  const clearTableMutation = useMutation({
    mutationFn: async ({ requestId, forceClear }: { requestId: string; forceClear?: boolean }) => {
      const res = await api.post(`/owner/waiter-requests/${requestId}/clear-table`, { forceClear });
      return res.data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['owner-waiter-requests'] });
      queryClient.invalidateQueries({ queryKey: ['owner-table-clearance'] });
      toast.success(data?.message || 'Previous session closed and table released for new guests!');
      setSelectedRequestToClear(null);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to clear table.');
    },
  });

  const requests = requestsData?.requests || [];
  const pendingCount = requestsData?.pendingCount || 0;
  const acknowledgedCount = requests.filter((r) => r.status === 'ACKNOWLEDGED').length;
  const resolvedCount = requests.filter((r) => r.status === 'RESOLVED').length;

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'ALL') return requests;
    return requests.filter((r) => r.status === statusFilter);
  }, [requests, statusFilter]);

  const formatTimeAgo = (dateStr: string) => {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    return `${hours}h ago`;
  };

  return (
    <div className="flex h-screen bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 overflow-hidden font-sans">
      {/* Sidebar */}
      <OwnerSidebar
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <header className="h-16 px-4 md:px-6 bg-white dark:bg-neutral-900 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between shrink-0 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileSidebarOpen(true)}
              className="md:hidden p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2">
              <div className="p-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-xl">
                <BellRing className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-lg md:text-xl font-bold tracking-tight">Waiter Requests</h1>
                <p className="text-xs text-neutral-500 hidden sm:block">
                  Live table assistance & physical occupancy resolution
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => refetch()}
              disabled={isRefetching}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
              title="Refresh requests"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <WaiterBell />
          </div>
        </header>

        {/* Scrollable Container */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6">
          {/* Stats Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div
              onClick={() => setStatusFilter('PENDING')}
              className={`cursor-pointer p-4 rounded-xl border transition ${
                statusFilter === 'PENDING'
                  ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/20 shadow-sm'
                  : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Pending Assistance
                </span>
                <span className="relative flex h-2.5 w-2.5">
                  {pendingCount > 0 && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  )}
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${pendingCount > 0 ? 'bg-amber-500' : 'bg-neutral-400'}`}></span>
                </span>
              </div>
              <div className="mt-2 text-2xl font-bold text-amber-600 dark:text-amber-400">
                {pendingCount}
              </div>
              <p className="text-xs text-neutral-500 mt-1">Requires immediate attention</p>
            </div>

            <div
              onClick={() => setStatusFilter('ACKNOWLEDGED')}
              className={`cursor-pointer p-4 rounded-xl border transition ${
                statusFilter === 'ACKNOWLEDGED'
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm'
                  : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Acknowledged / In Progress
                </span>
                <Clock className="w-4 h-4 text-blue-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-blue-600 dark:text-blue-400">
                {acknowledgedCount}
              </div>
              <p className="text-xs text-neutral-500 mt-1">Staff is attending to table</p>
            </div>

            <div
              onClick={() => setStatusFilter('RESOLVED')}
              className={`cursor-pointer p-4 rounded-xl border transition ${
                statusFilter === 'RESOLVED'
                  ? 'border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm'
                  : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                  Resolved History
                </span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {resolvedCount}
              </div>
              <p className="text-xs text-neutral-500 mt-1">Completed assistance requests</p>
            </div>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-neutral-900 p-2 rounded-xl border border-neutral-200 dark:border-neutral-800">
            <div className="flex items-center gap-1">
              {(['ALL', 'PENDING', 'ACKNOWLEDGED', 'RESOLVED'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setStatusFilter(tab)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition ${
                    statusFilter === tab
                      ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  }`}
                >
                  {tab === 'ALL'
                    ? `All (${requests.length})`
                    : tab === 'PENDING'
                    ? `Pending (${pendingCount})`
                    : tab === 'ACKNOWLEDGED'
                    ? `In Progress (${acknowledgedCount})`
                    : `Resolved (${resolvedCount})`}
                </button>
              ))}
            </div>

            <Link
              href="/owner/table-clearance"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:underline px-2 py-1"
            >
              <span>Go to Table Clearance Dashboard</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Requests List */}
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <RefreshCw className="w-8 h-8 text-neutral-400 animate-spin mb-3" />
              <p className="text-sm text-neutral-500">Loading assistance requests...</p>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="py-20 bg-white dark:bg-neutral-900 rounded-2xl border border-neutral-200 dark:border-neutral-800 flex flex-col items-center justify-center text-center p-6">
              <div className="p-3 bg-neutral-100 dark:bg-neutral-800 rounded-full mb-3">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <h3 className="text-base font-semibold">No requests found</h3>
              <p className="text-xs text-neutral-500 mt-1 max-w-sm">
                {statusFilter === 'PENDING'
                  ? 'All tables are clear! There are no pending waiter requests.'
                  : 'No waiter requests matching the selected filter.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {filteredRequests.map((req) => {
                  const isPending = req.status === 'PENDING';
                  const isAcknowledged = req.status === 'ACKNOWLEDGED';
                  const isResolved = req.status === 'RESOLVED';
                  const typeInfo = getServiceTypeInfo(req.requestType);
                  const TypeIcon = typeInfo.icon;

                  return (
                    <motion.div
                      key={req.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className={`p-4 md:p-5 rounded-2xl border transition bg-white dark:bg-neutral-900 ${
                        isPending
                          ? 'border-amber-400/60 dark:border-amber-500/40 shadow-sm shadow-amber-500/5'
                          : isAcknowledged
                          ? 'border-blue-400/50 dark:border-blue-500/30'
                          : 'border-neutral-200 dark:border-neutral-800 opacity-80'
                      }`}
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Left: Table & Context */}
                        <div className="space-y-1.5 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base md:text-lg font-bold text-neutral-900 dark:text-neutral-100">
                              {formatTableLabel(req.tableNumber)}
                            </span>

                            {/* Service Type Badge */}
                            <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${typeInfo.color}`}>
                              <TypeIcon className="w-3.5 h-3.5" />
                              <span>{typeInfo.label}</span>
                            </span>

                            {/* Status Badge */}
                            {isPending && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                                Pending Action
                              </span>
                            )}
                            {isAcknowledged && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                                <Clock className="w-3 h-3" />
                                Acknowledged
                              </span>
                            )}
                            {isResolved && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
                                <Check className="w-3 h-3" />
                                Resolved
                              </span>
                            )}

                            <span className="text-xs text-neutral-400 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatTimeAgo(req.createdAt)}
                            </span>
                          </div>

                          {/* Reason / Notes */}
                          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
                            {req.reason ? `Note: "${req.reason}"` : 'Assistance requested at table'}
                          </p>

                          {/* Session context */}
                          {req.session && (
                            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500 pt-1">
                              <span>Session: <strong className="font-mono text-neutral-700 dark:text-neutral-300">#{req.session.sessionCode}</strong></span>
                              <span>Total: <strong>₹{req.session.totalAmount?.toFixed(2)}</strong></span>
                              <span>
                                Payment: <span className={`font-semibold ${req.session.paymentStatus === 'PAID' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>{req.session.paymentStatus}</span>
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Right: Actions */}
                        <div className="flex flex-wrap items-center gap-2 shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-neutral-100 dark:border-neutral-800">
                          {isPending && (
                            <button
                              onClick={() => acknowledgeMutation.mutate(req.id)}
                              disabled={acknowledgeMutation.isPending}
                              className="px-3.5 py-2 text-xs font-medium rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                            >
                              <Clock className="w-3.5 h-3.5" />
                              <span>Acknowledge</span>
                            </button>
                          )}

                          {!isResolved && (
                            <button
                              onClick={() => resolveMutation.mutate(req.id)}
                              disabled={resolveMutation.isPending}
                              className="px-3.5 py-2 text-xs font-medium rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition flex items-center gap-1.5 cursor-pointer"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Resolve Request</span>
                            </button>
                          )}

                          {/* If guest reports physically empty table, provide direct 1-click clearance */}
                          {req.sessionId && req.requestType === 'TABLE_OCCUPIED_ASSISTANCE' && (
                            <button
                              onClick={() => setSelectedRequestToClear(req)}
                              className="px-3.5 py-2 text-xs font-medium rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition flex items-center gap-1.5 shadow-sm cursor-pointer"
                              title="Clear previous session if table is physically empty"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              <span>Table Is Empty — Release Table</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </main>
      </div>

      {/* Confirmation Modal to Clear Table from Waiter Request */}
      <AnimatePresence>
        {selectedRequestToClear && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-base">Release {formatTableLabel(selectedRequestToClear.tableNumber)}</h3>
                    <p className="text-xs text-neutral-500">Confirm physical table clearance</p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedRequestToClear(null)}
                  className="p-1 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-3.5 bg-neutral-50 dark:bg-neutral-800/50 rounded-xl text-xs space-y-1.5 border border-neutral-200/60 dark:border-neutral-800">
                <div className="flex justify-between">
                  <span className="text-neutral-500">Table:</span>
                  <span className="font-semibold">{formatTableLabel(selectedRequestToClear.tableNumber)}</span>
                </div>
                {selectedRequestToClear.session && (
                  <>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Session Code:</span>
                      <span className="font-mono font-semibold">#{selectedRequestToClear.session.sessionCode}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-neutral-500">Payment Status:</span>
                      <span className={`font-semibold ${selectedRequestToClear.session.paymentStatus === 'PAID' ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {selectedRequestToClear.session.paymentStatus}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex justify-between">
                  <span className="text-neutral-500">Reason Reported:</span>
                  <span className="text-right text-neutral-700 dark:text-neutral-300 font-medium">
                    {selectedRequestToClear.reason}
                  </span>
                </div>
              </div>

              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Clearing this table will close the previous dining session, revoke all customer access codes for this table, and immediately release the QR code for incoming guests.
              </p>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  onClick={() => setSelectedRequestToClear(null)}
                  className="px-4 py-2 text-xs font-medium rounded-xl border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => clearTableMutation.mutate({ requestId: selectedRequestToClear.id, forceClear: true })}
                  disabled={clearTableMutation.isPending}
                  className="px-4 py-2 text-xs font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition flex items-center gap-1.5 shadow-sm"
                >
                  {clearTableMutation.isPending ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5" />
                  )}
                  <span>Confirm & Release Table</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
