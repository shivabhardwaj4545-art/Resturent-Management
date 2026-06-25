'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Store, Users, BarChart3, Settings, LogOut,
  Menu, TrendingUp, DollarSign, ShoppingBag, CheckCircle2,
  XCircle, Clock, ChevronRight, Shield
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';
import { toast } from 'sonner';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
  { label: 'Restaurants', icon: Store, href: '/admin/restaurants' },
  { label: 'Users', icon: Users, href: '/admin/users' },
  { label: 'Analytics', icon: BarChart3, href: '/admin/analytics' },
  { label: 'Settings', icon: Settings, href: '/admin/settings' },
];

export function AdminDashboard() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [period, setPeriod] = useState<'7d' | '30d'>('7d');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-analytics', period],
    queryFn: async () => {
      const response = await api.get(`/admin/analytics?period=${period}`);
      return response.data.data as {
        summary: {
          totalOrders: number;
          totalRevenue: number;
          platformCommission: number;
          totalUsers: number;
          totalRestaurants: number;
        };
        topRestaurants: Array<{
          restaurantId: string;
          name: string;
          totalRevenue: number;
          totalOrders: number;
          commissionEarned: number;
        }>;
        customerGrowth: Array<{ date: string; count: number }>;
      };
    },
  });

  const { data: pendingRestaurants } = useQuery({
    queryKey: ['admin-pending-restaurants'],
    queryFn: async () => {
      const response = await api.get('/admin/restaurants?status=pending&limit=5');
      return response.data.data.restaurants as Array<{
        id: string; name: string; city: string | null;
        owner: { name: string; email: string };
        createdAt: string;
      }>;
    },
  });

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally {
      logout(); router.push('/login');
    }
  };

  const approveRestaurant = async (id: string) => {
    try {
      await api.patch(`/admin/restaurants/${id}/approve`, { isApproved: true });
      toast.success('Restaurant approved!');
    } catch {
      toast.error('Failed to approve restaurant');
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar Backdrop */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed lg:relative left-0 top-0 h-full z-30 w-64 bg-card border-r border-border flex flex-col transition-transform lg:translate-x-0 ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
              <Shield className="w-4.5 h-4.5 text-white" />
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
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
              >
                <Icon className="w-4.5 h-4.5" />
                {item.label}
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

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-xl hover:bg-muted">
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display font-bold text-xl">Platform Overview</h1>
          </div>
          <div className="flex items-center gap-2">
            {(['7d', '30d'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  period === p ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                }`}
              >
                {p === '7d' ? '7 Days' : '30 Days'}
              </button>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: 'Total Revenue', value: `₹${((data?.summary.totalRevenue ?? 0) / 1000).toFixed(1)}K`, icon: DollarSign, color: 'text-green-600' },
              { label: 'Commission', value: `₹${((data?.summary.platformCommission ?? 0) / 1000).toFixed(1)}K`, icon: TrendingUp, color: 'text-purple-600' },
              { label: 'Total Orders', value: data?.summary.totalOrders ?? 0, icon: ShoppingBag, color: 'text-blue-600' },
              { label: 'Customers', value: data?.summary.totalUsers ?? 0, icon: Users, color: 'text-orange-600' },
              { label: 'Restaurants', value: data?.summary.totalRestaurants ?? 0, icon: Store, color: 'text-pink-600' },
            ].map((stat, i) => {
              const Icon = stat.icon;
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="bg-card border border-border rounded-2xl p-4"
                >
                  <Icon className={`w-5 h-5 ${stat.color} mb-2`} />
                  <p className="font-display text-2xl font-bold">{stat.value}</p>
                  <p className="text-muted-foreground text-xs mt-0.5">{stat.label}</p>
                </motion.div>
              );
            })}
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Top Restaurants by Revenue */}
            {data?.topRestaurants && (
              <div className="bg-card border border-border rounded-2xl p-5">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display font-semibold">Top Restaurants</h2>
                  <Link href="/admin/restaurants" className="text-sm text-primary flex items-center gap-1">
                    View all <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={data.topRestaurants.slice(0, 5)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => `₹${v/1000}K`} />
                    <Tooltip formatter={(v: number) => [`₹${v}`, 'Revenue']} />
                    <Bar dataKey="totalRevenue" fill="#E85D04" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Pending Approvals */}
            <div className="bg-card border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-semibold">Pending Approvals</h2>
                <Link href="/admin/restaurants?status=pending" className="text-sm text-primary flex items-center gap-1">
                  View all <ChevronRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="space-y-3">
                {pendingRestaurants?.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-8">No pending approvals 🎉</p>
                )}
                {pendingRestaurants?.map((restaurant) => (
                  <div key={restaurant.id} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{restaurant.name}</p>
                      <p className="text-xs text-muted-foreground">{restaurant.owner.name} • {restaurant.city ?? 'N/A'}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => approveRestaurant(restaurant.id)}
                        className="p-2 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20 rounded-lg transition-colors"
                      >
                        <CheckCircle2 className="w-4 h-4" />
                      </button>
                      <button className="p-2 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                        <XCircle className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
