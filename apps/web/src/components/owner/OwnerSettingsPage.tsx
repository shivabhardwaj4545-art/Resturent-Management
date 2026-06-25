'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Settings, UtensilsCrossed, LayoutDashboard, ShoppingBag, Tag, BarChart3, LogOut,
  Menu, Save, Globe, Phone, MapPin, Clock, Palette, QrCode, Download
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

type OperatingHoursDay = {
  open: string;
  close: string;
  closed: boolean;
};

type OperatingHours = {
  monday: OperatingHoursDay;
  tuesday: OperatingHoursDay;
  wednesday: OperatingHoursDay;
  thursday: OperatingHoursDay;
  friday: OperatingHoursDay;
  saturday: OperatingHoursDay;
  sunday: OperatingHoursDay;
};

type Restaurant = {
  id: string; name: string; slug: string; description: string | null;
  phone: string | null; address: string | null; city: string | null;
  state: string | null; country: string | null; pincode: string | null;
  themeColor: string | null;
  logo: string | null; banner: string | null; isOpen: boolean;
  hasDelivery: boolean;
  operatingHours: OperatingHours | null;
};

export function OwnerSettingsPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [form, setForm] = useState<Partial<Restaurant>>({});
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [operatingHours, setOperatingHours] = useState<OperatingHours>({
    monday: { open: '11:00', close: '23:00', closed: false },
    tuesday: { open: '11:00', close: '23:00', closed: false },
    wednesday: { open: '11:00', close: '23:00', closed: false },
    thursday: { open: '11:00', close: '23:00', closed: false },
    friday: { open: '11:00', close: '23:30', closed: false },
    saturday: { open: '10:00', close: '23:30', closed: false },
    sunday: { open: '10:00', close: '22:30', closed: false },
  });

  const { data, isLoading } = useQuery({
    queryKey: ['owner-restaurant'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as Restaurant;
    },
  });

  useEffect(() => {
    if (data) {
      setForm(data);
      if (data.operatingHours) {
        setOperatingHours(data.operatingHours);
      }
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await api.put('/owner/restaurant', {
        name: form.name,
        description: form.description,
        phone: form.phone,
        address: form.address,
        city: form.city,
        state: form.state,
        country: form.country,
        pincode: form.pincode,
        hasDelivery: form.hasDelivery,
        operatingHours: operatingHours,
        themeColor: form.themeColor,
      });
    },
    onSuccess: () => {
      toast.success('Settings saved!');
      qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
    },
    onError: () => toast.error('Failed to save settings'),
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async () => {
      if (!logoFile) return;
      const fd = new FormData();
      fd.append('logo', logoFile);
      await api.post('/owner/restaurant/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => { toast.success('Logo uploaded!'); setLogoFile(null); qc.invalidateQueries({ queryKey: ['owner-restaurant'] }); },
    onError: () => toast.error('Failed to upload logo'),
  });

  const uploadBannerMutation = useMutation({
    mutationFn: async () => {
      if (!bannerFile) return;
      const fd = new FormData();
      fd.append('banner', bannerFile);
      await api.post('/owner/restaurant/banner', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    },
    onSuccess: () => { toast.success('Banner uploaded!'); setBannerFile(null); qc.invalidateQueries({ queryKey: ['owner-restaurant'] }); },
    onError: () => toast.error('Failed to upload banner'),
  });

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally { logout(); router.push('/login'); }
  };

  const qrUrl = data ? `${typeof window !== 'undefined' ? window.location.origin : ''}/r/${data.slug}` : '';

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
            <h1 className="font-display font-bold text-xl">Restaurant Settings</h1>
          </div>
          <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 disabled:opacity-60 transition-colors">
            <Save className="w-4 h-4" />
            {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5 space-y-6 max-w-3xl">
          {/* Basic Info */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="bg-card border border-border rounded-2xl p-6">
            <h2 className="font-display font-semibold mb-5">Basic Information</h2>
            <div className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Restaurant Name</label>
                  <input value={form.name ?? ''} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Phone</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input value={form.phone ?? ''} onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))}
                      className="w-full pl-9 pr-4 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 py-1 bg-muted/10 border border-border/50 rounded-xl px-3.5 py-2.5">
                <input
                  type="checkbox"
                  id="hasDelivery"
                  checked={form.hasDelivery ?? true}
                  onChange={(e) => setForm(f => ({ ...f, hasDelivery: e.target.checked }))}
                  className="w-4 h-4 text-primary border-border rounded focus:ring-primary/30 bg-muted/30 cursor-pointer"
                />
                <label htmlFor="hasDelivery" className="text-sm font-medium text-foreground select-none cursor-pointer">
                  Enable Home Delivery for Customers
                </label>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Description</label>
                <textarea value={form.description ?? ''} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                  rows={3} className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Address</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
                  <textarea value={form.address ?? ''} onChange={(e) => setForm(f => ({ ...f, address: e.target.value }))}
                    rows={2} className="w-full pl-9 pr-4 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                </div>
              </div>
              <div className="grid sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">City</label>
                  <input value={form.city ?? ''} onChange={(e) => setForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">State</label>
                  <input value={form.state ?? ''} onChange={(e) => setForm(f => ({ ...f, state: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Pincode</label>
                  <input value={form.pincode ?? ''} onChange={(e) => setForm(f => ({ ...f, pincode: e.target.value }))}
                    className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
              <div>
                <label className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Operating Hours (Weekly Schedule)
                </label>
                <div className="space-y-3 bg-muted/10 border border-border rounded-2xl p-4">
                  {Object.keys(operatingHours).map((day) => {
                    const dayHours = operatingHours[day as keyof OperatingHours];
                    return (
                      <div key={day} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 border-b border-border/50 last:border-b-0">
                        <span className="capitalize font-medium text-xs w-24">{day}</span>
                        
                        <div className="flex items-center gap-4 flex-1 justify-end">
                          {/* Toggle switch for Open/Closed */}
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={!dayHours?.closed}
                              onChange={(e) => {
                                const isOpen = e.target.checked;
                                setOperatingHours(prev => ({
                                  ...prev,
                                  [day]: { ...prev[day as keyof OperatingHours], closed: !isOpen }
                                }));
                              }}
                              className="sr-only peer"
                            />
                            <div className="w-9 h-5 bg-muted rounded-full peer peer-focus:ring-2 peer-focus:ring-primary/20 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                            <span className="ml-2.5 text-xs font-semibold select-none min-w-[48px]">
                              {!dayHours?.closed ? 'Open' : 'Closed'}
                            </span>
                          </label>

                          {/* Open and Close Time Pickers */}
                          {!dayHours?.closed && (
                            <div className="flex items-center gap-2">
                              <input
                                type="time"
                                value={dayHours?.open ?? '11:00'}
                                onChange={(e) => {
                                  setOperatingHours(prev => ({
                                    ...prev,
                                    [day]: { ...prev[day as keyof OperatingHours], open: e.target.value }
                                  }));
                                }}
                                className="px-2 py-1 bg-background border border-border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                              <span className="text-xs text-muted-foreground">to</span>
                              <input
                                type="time"
                                value={dayHours?.close ?? '23:00'}
                                onChange={(e) => {
                                  setOperatingHours(prev => ({
                                    ...prev,
                                    [day]: { ...prev[day as keyof OperatingHours], close: e.target.value }
                                  }));
                                }}
                                className="px-2 py-1 bg-background border border-border rounded-lg text-xs font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground mb-1.5 block flex items-center gap-1.5"><Palette className="w-3.5 h-3.5" />Theme Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={form.themeColor ?? '#E85D04'} onChange={(e) => setForm(f => ({ ...f, themeColor: e.target.value }))}
                    className="w-10 h-10 rounded-xl border border-border cursor-pointer bg-transparent" />
                  <input value={form.themeColor ?? '#E85D04'} onChange={(e) => setForm(f => ({ ...f, themeColor: e.target.value }))}
                    className="flex-1 px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
              </div>
            </div>
          </motion.div>

          {/* Images */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="bg-card border border-border rounded-2xl p-6">
            <h2 className="font-display font-semibold mb-5">Images</h2>
            <div className="space-y-5">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Logo</p>
                {data?.logo && <img src={data.logo} alt="Logo" className="w-20 h-20 rounded-xl object-cover border border-border mb-2" />}
                <div className="flex gap-3 items-center">
                  <input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
                    className="flex-1 px-3 py-2 text-sm text-muted-foreground border border-dashed border-border rounded-xl" />
                  {logoFile && (
                    <button onClick={() => uploadLogoMutation.mutate()} disabled={uploadLogoMutation.isPending}
                      className="px-3 py-2 bg-primary text-primary-foreground rounded-xl text-sm disabled:opacity-60">
                      {uploadLogoMutation.isPending ? 'Uploading...' : 'Upload'}
                    </button>
                  )}
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Banner</p>
                {data?.banner && <img src={data.banner} alt="Banner" className="w-full h-28 rounded-xl object-cover border border-border mb-2" />}
                <div className="flex gap-3 items-center">
                  <input type="file" accept="image/*" onChange={(e) => setBannerFile(e.target.files?.[0] ?? null)}
                    className="flex-1 px-3 py-2 text-sm text-muted-foreground border border-dashed border-border rounded-xl" />
                  {bannerFile && (
                    <button onClick={() => uploadBannerMutation.mutate()} disabled={uploadBannerMutation.isPending}
                      className="px-3 py-2 bg-primary text-primary-foreground rounded-xl text-sm disabled:opacity-60">
                      {uploadBannerMutation.isPending ? 'Uploading...' : 'Upload'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* QR Code */}
          {data && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="bg-card border border-border rounded-2xl p-6">
              <h2 className="font-display font-semibold mb-4 flex items-center gap-2"><QrCode className="w-5 h-5" />QR Code</h2>
              <div className="flex items-start gap-6">
                <div className="bg-white p-4 rounded-xl border border-border">
                  <img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrUrl)}`}
                    alt="Restaurant QR Code" className="w-40 h-40" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-muted-foreground mb-2">Share this QR code with your customers to let them order directly from their phones.</p>
                  <p className="text-xs font-mono bg-muted/30 border border-border rounded-lg px-3 py-2 mb-3 break-all">{qrUrl}</p>
                  <div className="flex gap-3">
                    <Link href={`/r/${data.slug}`} target="_blank"
                      className="flex items-center gap-2 px-3 py-2 bg-muted hover:bg-muted/70 rounded-xl text-sm transition-colors">
                      <Globe className="w-3.5 h-3.5" /> Preview Menu
                    </Link>
                    <a href={`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qrUrl)}`}
                      download="restaurant-qr.png"
                      className="flex items-center gap-2 px-3 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-xl text-sm transition-colors">
                      <Download className="w-3.5 h-3.5" /> Download QR
                    </a>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </div>
      </main>
    </div>
  );
}
