'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Store, Search, CheckCircle2, XCircle, Clock, Filter,
  LayoutDashboard, Users, BarChart3, Settings, LogOut,
  Menu, Shield, ChevronRight, Eye, AlertTriangle, RefreshCw
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { toast } from 'sonner';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
  { label: 'Restaurants', icon: Store, href: '/admin/restaurants' },
  { label: 'Users', icon: Users, href: '/admin/users' },
  { label: 'Analytics', icon: BarChart3, href: '/admin/analytics' },
  { label: 'Settings', icon: Settings, href: '/admin/settings' },
];

type Restaurant = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  isApproved: boolean;
  isSuspended: boolean;
  isOpen: boolean;
  createdAt: string;
  owner: { name: string; email: string };
  _count?: { orders: number };
};

const STATUS_FILTERS = ['all', 'pending', 'approved', 'suspended'];

export function AdminRestaurantsPage() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(searchParams.get('status') ?? 'all');
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-restaurants', status, search, page],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: '12',
        ...(status !== 'all' && { status }),
        ...(search && { search }),
      });
      const res = await api.get(`/admin/restaurants?${params}`);
      return {
        restaurants: res.data.data.restaurants,
        pagination: res.data.pagination,
      } as {
        restaurants: Restaurant[];
        pagination: { total: number; page: number; totalPages: number };
      };
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, approve }: { id: string; approve: boolean }) => {
      await api.patch(`/admin/restaurants/${id}/approve`, { isApproved: approve });
    },
    onSuccess: (_, { approve }) => {
      toast.success(approve ? 'Restaurant approved!' : 'Restaurant rejected');
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
    },
    onError: () => toast.error('Action failed'),
  });

  const suspendMutation = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/admin/restaurants/${id}/suspend`);
    },
    onSuccess: () => {
      toast.success('Restaurant suspended');
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
    },
    onError: () => toast.error('Failed to suspend restaurant'),
  });

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally {
      logout(); router.push('/login');
    }
  };

  const getStatusBadge = (r: Restaurant) => {
    if (r.isSuspended) return { label: 'Suspended', cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' };
    if (!r.isApproved) return { label: 'Pending', cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' };
    return { label: 'Approved', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' };
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      <aside className={`fixed lg:relative left-0 top-0 h-full z-30 w-64 bg-card border-r border-border flex flex-col transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-display font-bold text-sm">Super Admin</p>
              <p className="text-xs text-muted-foreground">Platform Control</p>
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
            <div className="w-9 h-9 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center">
              <span className="text-sm font-bold text-purple-600 dark:text-purple-400">{user?.name?.[0] ?? 'A'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground">Super Admin</p>
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
            <h1 className="font-display font-bold text-xl">Restaurant Management</h1>
          </div>
          <button onClick={() => refetch()} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
            <RefreshCw className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search restaurants..."
                className="w-full pl-9 pr-4 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
            <div className="flex gap-2">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => { setStatus(f); setPage(1); }}
                  className={`px-3 py-2 rounded-xl text-xs font-medium capitalize transition-all ${status === f ? 'bg-primary text-primary-foreground' : 'bg-card border border-border text-muted-foreground hover:bg-muted'}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-20 skeleton rounded-2xl" />
              ))}
            </div>
          ) : (
            <>
              <div className="bg-card border border-border rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Restaurant</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Owner</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden md:table-cell">Location</th>
                        <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                        <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {data?.restaurants.map((r) => {
                        const badge = getStatusBadge(r);
                        return (
                          <motion.tr
                            key={r.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="hover:bg-muted/30 transition-colors"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500/20 to-amber-500/20 border border-orange-500/20 flex items-center justify-center">
                                  <Store className="w-4 h-4 text-orange-500" />
                                </div>
                                <div>
                                  <p className="font-semibold text-sm">{r.name}</p>
                                  <p className="text-xs text-muted-foreground">/{r.slug}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 hidden sm:table-cell">
                              <p className="text-sm">{r.owner.name}</p>
                              <p className="text-xs text-muted-foreground">{r.owner.email}</p>
                            </td>
                            <td className="px-4 py-3 hidden md:table-cell">
                              <p className="text-sm text-muted-foreground">{r.city ?? '—'}</p>
                            </td>
                            <td className="px-4 py-3">
                              <span className={`text-xs px-2 py-1 rounded-full font-medium ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center justify-end gap-2">
                                {!r.isApproved && !r.isSuspended && (
                                  <>
                                    <button
                                      onClick={() => approveMutation.mutate({ id: r.id, approve: true })}
                                      className="p-1.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                                      title="Approve"
                                    >
                                      <CheckCircle2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => approveMutation.mutate({ id: r.id, approve: false })}
                                      className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                                      title="Reject"
                                    >
                                      <XCircle className="w-4 h-4" />
                                    </button>
                                  </>
                                )}
                                {r.isApproved && !r.isSuspended && (
                                  <button
                                    onClick={() => suspendMutation.mutate(r.id)}
                                    className="p-1.5 text-orange-500 hover:bg-orange-100 dark:hover:bg-orange-900/20 rounded-lg transition-colors"
                                    title="Suspend"
                                  >
                                    <AlertTriangle className="w-4 h-4" />
                                  </button>
                                )}
                                <Link
                                  href={`/r/${r.slug}`}
                                  target="_blank"
                                  className="p-1.5 text-blue-500 hover:bg-blue-100 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                                  title="View Menu"
                                >
                                  <Eye className="w-4 h-4" />
                                </Link>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {data?.restaurants.length === 0 && (
                    <div className="text-center py-16 text-muted-foreground">
                      <Store className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">No restaurants found</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Pagination */}
              {data && data.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Total: {data.pagination.total} restaurants
                  </p>
                  <div className="flex gap-2">
                    <button
                      disabled={page === 1}
                      onClick={() => setPage(p => p - 1)}
                      className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    <span className="px-3 py-1.5 text-sm">
                      {page} / {data.pagination.totalPages}
                    </span>
                    <button
                      disabled={page === data.pagination.totalPages}
                      onClick={() => setPage(p => p + 1)}
                      className="px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
