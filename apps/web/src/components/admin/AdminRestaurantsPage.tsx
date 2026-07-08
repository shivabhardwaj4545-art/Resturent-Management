'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Store, Search, CheckCircle2, XCircle, Clock, Filter,
  LayoutDashboard, Users, BarChart3, Settings, LogOut,
  Menu, Shield, ChevronRight, Eye, AlertTriangle, RefreshCw,
  Plus, X, Loader2, CreditCard, Ticket, HandCoins
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
  { label: 'Subscriptions', icon: CreditCard, href: '/admin/subscriptions' },
  { label: 'Coupons', icon: Ticket, href: '/admin/coupons' },
  { label: 'Payouts', icon: HandCoins, href: '/admin/payouts' },
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

  // Create Restaurant State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createSlug, setCreateSlug] = useState('');
  const [createCuisine, setCreateCuisine] = useState('');
  const [createCity, setCreateCity] = useState('');
  const [createPhone, setCreatePhone] = useState('');
  const [createAddress, setCreateAddress] = useState('');
  const [createOwnerName, setCreateOwnerName] = useState('');
  const [createOwnerEmail, setCreateOwnerEmail] = useState('');
  const [createOwnerPhone, setCreateOwnerPhone] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreateRestaurant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createName || !createOwnerName || !createOwnerEmail) {
      toast.error('Name, Owner Name, and Owner Email are required.');
      return;
    }
    setCreating(true);
    try {
      await api.post('/admin/restaurants', {
        name: createName,
        slug: createSlug || undefined,
        cuisineType: createCuisine || undefined,
        city: createCity || undefined,
        phone: createPhone || undefined,
        address: createAddress || undefined,
        ownerName: createOwnerName,
        ownerEmail: createOwnerEmail,
        ownerPhone: createOwnerPhone || undefined,
      });
      toast.success('Restaurant created successfully! 🎉');
      setShowCreateModal(false);
      // Reset form
      setCreateName('');
      setCreateSlug('');
      setCreateCuisine('');
      setCreateCity('');
      setCreatePhone('');
      setCreateAddress('');
      setCreateOwnerName('');
      setCreateOwnerEmail('');
      setCreateOwnerPhone('');
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
    } catch (err: any) {
      const errMsg = err.response?.data?.error || err.response?.data?.message || 'Failed to create restaurant';
      toast.error(errMsg);
    } finally {
      setCreating(false);
    }
  };

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
    mutationFn: async ({ id, suspend }: { id: string; suspend: boolean }) => {
      await api.patch(`/admin/restaurants/${id}/suspend`, { isSuspended: suspend });
    },
    onSuccess: (_, { suspend }) => {
      toast.success(suspend ? 'Restaurant suspended' : 'Restaurant reactivated');
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
    },
    onError: () => toast.error('Action failed to update status'),
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
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/95 text-xs font-semibold rounded-xl transition-all shadow-md shadow-primary/10"
            >
              <Plus className="w-3.5 h-3.5" /> Add Restaurant
            </button>
            <button onClick={() => refetch()} className="p-2 rounded-xl hover:bg-muted transition-colors text-muted-foreground">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
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
                              <div className="flex flex-col gap-1 items-start">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${badge.cls}`}>
                                  {badge.label}
                                </span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-medium border ${r.isOpen ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' : 'bg-rose-500/10 text-rose-500 border-rose-500/20'}`}>
                                  {r.isOpen ? '🟢 Open' : '🔴 Closed'}
                                </span>
                              </div>
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
                                {r.isApproved && (
                                  <button
                                    onClick={() => suspendMutation.mutate({ id: r.id, suspend: !r.isSuspended })}
                                    className={`p-1.5 rounded-lg transition-colors ${r.isSuspended ? 'text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20' : 'text-orange-500 hover:bg-orange-100 dark:hover:bg-orange-900/20'}`}
                                    title={r.isSuspended ? "Reactivate" : "Suspend"}
                                  >
                                    {r.isSuspended ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
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
      {/* Create Restaurant Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-border w-full max-w-lg rounded-2xl shadow-2xl relative my-8"
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="font-display font-bold text-base text-foreground">Add New Restaurant</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRestaurant} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Restaurant Details</h4>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Restaurant Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Burger Point"
                      value={createName}
                      onChange={(e) => setCreateName(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Custom URL Slug (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. burger-point"
                      value={createSlug}
                      onChange={(e) => setCreateSlug(e.target.value)}
                      className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Cuisine Type (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Fast Food, Italian"
                      value={createCuisine}
                      onChange={(e) => setCreateCuisine(e.target.value)}
                      className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">City (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Mumbai"
                      value={createCity}
                      onChange={(e) => setCreateCity(e.target.value)}
                      className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    />
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Phone (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. 9876543210"
                      value={createPhone}
                      onChange={(e) => setCreatePhone(e.target.value)}
                      className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Full Address (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. 12, MG Road"
                      value={createAddress}
                      onChange={(e) => setCreateAddress(e.target.value)}
                      className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <h4 className="text-xs font-bold text-primary uppercase tracking-wider">Owner Account Details</h4>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Owner Full Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Rajan Sharma"
                      value={createOwnerName}
                      onChange={(e) => setCreateOwnerName(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Owner Email Address *</label>
                    <input
                      type="email"
                      placeholder="e.g. owner@example.com"
                      value={createOwnerEmail}
                      onChange={(e) => setCreateOwnerEmail(e.target.value)}
                      required
                      className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground mb-1 block">Owner Phone Number (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. 9876543211"
                    value={createOwnerPhone}
                    onChange={(e) => setCreateOwnerPhone(e.target.value)}
                    className="w-full px-3 py-2 bg-muted rounded-xl text-xs border border-border focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ℹ️ If a user with this email does not exist, a new Owner account will be created with default password: <code className="bg-muted px-1.5 py-0.5 rounded text-red-500 font-mono">Owner@123456</code>.
                  </p>
                </div>
              </div>

              <div className="flex gap-2 justify-end border-t border-border pt-4 mt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl border border-border text-xs font-semibold hover:bg-muted text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="px-5 py-2 rounded-xl text-white bg-primary hover:bg-primary/95 text-xs font-semibold disabled:opacity-60 flex items-center gap-1.5 transition-all shadow-md shadow-primary/10"
                >
                  {creating && <Loader2 className="w-3 animate-spin" />}
                  Create Restaurant
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      </main>
    </div>
  );
}
