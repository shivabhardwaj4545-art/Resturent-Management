'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Store, Users, CreditCard, Shield, ShieldCheck, ShieldAlert,
  SlidersHorizontal, CheckCircle2, XCircle, AlertTriangle, RefreshCw,
  ExternalLink, Calendar, Key, Mail, Phone, MapPin, Sparkles,
  Gift, ChefHat, Bed, BellRing, QrCode, Tag, Star, BarChart3,
  Palette, Settings, Lock, Check, Clock, TrendingUp, IndianRupee,
  ShoppingBag, Loader2, ArrowUpRight, HelpCircle
} from 'lucide-react';
import api from '@/lib/api';
import { toast } from 'sonner';

interface AdminRestaurantDetailModalProps {
  restaurantId: string | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdated?: () => void;
}

const TABS_LIST = [
  { id: 'overview', label: 'Full Overview & Stats', icon: Store },
  { id: 'features', label: 'Feature Toggles', icon: SlidersHorizontal },
  { id: 'sideTabs', label: 'Side Tabs Access', icon: Lock },
  { id: 'subscription', label: 'Subscription Plan', icon: CreditCard },
  { id: 'edit', label: 'Edit Info & Credentials', icon: Key },
];

const AVAILABLE_SIDE_TABS = [
  { key: 'dashboard', label: 'Dashboard Overview', desc: 'Real-time sales, order stats & analytics summaries', icon: BarChart3 },
  { key: 'menu', label: 'Menu Management', desc: 'Categories, food items, add-ons & prices', icon: Store },
  { key: 'orders', label: 'Live Orders', desc: 'Active order lifecycle, checkout status & history', icon: ShoppingBag },
  { key: 'kitchen-staff', label: 'Kitchen Staff & KDS', desc: 'Kitchen order display & staff management', icon: ChefHat },
  { key: 'coupons', label: 'Coupons & Promo Codes', desc: 'Discount vouchers, min spend & usage limits', icon: Tag },
  { key: 'reviews', label: 'Customer Reviews', desc: 'Ratings, feedback & guest testimonials', icon: Star },
  { key: 'analytics', label: 'Advanced Analytics', desc: 'Revenue breakdowns, popular items & customer metrics', icon: TrendingUp },
  { key: 'subscription', label: 'Subscription & Plans', desc: 'Allows restaurant owner to view and subscribe to billing plans', icon: CreditCard },
  { key: 'customize', label: 'Themes & Branding', desc: 'Theme colors, banner, logo & layout templates', icon: Palette },
  { key: 'settings', label: 'Store & Payment Settings', desc: 'Operating hours, UPI IDs, QR codes & bank details', icon: Settings },
];

