'use client';

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Settings, UtensilsCrossed, LayoutDashboard, ShoppingBag, Tag, BarChart3, LogOut,
  Menu, Save, Globe, Phone, MapPin, Clock, Palette, QrCode, Download, CreditCard, Banknote, Building2, Smartphone
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { WaiterBell } from '@/components/owner/WaiterBell';
import QRCode from 'qrcode';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { label: 'Coupons', icon: Tag, href: '/owner/coupons' },
  { label: 'Analytics', icon: BarChart3, href: '/owner/analytics' },
  { label: 'Customize', icon: Palette, href: '/owner/customize' },
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
  // Direct payment details
  paymentQrCode: string | null;
  paymentUpiId: string | null;
  paymentPhone: string | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
  bankAccountHolder: string | null;
};

export function OwnerSettingsPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [form, setForm] = useState<Partial<Restaurant>>({});
  const formInitialized = useRef(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const [paymentQrFile, setPaymentQrFile] = useState<File | null>(null);
  const [paymentQrPreviewUrl, setPaymentQrPreviewUrl] = useState<string | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [bannerPreviewUrl, setBannerPreviewUrl] = useState<string | null>(null);
  const [tableNumber, setTableNumber] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [operatingHours, setOperatingHours] = useState<OperatingHours>({
    monday: { open: '11:00', close: '23:00', closed: false },
    tuesday: { open: '11:00', close: '23:00', closed: false },
    wednesday: { open: '11:00', close: '23:00', closed: false },
    thursday: { open: '11:00', close: '23:00', closed: false },
    friday: { open: '11:00', close: '23:30', closed: false },
    saturday: { open: '10:00', close: '23:30', closed: false },
    sunday: { open: '10:00', close: '22:30', closed: false },
  });

  useEffect(() => {
    if (logoFile) {
      const url = URL.createObjectURL(logoFile);
      setLogoPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
        setLogoPreviewUrl(null);
      };
    }
  }, [logoFile]);

  useEffect(() => {
    if (bannerFile) {
      const url = URL.createObjectURL(bannerFile);
      setBannerPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
        setBannerPreviewUrl(null);
      };
    }
  }, [bannerFile]);

  useEffect(() => {
    if (paymentQrFile) {
      const url = URL.createObjectURL(paymentQrFile);
      setPaymentQrPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
        setPaymentQrPreviewUrl(null);
      };
    }
  }, [paymentQrFile]);

  const { data, isLoading } = useQuery({
    queryKey: ['owner-restaurant'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as Restaurant;
    },
  });

  useEffect(() => {
    // Only initialize the form ONCE from server data (on first load)
    // Subsequent refetches should NOT overwrite what the user has typed
    if (data && !formInitialized.current) {
      formInitialized.current = true;
      setForm(data);
      if (data.operatingHours) {
        setOperatingHours(data.operatingHours);
      }
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await api.put('/owner/restaurant', {
        name: form.name,
        slug: form.slug,
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
        paymentQrCode: form.paymentQrCode,
        paymentUpiId: form.paymentUpiId,
        paymentPhone: form.paymentPhone,
        bankName: form.bankName,
        bankAccountNumber: form.bankAccountNumber,
        bankIfsc: form.bankIfsc,
        bankAccountHolder: form.bankAccountHolder,
      });
      return res.data.data.restaurant;
    },
    onSuccess: (updatedRestaurant) => {
      if (updatedRestaurant) {
        setForm(updatedRestaurant);
        if (updatedRestaurant.operatingHours) {
          setOperatingHours(updatedRestaurant.operatingHours);
        }
        formInitialized.current = true;
      }
      if (updatedRestaurant?.slug && updatedRestaurant.slug !== data?.slug) {
        toast.success(
          `✅ URL updated! New customer link: ${window.location.origin}/r/${updatedRestaurant.slug}`,
          { duration: 8000 }
        );
      } else {
        toast.success('Settings saved!');
      }
      qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.error || 'Failed to save settings';
      toast.error(msg);
    },
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async () => {
      if (!logoFile) return;
      const fd = new FormData();
      fd.append('logo', logoFile);
      const res = await api.post('/owner/restaurant/logo', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res.data.data.logo as string;
    },
    onSuccess: (newUrl) => {
      toast.success('Logo uploaded!');
      setLogoFile(null);
      setLogoPreviewUrl(null);
      if (newUrl) setForm(f => ({ ...f, logo: newUrl }));
      qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
    },
    onError: () => toast.error('Failed to upload logo'),
  });

  const uploadBannerMutation = useMutation({
    mutationFn: async () => {
      if (!bannerFile) return;
      const fd = new FormData();
      fd.append('banner', bannerFile);
      const res = await api.post('/owner/restaurant/banner', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res.data.data.banner as string;
    },
    onSuccess: (newUrl) => {
      toast.success('Banner uploaded!');
      setBannerFile(null);
      setBannerPreviewUrl(null);
      if (newUrl) setForm(f => ({ ...f, banner: newUrl }));
      qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
    },
    onError: () => toast.error('Failed to upload banner'),
  });

  const uploadPaymentQrMutation = useMutation({
    mutationFn: async () => {
      if (!paymentQrFile) return;
      const fd = new FormData();
      fd.append('paymentQr', paymentQrFile);
      const res = await api.post('/owner/restaurant/payment-qr', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      return res.data.data.paymentQrCode as string;
    },
    onSuccess: (newUrl) => {
      toast.success('Payment QR uploaded!');
      setPaymentQrFile(null);
      setPaymentQrPreviewUrl(null);
      if (newUrl) setForm(f => ({ ...f, paymentQrCode: newUrl }));
      qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
    },
    onError: () => toast.error('Failed to upload payment QR'),
  });

  const savePaymentDetailsMutation = useMutation({
    mutationFn: async () => {
      const res = await api.put('/owner/restaurant', {
        name: form.name ?? '',
        paymentQrCode: form.paymentQrCode ?? null,
        paymentUpiId: form.paymentUpiId ?? null,
        paymentPhone: form.paymentPhone ?? null,
        bankName: form.bankName ?? null,
        bankAccountNumber: form.bankAccountNumber ?? null,
        bankIfsc: form.bankIfsc ?? null,
        bankAccountHolder: form.bankAccountHolder ?? null,
      });
      return res.data.data.restaurant;
    },
    onSuccess: (updated) => {
      toast.success('Payment details saved!');
      if (updated) setForm(updated);
      qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
    },
    onError: () => toast.error('Failed to save payment details'),
  });

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally { logout(); router.push('/login'); }
  };

  const [tableToken, setTableToken] = useState('');

  useEffect(() => {
    const tableNum = tableNumber.trim();
    if (!tableNum) {
      setTableToken('');
      return;
    }

    const delayDebounce = setTimeout(async () => {
      try {
        const response = await api.get(`/owner/restaurant/sign-table?table=${encodeURIComponent(tableNum)}`);
        setTableToken(response.data.data.signature);
      } catch {
        console.error('Failed to generate table token.');
      }
    }, 450);

    return () => clearTimeout(delayDebounce);
  }, [tableNumber]);

  const secureTablePayload = tableNumber.trim() && tableToken
    ? (typeof window !== 'undefined' ? btoa(`${tableNumber.trim()}:${tableToken}`) : Buffer.from(`${tableNumber.trim()}:${tableToken}`).toString('base64'))
    : '';

  const qrUrl = data
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/r/${data.slug}${secureTablePayload ? `?t=${encodeURIComponent(secureTablePayload)}` : ''}`
    : '';

  useEffect(() => {
    if (qrUrl) {
      QRCode.toDataURL(qrUrl, {
        width: 512,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF',
        },
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch((err) => console.error('Failed to generate QR code:', err));
    }
  }, [qrUrl]);

  const iframeUrl = data?.slug
    ? `/r/${data.slug}?preview=true` +
      `&themeColor=${encodeURIComponent(form.themeColor ?? '#E85D04')}` +
      `&name=${encodeURIComponent(form.name ?? '')}` +
      `&description=${encodeURIComponent(form.description ?? '')}` +
      `&logo=${encodeURIComponent(logoPreviewUrl || data.logo || '')}` +
      `&banner=${encodeURIComponent(bannerPreviewUrl || data.banner || '')}`
    : '';

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
          <div className="flex items-center gap-2">
            <WaiterBell />
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 disabled:opacity-60 transition-colors">
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid lg:grid-cols-12 gap-6 max-w-7xl mx-auto items-start">
            {/* Forms Column */}
            <div className="lg:col-span-7 space-y-6">
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

                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Restaurant URL Code (Unique Address)</label>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1 flex items-center border border-border rounded-xl overflow-hidden bg-muted/30">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                        <span className="pl-9 pr-2.5 text-xs text-muted-foreground font-mono select-none border-r border-border/60 py-2.5 bg-muted/20 flex items-center whitespace-nowrap">
                          /r/
                        </span>
                        <input
                          type="text"
                          value={form.slug ?? ''}
                          onChange={(e) => {
                            const val = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
                            setForm(f => ({ ...f, slug: val }));
                          }}
                          placeholder="rest-abc123"
                          className="flex-1 px-3 py-2.5 bg-transparent text-sm font-mono focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const code = 'rest-' + Math.random().toString(36).slice(2, 8);
                          setForm(f => ({ ...f, slug: code }));
                          toast.success(`New unique code generated: ${code}`);
                        }}
                        className="px-3 py-2.5 bg-primary/10 hover:bg-primary/20 rounded-xl text-xs font-semibold text-primary transition-all border border-primary/20 flex-shrink-0 whitespace-nowrap"
                        title="Generate a new unique random code"
                      >
                        Generate Code
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (form.slug) {
                            const fullUrl = `${window.location.origin}/r/${form.slug}`;
                            navigator.clipboard.writeText(fullUrl);
                            toast.success('Restaurant URL copied! 📋');
                          }
                        }}
                        className="px-3 py-2.5 bg-muted hover:bg-muted/80 rounded-xl text-xs font-medium text-foreground transition-all border border-border flex-shrink-0"
                        title="Copy Restaurant URL"
                      >
                        Copy URL
                      </button>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                      Customer menu link: <strong className="text-foreground font-mono">{typeof window !== 'undefined' ? window.location.origin : ''}/r/{form.slug || 'rest-abc123'}</strong>
                      <span className="ml-2 text-orange-500 font-medium">↑ Click &quot;Generate Code&quot; to get a unique URL that replaces readable names</span>
                    </p>
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
                    {(logoPreviewUrl || form.logo || data?.logo) && <img src={logoPreviewUrl || form.logo || data?.logo || ''} alt="Logo" className="w-20 h-20 rounded-xl object-cover border border-border mb-2 bg-white" />}
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
                    {(bannerPreviewUrl || form.banner || data?.banner) && <img src={bannerPreviewUrl || form.banner || data?.banner || ''} alt="Banner" className="w-full h-28 rounded-xl object-cover border border-border mb-2 bg-white" />}
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

              {/* Direct Payment Setup */}
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="bg-card border border-border rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-display font-semibold flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-primary" />
                    Direct Payment Setup
                  </h2>
                  <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">Optional</span>
                </div>
                <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
                  Add your UPI QR code and payment details so customers can pay directly to you when they select <strong>"Pay Direct to Owner"</strong> at checkout. All fields are optional — at least one of QR code, UPI ID, or Bank details is recommended.
                </p>

                <div className="space-y-5">
                  {/* QR Code Upload */}
                  <div>
                    <p className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1.5"><Smartphone className="w-4 h-4 text-primary" /> UPI / Payment QR Code</p>
                    <div className="flex gap-4 items-start">
                      {(paymentQrPreviewUrl || form.paymentQrCode || data?.paymentQrCode) && (
                        <img
                          src={paymentQrPreviewUrl || form.paymentQrCode || data?.paymentQrCode || ''}
                          alt="Payment QR"
                          className="w-28 h-28 object-contain border border-border rounded-xl bg-white p-1 flex-shrink-0"
                        />
                      )}
                      <div className="flex-1 space-y-2">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => setPaymentQrFile(e.target.files?.[0] ?? null)}
                          className="w-full px-3 py-2 text-sm text-muted-foreground border border-dashed border-border rounded-xl"
                        />
                        {paymentQrFile && (
                          <button
                            onClick={() => uploadPaymentQrMutation.mutate()}
                            disabled={uploadPaymentQrMutation.isPending}
                            className="px-4 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-semibold disabled:opacity-60 w-full"
                          >
                            {uploadPaymentQrMutation.isPending ? 'Uploading...' : 'Upload QR Code'}
                          </button>
                        )}
                        <p className="text-[11px] text-muted-foreground">Upload a clear image of your UPI or bank QR code. Max 5MB.</p>
                      </div>
                    </div>
                  </div>

                  {/* UPI ID & Phone */}
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block flex items-center gap-1"><Smartphone className="w-3 h-3" /> UPI ID</label>
                      <input
                        type="text"
                        placeholder="yourname@upi"
                        value={form.paymentUpiId ?? ''}
                        onChange={(e) => setForm(f => ({ ...f, paymentUpiId: e.target.value || null }))}
                        className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground mb-1.5 block flex items-center gap-1"><Phone className="w-3 h-3" /> Payment Phone</label>
                      <input
                        type="tel"
                        placeholder="e.g. 9876543210"
                        value={form.paymentPhone ?? ''}
                        onChange={(e) => setForm(f => ({ ...f, paymentPhone: e.target.value || null }))}
                        className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                    </div>
                  </div>

                  {/* Bank Details */}
                  <div>
                    <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5" /> Bank Account Details (Optional)</p>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Account Holder Name</label>
                        <input
                          type="text"
                          placeholder="Full name on account"
                          value={form.bankAccountHolder ?? ''}
                          onChange={(e) => setForm(f => ({ ...f, bankAccountHolder: e.target.value || null }))}
                          className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Bank Name</label>
                        <input
                          type="text"
                          placeholder="e.g. State Bank of India"
                          value={form.bankName ?? ''}
                          onChange={(e) => setForm(f => ({ ...f, bankName: e.target.value || null }))}
                          className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">Account Number</label>
                        <input
                          type="text"
                          placeholder="Account number"
                          value={form.bankAccountNumber ?? ''}
                          onChange={(e) => setForm(f => ({ ...f, bankAccountNumber: e.target.value || null }))}
                          className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">IFSC Code</label>
                        <input
                          type="text"
                          placeholder="e.g. SBIN0001234"
                          value={form.bankIfsc ?? ''}
                          onChange={(e) => setForm(f => ({ ...f, bankIfsc: e.target.value || null }))}
                          className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => savePaymentDetailsMutation.mutate()}
                    disabled={savePaymentDetailsMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-xl text-sm font-bold disabled:opacity-60 hover:opacity-90 transition-opacity shadow-md shadow-orange-500/20"
                  >
                    <Save className="w-4 h-4" />
                    {savePaymentDetailsMutation.isPending ? 'Saving...' : 'Save Payment Details'}
                  </button>
                </div>
              </motion.div>

              {/* QR Code Builder */}
              {data && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-card border border-border rounded-2xl p-6"
                >
                  <div className="flex items-center justify-between mb-5">
                    <h2 className="font-display font-semibold flex items-center gap-2">
                      <QrCode className="w-5 h-5 text-primary" />
                      QR Code Generator
                    </h2>
                    <span className="text-xs text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                      Local Generator
                    </span>
                  </div>

                  <div className="grid md:grid-cols-5 gap-6 items-start">
                    {/* Customizer Panel */}
                    <div className="md:col-span-3 space-y-4">
                      <p className="text-sm text-muted-foreground leading-relaxed">
                        Generate table-specific QR codes to automatically pre-fill table numbers for your customers during checkout.
                      </p>

                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground block">
                          Table Number (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="e.g. 5, 12, A4 (leave empty for general menu)"
                          value={tableNumber}
                          onChange={(e) => setTableNumber(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground font-medium"
                        />
                      </div>

                      {/* Quick Presets */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold text-muted-foreground block">
                          Quick Table Presets
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button
                            onClick={() => setTableNumber('')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              tableNumber === ''
                                ? 'bg-primary border-primary text-white shadow-sm'
                                : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted'
                            }`}
                          >
                            General
                          </button>
                          {['1', '2', '3', '4', '5', '10'].map((num) => (
                            <button
                              key={num}
                              onClick={() => setTableNumber(num)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                                tableNumber === num
                                  ? 'bg-primary border-primary text-white shadow-sm'
                                  : 'bg-muted/30 border-border text-muted-foreground hover:bg-muted'
                              }`}
                            >
                              Table {num}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* QR Target Link */}
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-muted-foreground block">
                          Target Link
                        </label>
                        <p className="text-[11px] font-mono bg-muted/50 border border-border/80 rounded-xl px-3 py-2.5 break-all text-foreground select-all">
                          {qrUrl}
                        </p>
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap gap-3 pt-2">
                        <Link
                          href={qrUrl ? `/r/${data.slug}${secureTablePayload ? `?t=${encodeURIComponent(secureTablePayload)}` : ''}` : '#'}
                          target="_blank"
                          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-muted hover:bg-muted/70 rounded-xl text-sm font-semibold transition-colors text-foreground"
                        >
                          <Globe className="w-4 h-4" /> Preview Menu
                        </Link>

                        {qrCodeDataUrl && (
                          <a
                            href={qrCodeDataUrl}
                            download={`${data.slug}${tableNumber.trim() ? `-table-${tableNumber.trim()}` : ''}-qr.png`}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-white hover:bg-primary/95 rounded-xl text-sm font-semibold shadow-md transition-colors"
                          >
                            <Download className="w-4 h-4" /> Download QR Code
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Placard Preview Panel */}
                    <div className="md:col-span-2 flex flex-col items-center justify-center">
                      <div className="flex flex-col items-center p-5 bg-zinc-950 dark:bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-[210px] shadow-2xl text-center text-white relative overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-b from-orange-500/5 via-transparent to-transparent pointer-events-none" />
                        
                        <span className="text-[10px] uppercase font-bold tracking-widest text-zinc-500 mb-1">
                          Scan & Order
                        </span>
                        <h4 className="text-sm font-bold text-orange-500 truncate max-w-[170px] mb-4">
                          {data.name}
                        </h4>

                        <div className="bg-white p-3 rounded-xl shadow-inner mb-4 flex items-center justify-center">
                          {qrCodeDataUrl ? (
                            <img
                              src={qrCodeDataUrl}
                              alt="Restaurant QR Code"
                              className="w-36 h-36"
                            />
                          ) : (
                            <div className="w-36 h-36 flex items-center justify-center bg-zinc-100 text-zinc-400 text-xs">
                              Generating...
                            </div>
                          )}
                        </div>

                        <span className="text-xs font-bold bg-orange-500/10 text-orange-400 border border-orange-500/20 px-3 py-1 rounded-full">
                          {tableNumber.trim() ? `Table ${tableNumber.trim()}` : 'General Menu'}
                        </span>
                      </div>
                      <span className="text-[11px] text-muted-foreground mt-3 text-center">
                        Table placards preview mockup
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {/* Mobile Mockup Preview Column */}
            <div className="lg:col-span-5 hidden lg:block sticky top-6 self-start">
              <div className="border border-border bg-card rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                  <h3 className="font-semibold text-sm flex items-center gap-1.5">
                    Live Mobile Menu Preview
                  </h3>
                  <span className="text-[10px] text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                    Real-time Preview
                  </span>
                </div>
                
                <div className="relative mx-auto w-[290px] h-[580px] rounded-[3rem] border-[10px] border-zinc-950 bg-zinc-950 shadow-2xl overflow-hidden">
                  {/* Speaker Notch */}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 h-4 w-32 bg-zinc-950 rounded-b-2xl z-45 flex items-center justify-center">
                    <div className="w-10 h-1 bg-zinc-800 rounded-full" />
                  </div>
                  
                  {/* Dynamic Iframe */}
                  {data?.slug && (
                    <iframe
                      src={iframeUrl}
                      className="w-full h-full border-0 select-none bg-background"
                      title="Menu Preview"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
