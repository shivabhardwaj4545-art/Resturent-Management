'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Settings, Store, Users, BarChart3, LayoutDashboard, LogOut, Menu,
  Shield, CreditCard, Ticket, HandCoins, Plus, CheckCircle2, RefreshCw, Trash2, Star
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/admin/dashboard' },
  { label: 'Restaurants', icon: Store, href: '/admin/restaurants' },
  { label: 'Users', icon: Users, href: '/admin/users' },
  { label: 'Reviews', icon: Star, href: '/admin/reviews' },
  { label: 'Subscriptions', icon: CreditCard, href: '/admin/subscriptions' },
  { label: 'Coupons', icon: Ticket, href: '/admin/coupons' },
  { label: 'Payouts', icon: HandCoins, href: '/admin/payouts' },
  { label: 'Analytics', icon: BarChart3, href: '/admin/analytics' },
  { label: 'Settings', icon: Settings, href: '/admin/settings' },
];

type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  duration: number;
  features: string[] | Record<string, any>;
  isActive: boolean;
};

export function AdminSubscriptionsPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const { data: plansData, isLoading } = useQuery({
    queryKey: ['admin-subscriptions'],
    queryFn: async () => {
      const res = await api.get('/admin/subscriptions');
      return res.data.data as { plans: SubscriptionPlan[] };
    },
  });

  const [newPlan, setNewPlan] = useState({ name: '', price: '', duration: '30', features: '' });
  
  const createPlanMutation = useMutation({
    mutationFn: async () => {
      // Clean up features array
      const featuresList = newPlan.features.split('\n').map(f => f.trim()).filter(Boolean);
      await api.post('/admin/subscriptions', {
        name: newPlan.name,
        price: parseFloat(newPlan.price),
        duration: parseInt(newPlan.duration, 10),
        features: featuresList,
      });
    },
    onSuccess: () => {
      toast.success('Subscription plan created!');
      setNewPlan({ name: '', price: '', duration: '30', features: '' });
      qc.invalidateQueries({ queryKey: ['admin-subscriptions'] });
    },
    onError: () => toast.error('Failed to create plan'),
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
                <Icon className="w-4.5 h-4.5" />{item.label}
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
            <h1 className="font-display font-bold text-xl">Subscriptions & Plans</h1>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 items-start">
            
            {/* Active Plans Grid */}
            <div className="xl:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-lg">Active Billing Tiers</h2>
                <button 
                  onClick={() => qc.invalidateQueries({ queryKey: ['admin-subscriptions'] })}
                  className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
              </div>

              {isLoading ? (
                <div className="grid md:grid-cols-2 gap-4">
                  {[1, 2].map((i) => (
                    <div key={i} className="bg-card border border-border rounded-2xl p-6 h-56 animate-pulse" />
                  ))}
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-6">
                  {plansData?.plans.map((plan) => {
                    // Normalize features JSON
                    const features = Array.isArray(plan.features) 
                      ? plan.features 
                      : typeof plan.features === 'object' && plan.features !== null
                        ? Object.keys(plan.features)
                        : [];

                    return (
                      <motion.div
                        key={plan.id}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="bg-card border border-border rounded-2xl p-6 flex flex-col justify-between shadow-sm relative overflow-hidden"
                      >
                        <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-bl-full pointer-events-none" />
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <span className="font-semibold text-lg font-display text-foreground">{plan.name}</span>
                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                              Active
                            </span>
                          </div>
                          
                          <div className="flex items-baseline gap-1 mb-5">
                            <span className="text-3xl font-bold font-display">₹{plan.price}</span>
                            <span className="text-xs text-muted-foreground">/ {plan.duration} days</span>
                          </div>

                          <div className="space-y-2.5 border-t border-border/60 pt-4">
                            <p className="text-xs font-semibold uppercase text-muted-foreground tracking-wider mb-2">Features</p>
                            {features.map((feature, idx) => (
                              <div key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                                <CheckCircle2 className="w-4 h-4 text-green-500 mt-0.5 shrink-0" />
                                <span>{String(feature)}</span>
                              </div>
                            ))}
                            {features.length === 0 && (
                              <p className="text-xs italic text-muted-foreground">No features specified</p>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                  {(!plansData?.plans || plansData.plans.length === 0) && (
                    <div className="col-span-2 border border-dashed border-border rounded-2xl p-12 text-center">
                      <p className="text-muted-foreground text-sm">No subscription plans created yet.</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Create Plan form */}
            <div className="bg-card border border-border rounded-2xl p-6 shadow-sm space-y-4">
              <h2 className="font-display font-semibold text-lg">Create New Plan</h2>
              <p className="text-xs text-muted-foreground">Create subscription tiers for restaurant owners registering on the platform.</p>
              
              <div className="space-y-3.5 pt-2">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wider">Plan Name</label>
                  <input
                    value={newPlan.name}
                    onChange={(e) => setNewPlan(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Pro Platinum"
                    className="w-full px-3.5 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wider">Price (₹)</label>
                    <input
                      type="number"
                      value={newPlan.price}
                      onChange={(e) => setNewPlan(p => ({ ...p, price: e.target.value }))}
                      placeholder="e.g. 1999"
                      className="w-full px-3.5 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wider">Duration (days)</label>
                    <input
                      type="number"
                      value={newPlan.duration}
                      onChange={(e) => setNewPlan(p => ({ ...p, duration: e.target.value }))}
                      placeholder="30"
                      className="w-full px-3.5 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground block mb-1.5 uppercase tracking-wider">Features (one per line)</label>
                  <textarea
                    value={newPlan.features}
                    onChange={(e) => setNewPlan(p => ({ ...p, features: e.target.value }))}
                    placeholder="Unlimited Menu Items&#10;Advanced AI Recommendations&#10;WhatsApp Custom Notifications&#10;Priority 24/7 Support"
                    rows={6}
                    className="w-full px-3.5 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
                  />
                </div>

                <button
                  onClick={() => createPlanMutation.mutate()}
                  disabled={!newPlan.name || !newPlan.price || createPlanMutation.isPending}
                  className="w-full flex items-center gap-2 justify-center px-4 py-3 bg-primary text-primary-foreground rounded-xl font-semibold text-sm hover:bg-primary/95 disabled:opacity-50 transition-colors shadow-md shadow-primary/10 mt-2"
                >
                  <Plus className="w-4 h-4" />
                  {createPlanMutation.isPending ? 'Creating...' : 'Create Billing Plan'}
                </button>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