export function AdminRestaurantDetailModal({
  restaurantId,
  isOpen,
  onClose,
  onUpdated,
}: AdminRestaurantDetailModalProps) {
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'features' | 'sideTabs' | 'subscription' | 'edit'>('overview');

  // Fetch full restaurant details
  const { data: detailData, isLoading, refetch } = useQuery({
    queryKey: ['admin-restaurant-details', restaurantId],
    queryFn: async () => {
      if (!restaurantId) return null;
      const res = await api.get(`/admin/restaurants/${restaurantId}`);
      return res.data.data;
    },
    enabled: !!restaurantId && isOpen,
  });

  // Fetch available subscription plans
  const { data: plansData } = useQuery({
    queryKey: ['admin-subscription-plans-list'],
    queryFn: async () => {
      const res = await api.get('/admin/subscriptions');
      return (res.data.data?.plans || []) as Array<{ id: string; name: string; price: number; features: any }>;
    },
    enabled: isOpen,
  });

  const restaurant = detailData?.restaurant;
  const stats = detailData?.stats;
  const recentOrders = detailData?.recentOrders || [];

  // Local feature flags state
  const [featureFlags, setFeatureFlags] = useState({
    roomServiceEnabled: true,
    callWaiterEnabled: true,
    qrOrderingEnabled: true,
    onlinePaymentEnabled: true,
    aiAssistantEnabled: true,
    loyaltyProgramEnabled: true,
    kitchenDisplayEnabled: true,
    tableReservationEnabled: true,
  });

  // Local disabled tabs state
  const [disabledTabs, setDisabledTabs] = useState<string[]>([]);

  // Local subscription assignment state
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [subDurationDays, setSubDurationDays] = useState('30');

  // Local edit restaurant info state
  const [editName, setEditName] = useState('');
  const [editSlug, setEditSlug] = useState('');
  const [editCuisine, setEditCuisine] = useState('');
  const [editCity, setEditCity] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editOwnerEmail, setEditOwnerEmail] = useState('');
  const [editOwnerPassword, setEditOwnerPassword] = useState('');
  const [editCommissionRate, setEditCommissionRate] = useState('5');
  const [editIsOpen, setEditIsOpen] = useState(true);
  const [editIsApproved, setEditIsApproved] = useState(true);
  const [editIsSuspended, setEditIsSuspended] = useState(false);

  // Sync state when details load
  useEffect(() => {
    if (restaurant) {
      const flags = restaurant.featureFlags || {};
      setFeatureFlags({
        roomServiceEnabled: flags.roomServiceEnabled !== false,
        callWaiterEnabled: flags.callWaiterEnabled !== false,
        qrOrderingEnabled: flags.qrOrderingEnabled !== false,
        onlinePaymentEnabled: flags.onlinePaymentEnabled !== false,
        aiAssistantEnabled: flags.aiAssistantEnabled !== false,
        loyaltyProgramEnabled: flags.loyaltyProgramEnabled !== false,
        kitchenDisplayEnabled: flags.kitchenDisplayEnabled !== false,
        tableReservationEnabled: flags.tableReservationEnabled !== false,
      });

      setDisabledTabs(Array.isArray(restaurant.disabledTabs) ? restaurant.disabledTabs : []);

      setEditName(restaurant.name || '');
      setEditSlug(restaurant.slug || '');
      setEditCuisine(restaurant.cuisineType || '');
      setEditCity(restaurant.city || '');
      setEditPhone(restaurant.phone || '');
      setEditEmail(restaurant.email || '');
      setEditAddress(restaurant.address || '');
      setEditOwnerEmail(restaurant.owner?.email || '');
      setEditOwnerPassword('');
      setEditCommissionRate(String(restaurant.commissionRate ?? 5));
      setEditIsOpen(restaurant.isOpen ?? true);
      setEditIsApproved(restaurant.isApproved ?? true);
      setEditIsSuspended(restaurant.isSuspended ?? false);

      if (plansData && plansData.length > 0 && !selectedPlanId) {
        setSelectedPlanId(plansData[0].id);
      }
    }
  }, [restaurant, plansData]);

  // Mutation: Save Features
  const featuresMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) return;
      await api.patch(`/admin/restaurants/${restaurantId}/features`, { featureFlags });
    },
    onSuccess: () => {
      toast.success('Restaurant feature flags updated successfully!');
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
      refetch();
      onUpdated?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update features');
    },
  });

  // Mutation: Save Tabs
  const tabsMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) return;
      await api.patch(`/admin/restaurants/${restaurantId}/tabs`, { disabledTabs });
    },
    onSuccess: () => {
      toast.success('Restaurant side tabs permissions updated successfully!');
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
      refetch();
      onUpdated?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update tabs');
    },
  });

  // Mutation: Assign Subscription Plan
  const subscriptionMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId || !selectedPlanId) return;
      await api.post(`/admin/restaurants/${restaurantId}/subscription`, {
        planId: selectedPlanId,
        durationInDays: parseInt(subDurationDays, 10) || 30,
      });
    },
    onSuccess: () => {
      toast.success('Subscription plan assigned successfully! 🎉');
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
      refetch();
      onUpdated?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to assign subscription');
    },
  });

  // Mutation: Toggle Subscription Status
  const toggleSubMutation = useMutation({
    mutationFn: async (subscriptionId: string) => {
      await api.patch(`/admin/subscriptions/${subscriptionId}/toggle`);
    },
    onSuccess: () => {
      toast.success('Subscription status toggled!');
      refetch();
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
      onUpdated?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to toggle subscription');
    },
  });

  // Mutation: Save Edit Info
  const editInfoMutation = useMutation({
    mutationFn: async () => {
      if (!restaurantId) return;
      await api.patch(`/admin/restaurants/${restaurantId}`, {
        name: editName,
        slug: editSlug || undefined,
        cuisineType: editCuisine || undefined,
        city: editCity || undefined,
        phone: editPhone || undefined,
        email: editEmail || undefined,
        address: editAddress || undefined,
        ownerEmail: editOwnerEmail || undefined,
        ownerPassword: editOwnerPassword || undefined,
        commissionRate: parseFloat(editCommissionRate) || 5,
        isOpen: editIsOpen,
        isApproved: editIsApproved,
        isSuspended: editIsSuspended,
      });
    },
    onSuccess: () => {
      toast.success('Restaurant details and owner credentials updated successfully!');
      qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
      refetch();
      onUpdated?.();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to update details');
    },
  });

  if (!isOpen) return null;

  const toggleTabAccess = (tabKey: string) => {
    setDisabledTabs((prev) =>
      prev.includes(tabKey) ? prev.filter((k) => k !== tabKey) : [...prev, tabKey]
    );
  };

  const activeSub = restaurant?.activeSubscription;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-card border border-border rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between gap-3 bg-muted/20">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center shadow-md shadow-orange-500/20 shrink-0">
              <Store className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold font-display truncate">
                  {restaurant?.name || 'Restaurant Details & Controls'}
                </h2>
                {restaurant && (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    restaurant.isSuspended
                      ? 'bg-red-500/10 text-red-600 border border-red-500/20'
                      : !restaurant.isApproved
                      ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20'
                      : 'bg-green-500/10 text-green-600 border border-green-500/20'
                  }`}>
                    {restaurant.isSuspended ? 'Suspended' : !restaurant.isApproved ? 'Pending' : 'Approved'}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-2 truncate">
                <span>/{restaurant?.slug}</span>
                {restaurant?.city && <span>• {restaurant.city}</span>}
                {restaurant && (
                  <a
                    href={`/r/${restaurant.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-0.5 text-primary hover:underline font-semibold"
                  >
                    View Menu <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => refetch()}
              className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-4 border-b border-border bg-card flex gap-1 overflow-x-auto no-scrollbar">
          {TABS_LIST.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-3.5 py-3 text-xs font-bold border-b-2 whitespace-nowrap transition-all ${
                  isActive
                    ? 'border-primary text-primary bg-primary/5'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {isLoading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-sm font-medium">Loading restaurant details & controls...</p>
            </div>
          ) : !restaurant ? (
            <div className="py-20 text-center text-muted-foreground">
              <p>Restaurant data not found.</p>
            </div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW & STATS */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Metric Badges */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3.5 rounded-2xl bg-muted/40 border border-border">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Total Revenue</p>
                      <p className="text-xl font-bold font-display text-foreground mt-1 flex items-center">
                        <IndianRupee className="w-4 h-4 text-emerald-500" />
                        {Math.round(stats?.totalRevenue ?? 0).toLocaleString()}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-2xl bg-muted/40 border border-border">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Total Orders</p>
                      <p className="text-xl font-bold font-display text-foreground mt-1">
                        {restaurant._count?.orders ?? 0}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-2xl bg-muted/40 border border-border">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Menu Items</p>
                      <p className="text-xl font-bold font-display text-foreground mt-1">
                        {restaurant._count?.menuItems ?? 0}
                      </p>
                    </div>
                    <div className="p-3.5 rounded-2xl bg-muted/40 border border-border">
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Active Plan</p>
                      <p className="text-sm font-bold font-display text-primary mt-1 truncate">
                        {activeSub?.plan?.name || 'Free / None'}
                      </p>
                    </div>
                  </div>

                  {/* Owner Credentials & Details Card */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border shadow-sm space-y-3">
                    <div className="flex items-center justify-between border-b border-border pb-3">
                      <h3 className="font-bold text-sm flex items-center gap-2">
                        <Users className="w-4 h-4 text-primary" /> Owner Account & Credentials
                      </h3>
                      <button
                        onClick={() => setActiveTab('edit')}
                        className="text-xs text-primary font-bold hover:underline"
                      >
                        Edit Credentials →
                      </button>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4 text-xs">
                      <div>
                        <span className="text-muted-foreground font-medium">Owner Full Name:</span>
                        <p className="font-bold text-foreground text-sm mt-0.5">{restaurant.owner?.name || '—'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-medium">Login Email Address:</span>
                        <p className="font-bold text-foreground text-sm mt-0.5 flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                          {restaurant.owner?.email || '—'}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-medium">Owner Phone Number:</span>
                        <p className="font-semibold text-foreground mt-0.5 flex items-center gap-1.5">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground" />
                          {restaurant.owner?.phone || restaurant.phone || '—'}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-medium">Account ID / Created:</span>
                        <p className="font-mono text-muted-foreground mt-0.5">
                          {restaurant.owner?.id?.slice(0, 16)}... ({new Date(restaurant.createdAt).toLocaleDateString()})
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Restaurant Details */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border shadow-sm space-y-3">
                    <h3 className="font-bold text-sm flex items-center gap-2 border-b border-border pb-3">
                      <MapPin className="w-4 h-4 text-primary" /> Physical Location & Contact
                    </h3>
                    <div className="grid sm:grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="text-muted-foreground font-medium">Address:</span>
                        <p className="font-semibold text-foreground mt-0.5">{restaurant.address || '—'}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-medium">City & Pincode:</span>
                        <p className="font-semibold text-foreground mt-0.5">
                          {restaurant.city || '—'} {restaurant.pincode ? `(${restaurant.pincode})` : ''}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground font-medium">Cuisine Type:</span>
                        <p className="font-semibold text-foreground mt-0.5">{restaurant.cuisineType || 'General'}</p>
                      </div>
                    </div>
                  </div>

                  {/* Recent Orders */}
                  <div className="p-4 sm:p-5 rounded-2xl bg-card border border-border shadow-sm space-y-3">
                    <h3 className="font-bold text-sm flex items-center gap-2 border-b border-border pb-3">
                      <ShoppingBag className="w-4 h-4 text-primary" /> Recent Orders ({recentOrders.length})
                    </h3>
                    {recentOrders.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No recent orders placed yet.</p>
                    ) : (
                      <div className="divide-y divide-border overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-muted-foreground pb-2">
                              <th className="pb-2 font-medium">Order ID</th>
                              <th className="pb-2 font-medium">Table/Room</th>
                              <th className="pb-2 font-medium">Status</th>
                              <th className="pb-2 font-medium">Payment</th>
                              <th className="pb-2 font-medium text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {recentOrders.map((o: any) => (
                              <tr key={o.id} className="hover:bg-muted/20">
                                <td className="py-2.5 font-mono">#{o.id.slice(-6).toUpperCase()}</td>
                                <td className="py-2.5 font-medium">
                                  {o.tableNumber ? (o.tableNumber.toLowerCase().includes('room') ? `🛎️ ${o.tableNumber}` : `Table ${o.tableNumber}`) : '—'}
                                </td>
                                <td className="py-2.5">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-muted text-foreground">
                                    {o.status}
                                  </span>
                                </td>
                                <td className="py-2.5">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                    o.paymentStatus === 'PAID' ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-600'
                                  }`}>
                                    {o.paymentStatus}
                                  </span>
                                </td>
                                <td className="py-2.5 font-bold text-right">₹{o.total}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: FEATURE TOGGLES */}
              {activeTab === 'features' && (
                <div className="space-y-5">
                  <div className="p-3.5 rounded-2xl bg-primary/10 border border-primary/20 text-xs text-foreground flex items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-primary">Admin Feature Toggles Center</p>
                      <p className="text-muted-foreground mt-0.5">
                        Enable or disable specific platform capabilities for this restaurant. When disabled, customers or staff will be blocked from accessing those services.
                      </p>
                    </div>
                    <button
                      onClick={() => featuresMutation.mutate()}
                      disabled={featuresMutation.isPending}
                      className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-xl text-xs shadow-md hover:bg-primary/95 transition-all shrink-0 flex items-center gap-1.5 cursor-pointer"
                    >
                      {featuresMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save Features
                    </button>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    {/* Hotel Room Service (Requested specifically by User) */}
                    <div className={`p-4 rounded-2xl border transition-all ${
                      featureFlags.roomServiceEnabled
                        ? 'bg-amber-500/5 border-amber-500/30 shadow-sm'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            featureFlags.roomServiceEnabled ? 'bg-amber-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <Bed className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">Hotel Room Service Calling</h4>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              featureFlags.roomServiceEnabled ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                            }`}>
                              {featureFlags.roomServiceEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureFlags.roomServiceEnabled}
                            onChange={(e) => setFeatureFlags({ ...featureFlags, roomServiceEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        Allow hotel guests scanning Room QR codes to call room service (Room Cleaning, Food Delivery, Ironing, Laundry, Custom Requests).
                      </p>
                    </div>

                    {/* Table Waiter Call */}
                    <div className={`p-4 rounded-2xl border transition-all ${
                      featureFlags.callWaiterEnabled
                        ? 'bg-blue-500/5 border-blue-500/30 shadow-sm'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            featureFlags.callWaiterEnabled ? 'bg-blue-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <BellRing className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">Table Waiter Calling</h4>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              featureFlags.callWaiterEnabled ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                            }`}>
                              {featureFlags.callWaiterEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureFlags.callWaiterEnabled}
                            onChange={(e) => setFeatureFlags({ ...featureFlags, callWaiterEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        Allow dining customers at tables to request waiter assistance, bill request, or water with one click.
                      </p>
                    </div>

                    {/* Digital QR Table Ordering */}
                    <div className={`p-4 rounded-2xl border transition-all ${
                      featureFlags.qrOrderingEnabled
                        ? 'bg-emerald-500/5 border-emerald-500/30 shadow-sm'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            featureFlags.qrOrderingEnabled ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <QrCode className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">Digital QR Code Ordering</h4>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              featureFlags.qrOrderingEnabled ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                            }`}>
                              {featureFlags.qrOrderingEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureFlags.qrOrderingEnabled}
                            onChange={(e) => setFeatureFlags({ ...featureFlags, qrOrderingEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        Allow customers scanning table/room QR codes to place live food orders from their mobile browsers.
                      </p>
                    </div>

                    {/* Online Payments & UPI */}
                    <div className={`p-4 rounded-2xl border transition-all ${
                      featureFlags.onlinePaymentEnabled
                        ? 'bg-purple-500/5 border-purple-500/30 shadow-sm'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            featureFlags.onlinePaymentEnabled ? 'bg-purple-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <CreditCard className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">Online Payments & UPI Intent</h4>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              featureFlags.onlinePaymentEnabled ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                            }`}>
                              {featureFlags.onlinePaymentEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureFlags.onlinePaymentEnabled}
                            onChange={(e) => setFeatureFlags({ ...featureFlags, onlinePaymentEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-500"></div>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        Enable direct UPI QR codes, GPay/PhonePe intents, and card payment settlement at checkout.
                      </p>
                    </div>

                    {/* AI Assistant Concierge */}
                    <div className={`p-4 rounded-2xl border transition-all ${
                      featureFlags.aiAssistantEnabled
                        ? 'bg-cyan-500/5 border-cyan-500/30 shadow-sm'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            featureFlags.aiAssistantEnabled ? 'bg-cyan-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <Sparkles className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">AI Food Concierge</h4>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              featureFlags.aiAssistantEnabled ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                            }`}>
                              {featureFlags.aiAssistantEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureFlags.aiAssistantEnabled}
                            onChange={(e) => setFeatureFlags({ ...featureFlags, aiAssistantEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        Provide Gemini AI powered conversational food assistance and customized dish recommendations.
                      </p>
                    </div>

                    {/* Loyalty Points Program */}
                    <div className={`p-4 rounded-2xl border transition-all ${
                      featureFlags.loyaltyProgramEnabled
                        ? 'bg-yellow-500/5 border-yellow-500/30 shadow-sm'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            featureFlags.loyaltyProgramEnabled ? 'bg-yellow-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <Gift className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">Loyalty Points Program</h4>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              featureFlags.loyaltyProgramEnabled ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                            }`}>
                              {featureFlags.loyaltyProgramEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureFlags.loyaltyProgramEnabled}
                            onChange={(e) => setFeatureFlags({ ...featureFlags, loyaltyProgramEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-yellow-500"></div>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        Reward dining customers with loyalty reward points to redeem for bill discounts on future visits.
                      </p>
                    </div>

                    {/* Kitchen Display & Staff */}
                    <div className={`p-4 rounded-2xl border transition-all ${
                      featureFlags.kitchenDisplayEnabled
                        ? 'bg-orange-500/5 border-orange-500/30 shadow-sm'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            featureFlags.kitchenDisplayEnabled ? 'bg-orange-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <ChefHat className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">Kitchen Staff & KDS View</h4>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              featureFlags.kitchenDisplayEnabled ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                            }`}>
                              {featureFlags.kitchenDisplayEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureFlags.kitchenDisplayEnabled}
                            onChange={(e) => setFeatureFlags({ ...featureFlags, kitchenDisplayEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500"></div>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        Enable kitchen display screens and staff logins for real-time prep status changes.
                      </p>
                    </div>

                    {/* Table Reservations */}
                    <div className={`p-4 rounded-2xl border transition-all ${
                      featureFlags.tableReservationEnabled
                        ? 'bg-indigo-500/5 border-indigo-500/30 shadow-sm'
                        : 'bg-muted/30 border-border opacity-70'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            featureFlags.tableReservationEnabled ? 'bg-indigo-500 text-white' : 'bg-muted text-muted-foreground'
                          }`}>
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="font-bold text-sm">Table & Room Reservations</h4>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              featureFlags.tableReservationEnabled ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-600'
                            }`}>
                              {featureFlags.tableReservationEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={featureFlags.tableReservationEnabled}
                            onChange={(e) => setFeatureFlags({ ...featureFlags, tableReservationEnabled: e.target.checked })}
                            className="sr-only peer"
                          />
                          <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-500"></div>
                        </label>
                      </div>
                      <p className="text-xs text-muted-foreground mt-3 leading-relaxed">
                        Allow online guests to book and reserve tables or rooms ahead of time.
                      </p>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => featuresMutation.mutate()}
                      disabled={featuresMutation.isPending}
                      className="px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-xs shadow-md hover:bg-primary/95 transition-all flex items-center gap-2 cursor-pointer"
                    >
                      {featuresMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save Feature Flags
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: SIDE TABS CONTROL */}
              {activeTab === 'sideTabs' && (
                <div className="space-y-5">
                  <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-foreground flex items-center justify-between gap-3">
                    <div>
                      <p className="font-bold text-amber-600 dark:text-amber-400">Restaurant Owner Navigation Controls</p>
                      <p className="text-muted-foreground mt-0.5">
                        Enable or disable specific sidebar tabs in the restaurant owner's dashboard. Disabled tabs will be locked and inaccessible to the restaurant owner.
                      </p>
                    </div>
                    <button
                      onClick={() => tabsMutation.mutate()}
                      disabled={tabsMutation.isPending}
                      className="px-4 py-2 bg-primary text-primary-foreground font-bold rounded-xl text-xs shadow-md hover:bg-primary/95 transition-all shrink-0 flex items-center gap-1.5 cursor-pointer"
                    >
                      {tabsMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save Tab Permissions
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    {AVAILABLE_SIDE_TABS.map((tab) => {
                      const Icon = tab.icon;
                      const isTabDisabled = disabledTabs.includes(tab.key);
                      const isEnabled = !isTabDisabled;

                      return (
                        <div
                          key={tab.key}
                          onClick={() => toggleTabAccess(tab.key)}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                            isEnabled
                              ? 'bg-card border-border hover:border-primary/40'
                              : 'bg-muted/40 border-dashed border-border/80 opacity-70'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                              isEnabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                            }`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm text-foreground">{tab.label}</span>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  isEnabled
                                    ? 'bg-green-500/10 text-green-600'
                                    : 'bg-red-500/10 text-red-600 flex items-center gap-1'
                                }`}>
                                  {!isEnabled && <Lock className="w-2.5 h-2.5" />}
                                  {isEnabled ? 'Enabled / Visible' : 'Disabled / Locked'}
                                </span>
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{tab.desc}</p>
                            </div>
                          </div>

                          <label className="relative inline-flex items-center cursor-pointer shrink-0" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isEnabled}
                              onChange={() => toggleTabAccess(tab.key)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
                          </label>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      onClick={() => tabsMutation.mutate()}
                      disabled={tabsMutation.isPending}
                      className="px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-xs shadow-md hover:bg-primary/95 transition-all flex items-center gap-2 cursor-pointer"
                    >
                      {tabsMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Save Tab Permissions
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 4: SUBSCRIPTION MANAGEMENT */}
              {activeTab === 'subscription' && (
                <div className="space-y-6">
                  {/* Current Plan Status Card */}
                  <div className="p-5 rounded-2xl bg-card border border-border shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b border-border pb-3">
                      <div>
                        <span className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Active Subscription</span>
                        <h3 className="font-display font-extrabold text-xl text-foreground mt-0.5">
                          {activeSub?.plan?.name ? `${activeSub.plan.name} Tier` : 'No Active Subscription'}
                        </h3>
                      </div>
                      <div className="flex items-center gap-2">
                        {activeSub ? (
                          <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                            activeSub.isActive
                              ? 'bg-green-500/10 text-green-600 border border-green-500/20'
                              : 'bg-red-500/10 text-red-600 border border-red-500/20'
                          }`}>
                            {activeSub.isActive ? '🟢 Active' : '🔴 Inactive / Cancelled'}
                          </span>
                        ) : (
                          <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-muted text-muted-foreground">
                            Free Plan
                          </span>
                        )}
                      </div>
                    </div>

                    {activeSub && (
                      <div className="grid sm:grid-cols-3 gap-4 text-xs">
                        <div>
                          <span className="text-muted-foreground font-medium">Plan Cost:</span>
                          <p className="font-bold text-foreground text-sm mt-0.5">₹{activeSub.plan.price} / cycle</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground font-medium">Start Date:</span>
                          <p className="font-semibold text-foreground mt-0.5">{new Date(activeSub.startsAt).toLocaleDateString()}</p>
                        </div>
                        <div>
                          <span className="text-muted-foreground font-medium">Expiration Date:</span>
                          <p className="font-semibold text-foreground mt-0.5">{new Date(activeSub.expiresAt).toLocaleDateString()}</p>
                        </div>
                      </div>
                    )}

                    {activeSub && (
                      <div className="pt-2 flex items-center justify-between">
                        <p className="text-xs text-muted-foreground">
                          {activeSub.isActive ? 'Subscription is currently active and unlocks tier features.' : 'Subscription is currently halted.'}
                        </p>
                        <button
                          onClick={() => toggleSubMutation.mutate(activeSub.id)}
                          disabled={toggleSubMutation.isPending}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                            activeSub.isActive
                              ? 'border-red-500/30 text-red-600 hover:bg-red-500/10'
                              : 'border-green-500/30 text-green-600 hover:bg-green-500/10'
                          }`}
                        >
                          {activeSub.isActive ? 'Deactivate Subscription' : 'Reactivate Subscription'}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Assign / Change Subscription Form */}
                  <div className="p-5 rounded-2xl bg-muted/20 border border-border space-y-4">
                    <h3 className="font-bold text-sm flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-primary" /> Assign or Upgrade Subscription Plan
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Select a subscription package to assign to this restaurant. This sets their active plan and updates their renewal expiration date.
                    </p>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                          Select Subscription Plan
                        </label>
                        <select
                          value={selectedPlanId}
                          onChange={(e) => setSelectedPlanId(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                          {plansData?.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} — ₹{p.price}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-muted-foreground block mb-1.5">
                          Subscription Duration
                        </label>
                        <select
                          value={subDurationDays}
                          onChange={(e) => setSubDurationDays(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-card border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                        >
                          <option value="30">30 Days (1 Month)</option>
                          <option value="60">60 Days (2 Months)</option>
                          <option value="90">90 Days (1 Quarter)</option>
                          <option value="180">180 Days (Half Year)</option>
                          <option value="365">365 Days (1 Year)</option>
                          <option value="730">730 Days (2 Years)</option>
                        </select>
                      </div>
                    </div>

                    {/* Calculated Price Summary */}
                    {(() => {
                      const selectedPlanObj = plansData?.find((p) => p.id === selectedPlanId);
                      const adminDurationDays = parseInt(subDurationDays, 10) || 30;
                      const adminMonths = adminDurationDays >= 360 ? Math.round(adminDurationDays / 365) * 12 : Math.max(1, Math.round(adminDurationDays / 30));
                      const adminTotalPrice = selectedPlanObj ? selectedPlanObj.price * adminMonths : 0;
                      return (
                        <div className="p-3 rounded-xl bg-card border border-border text-xs flex items-center justify-between">
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span>Duration: <strong className="text-foreground">{adminDurationDays} Days ({adminMonths} Mo)</strong></span>
                            <span>•</span>
                            <span>Rate: <strong className="text-foreground">₹{selectedPlanObj?.price ?? 0}/mo</strong></span>
                          </div>
                          <div className="font-bold text-sm text-primary">
                            Total: ₹{adminTotalPrice.toLocaleString('en-IN')}
                          </div>
                        </div>
                      );
                    })()}

                    <div className="flex justify-end pt-2">
                      <button
                        onClick={() => subscriptionMutation.mutate()}
                        disabled={subscriptionMutation.isPending || !selectedPlanId}
                        className="px-5 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-xs shadow-md hover:bg-primary/95 transition-all flex items-center gap-2 cursor-pointer"
                      >
                        {subscriptionMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Assign Subscription Plan
                      </button>
                    </div>
                  </div>

                  {/* Subscription History */}
                  {restaurant.subscription && restaurant.subscription.length > 0 && (
                    <div className="p-5 rounded-2xl bg-card border border-border space-y-3">
                      <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground">
                        Subscription History ({restaurant.subscription.length})
                      </h4>
                      <div className="divide-y divide-border text-xs">
                        {restaurant.subscription.map((s: any) => {
                          const days = Math.max(1, Math.round((new Date(s.expiresAt).getTime() - new Date(s.startsAt).getTime()) / (1000 * 60 * 60 * 24)));
                          const months = days >= 360 ? 12 : Math.max(1, Math.round(days / 30));
                          const totalPaid = (s.plan?.price ?? 0) * months;
                          return (
                            <div key={s.id} className="py-2.5 flex items-center justify-between">
                              <div>
                                <p className="font-bold text-foreground">
                                  {s.plan?.name || 'Plan'}
                                  <span className="font-medium text-muted-foreground ml-2">₹{totalPaid.toLocaleString('en-IN')} ({days}d)</span>
                                </p>
                                <p className="text-[11px] text-muted-foreground">
                                  {new Date(s.startsAt).toLocaleDateString()} – {new Date(s.expiresAt).toLocaleDateString()}
                                </p>
                              </div>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                s.isActive ? 'bg-green-500/10 text-green-600' : 'bg-muted text-muted-foreground'
                              }`}>
                                {s.isActive ? 'Active' : 'Expired/Historical'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 5: EDIT INFO & CREDENTIALS */}
              {activeTab === 'edit' && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    editInfoMutation.mutate();
                  }}
                  className="space-y-5"
                >
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">Restaurant Name</label>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        required
                        className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">URL Slug</label>
                      <input
                        value={editSlug}
                        onChange={(e) => setEditSlug(e.target.value)}
                        className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">Cuisine Type</label>
                      <input
                        value={editCuisine}
                        onChange={(e) => setEditCuisine(e.target.value)}
                        className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">City</label>
                      <input
                        value={editCity}
                        onChange={(e) => setEditCity(e.target.value)}
                        className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">Restaurant Phone</label>
                      <input
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">Platform Commission Rate (%)</label>
                      <input
                        type="number"
                        step="0.1"
                        value={editCommissionRate}
                        onChange={(e) => setEditCommissionRate(e.target.value)}
                        className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="text-xs font-semibold text-muted-foreground block mb-1">Physical Address</label>
                      <input
                        value={editAddress}
                        onChange={(e) => setEditAddress(e.target.value)}
                        className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                      />
                    </div>
                  </div>

                  {/* Owner Credentials */}
                  <div className="p-4 rounded-2xl bg-muted/30 border border-border space-y-3">
                    <h4 className="font-bold text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-primary" /> Owner Login Credentials
                    </h4>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground block mb-1">Owner Email Address</label>
                        <input
                          type="email"
                          value={editOwnerEmail}
                          onChange={(e) => setEditOwnerEmail(e.target.value)}
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-muted-foreground block mb-1">
                          Reset Owner Password <span className="text-[10px] text-muted-foreground font-normal">(Leave blank to keep unchanged)</span>
                        </label>
                        <input
                          type="password"
                          value={editOwnerPassword}
                          onChange={(e) => setEditOwnerPassword(e.target.value)}
                          placeholder="New password..."
                          className="w-full px-3.5 py-2 bg-card border border-border rounded-xl text-sm"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Status switches */}
                  <div className="grid sm:grid-cols-3 gap-3">
                    <label className="p-3 rounded-2xl border border-border bg-card flex items-center justify-between cursor-pointer">
                      <span className="text-xs font-semibold">Store Is Open</span>
                      <input
                        type="checkbox"
                        checked={editIsOpen}
                        onChange={(e) => setEditIsOpen(e.target.checked)}
                        className="rounded border-border text-primary"
                      />
                    </label>
                    <label className="p-3 rounded-2xl border border-border bg-card flex items-center justify-between cursor-pointer">
                      <span className="text-xs font-semibold">Is Approved</span>
                      <input
                        type="checkbox"
                        checked={editIsApproved}
                        onChange={(e) => setEditIsApproved(e.target.checked)}
                        className="rounded border-border text-primary"
                      />
                    </label>
                    <label className="p-3 rounded-2xl border border-border bg-card flex items-center justify-between cursor-pointer">
                      <span className="text-xs font-semibold text-red-500">Is Suspended</span>
                      <input
                        type="checkbox"
                        checked={editIsSuspended}
                        onChange={(e) => setEditIsSuspended(e.target.checked)}
                        className="rounded border-border text-red-500"
                      />
                    </label>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={editInfoMutation.isPending}
                      className="px-6 py-2.5 bg-primary text-primary-foreground font-bold rounded-xl text-xs shadow-md hover:bg-primary/95 transition-all flex items-center gap-2 cursor-pointer"
                    >
                      {editInfoMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Save All Changes
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
