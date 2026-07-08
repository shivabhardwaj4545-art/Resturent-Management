'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Settings, Store, Users, BarChart3, LayoutDashboard, LogOut, Menu,
  Shield, Save, Percent, DollarSign, Plus, Trash2, CreditCard, Ticket, HandCoins
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

export function AdminSettingsPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [config, setConfig] = useState<PlatformConfig>({
    commissionRate: 5, gstRate: 18, maxOrdersPerHour: 100, maintenanceMode: false
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

  const saveMutation = useMutation({
    mutationFn: async () => { await api.put('/admin/config', config); },
    onSuccess: () => { toast.success('Settings saved!'); qc.invalidateQueries({ queryKey: ['admin-config'] }); },
    onError: () => toast.error('Failed to save settings'),
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
            <h1 className="font-display font-bold text-xl">Platform Settings</h1>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-3xl">
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
        </div>
      </main>
    </div>
  );
}
