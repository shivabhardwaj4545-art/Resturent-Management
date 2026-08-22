'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Settings, Store, Users, BarChart3, LayoutDashboard, LogOut, Menu,
  Shield, Save, Percent, DollarSign, Plus, Trash2, CreditCard, Ticket, HandCoins
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
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

type PlatformConfig = {
  commissionRate: number;
  gstRate: number;
  maxOrdersPerHour: number;
  maintenanceMode: boolean;
};

type SubscriptionPlan = {
  id: string;
  name: string;
  price: number;
  duration: number;
  features: string[];
  isActive: boolean;
};

type LoyaltySettings = {
  pointsPerSpendRupees: number;
  pointsPerDiscountRupee: number;
  minPointsToRedeem: number;
  conversionRuleText: string;
  increaseRuleText: string;
  decreaseRuleText: string;
};

export function AdminSettingsPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [config, setConfig] = useState<PlatformConfig>({
    commissionRate: 5, gstRate: 18, maxOrdersPerHour: 100, maintenanceMode: false
  });

  const [loyalty, setLoyalty] = useState<LoyaltySettings>({
    pointsPerSpendRupees: 10,
    pointsPerDiscountRupee: 50,
    minPointsToRedeem: 50,
    conversionRuleText: '50 Loyalty Points = ₹1.00 Discount. Every 50 points saved gives you ₹1 off your total bill!',
    increaseRuleText: 'Earn 1 point for every ₹10 spent. Points are credited to your account when the restaurant owner completes/confirms payment on your order.',
    decreaseRuleText: 'When placing an order, tick "Redeem Loyalty Points" on checkout. Points are deducted to give you an instant bill discount!',
  });

  const { data: configData, isLoading: configLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: async () => {
      const res = await api.get('/admin/config');
      const backendConfig = res.data.data?.config || {};
      const c: PlatformConfig = {
        commissionRate: typeof backendConfig.defaultCommissionRate === 'number' ? backendConfig.defaultCommissionRate : 5,
        gstRate: typeof backendConfig.gstRate === 'number' ? backendConfig.gstRate : 18,
        maxOrdersPerHour: typeof backendConfig.maxOrdersPerHour === 'number' ? backendConfig.maxOrdersPerHour : 100,
        maintenanceMode: !!backendConfig.maintenanceMode,
      };
      setConfig(c);
      return c;
    },
  });

  const { isLoading: loyaltyLoading } = useQuery({
    queryKey: ['admin-loyalty-settings'],
    queryFn: async () => {
      const res = await api.get('/admin/loyalty-settings');
      const s = res.data.data?.settings || {};
      const l: LoyaltySettings = {
        pointsPerSpendRupees: Number(s.pointsPerSpendRupees) || 10,
        pointsPerDiscountRupee: Number(s.pointsPerDiscountRupee) || 50,
        minPointsToRedeem: Number(s.minPointsToRedeem) || 50,
        conversionRuleText: s.conversionRuleText || '50 Loyalty Points = ₹1.00 Discount. Every 50 points saved gives you ₹1 off your total bill!',
        increaseRuleText: s.increaseRuleText || 'Earn 1 point for every ₹10 spent. Points are credited to your account when the restaurant owner completes/confirms payment on your order.',
        decreaseRuleText: s.decreaseRuleText || 'When placing an order, tick "Redeem Loyalty Points" on checkout. Points are deducted to give you an instant bill discount!',
      };
      setLoyalty(l);
      return l;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => { await api.put('/admin/config', config); },
    onSuccess: () => { toast.success('Settings saved!'); qc.invalidateQueries({ queryKey: ['admin-config'] }); },
    onError: () => toast.error('Failed to save settings'),
  });

  const saveLoyaltyMutation = useMutation({
    mutationFn: async () => { await api.put('/admin/loyalty-settings', loyalty); },
    onSuccess: () => { toast.success('Loyalty Program rules & pricing saved!'); qc.invalidateQueries({ queryKey: ['admin-loyalty-settings'] }); qc.invalidateQueries({ queryKey: ['loyalty-settings'] }); },
    onError: () => toast.error('Failed to save loyalty settings'),
  });

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally { logout(); router.push('/login'); }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <AdminSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-xl hover:bg-muted">
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display font-bold text-xl">Platform Settings</h1>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-4xl">
          {/* Platform Config */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-6">
            <h2 className="font-display font-semibold mb-5">Platform Configuration</h2>
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Commission Rate (%)</label>
                  <div className="relative">
                    <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="number" value={config.commissionRate ?? ''} min={0} max={100}
                      onChange={(e) => setConfig(c => ({ ...c, commissionRate: parseFloat(e.target.value) }))}
                      className="w-full pl-9 pr-4 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">GST Rate (%)</label>
                  <div className="relative">
                    <Percent className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input type="number" value={config.gstRate ?? ''} min={0} max={100}
                      onChange={(e) => setConfig(c => ({ ...c, gstRate: parseFloat(e.target.value) }))}
                      className="w-full pl-9 pr-4 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between p-3 bg-muted/30 rounded-xl">
                <div>
                  <p className="font-medium text-sm">Maintenance Mode</p>
                  <p className="text-xs text-muted-foreground">Disables the platform for all users</p>
                </div>
                <button
                  onClick={() => setConfig(c => ({ ...c, maintenanceMode: !c.maintenanceMode }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${config.maintenanceMode ? 'bg-red-500' : 'bg-muted'}`}
                >
                  <span className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${config.maintenanceMode ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              <button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Save className="w-4 h-4" />
                {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </motion.div>

          {/* Customer Loyalty Program Configuration */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="font-display font-semibold text-lg flex items-center gap-2">
                  <span className="text-amber-500">⭐</span> Customer Loyalty Program Rules & Pricing
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Calculate and configure points conversion ratios, earning conditions, and customer modal rules.
                </p>
              </div>
              <div className="px-3 py-1.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs font-semibold">
                Live Pricing Rules
              </div>
            </div>

            <div className="space-y-5">
              {/* Numerical Pricing & Ratio Controls */}
              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Earn 1 Point Per ₹ Spent
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="number"
                      value={loyalty.pointsPerSpendRupees}
                      min={1}
                      onChange={(e) => setLoyalty(l => ({ ...l, pointsPerSpendRupees: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="w-full pl-9 pr-4 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">e.g. 10 = Earn 1 pt per ₹10 spent</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Points Required for ₹1.00 Discount
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="number"
                      value={loyalty.pointsPerDiscountRupee}
                      min={1}
                      onChange={(e) => setLoyalty(l => ({ ...l, pointsPerDiscountRupee: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="w-full pl-9 pr-4 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">e.g. 50 = 50 pts = ₹1 discount</p>
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                    Min Points to Redeem
                  </label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="number"
                      value={loyalty.minPointsToRedeem}
                      min={0}
                      onChange={(e) => setLoyalty(l => ({ ...l, minPointsToRedeem: Math.max(0, parseInt(e.target.value) || 0) }))}
                      className="w-full pl-9 pr-4 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Minimum balance to redeem</p>
                </div>
              </div>

              {/* Live Calculator & Ratio Preview Box */}
              <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-1.5">
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">📊 Live Rate Calculator & Preview</p>
                <div className="grid sm:grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <p>• <strong>1,000 Loyalty Points</strong> = <span className="text-emerald-500 font-semibold">₹{(1000 / (loyalty.pointsPerDiscountRupee || 1)).toFixed(2)}</span> Bill Discount Value</p>
                  <p>• <strong>₹500 Meal Order</strong> = <span className="text-amber-500 font-semibold">+{Math.floor(500 / (loyalty.pointsPerSpendRupees || 1))} Points</span> Earned upon Payment</p>
                </div>
              </div>

              {/* Text Rule Descriptions */}
              <div className="space-y-3 pt-2">
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    Conversion Ratio Banner Text
                  </label>
                  <textarea
                    rows={2}
                    value={loyalty.conversionRuleText}
                    onChange={(e) => setLoyalty(l => ({ ...l, conversionRuleText: e.target.value }))}
                    className="w-full p-3 bg-muted/30 border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    How Points Increase (+) Text Condition
                  </label>
                  <textarea
                    rows={2}
                    value={loyalty.increaseRuleText}
                    onChange={(e) => setLoyalty(l => ({ ...l, increaseRuleText: e.target.value }))}
                    className="w-full p-3 bg-muted/30 border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">
                    How Points Decrease (-) Text Condition
                  </label>
                  <textarea
                    rows={2}
                    value={loyalty.decreaseRuleText}
                    onChange={(e) => setLoyalty(l => ({ ...l, decreaseRuleText: e.target.value }))}
                    className="w-full p-3 bg-muted/30 border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  />
                </div>
              </div>

              <button
                onClick={() => saveLoyaltyMutation.mutate()}
                disabled={saveLoyaltyMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-medium text-sm transition-colors disabled:opacity-60 shadow-lg shadow-amber-500/20"
              >
                <Save className="w-4 h-4" />
                {saveLoyaltyMutation.isPending ? 'Saving Loyalty Settings...' : 'Save Loyalty Program Rules'}
              </button>
            </div>
          </motion.div>
        </div>
      </main>
    </div>
  );
}
