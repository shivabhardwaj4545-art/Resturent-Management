'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CreditCard, CheckCircle2, AlertTriangle, Clock, Sparkles,
  ShieldCheck, ArrowRight, RefreshCw, Menu, Check, Zap,
  Store, Calendar, ShieldAlert, Award, Star, Loader2, HelpCircle
} from 'lucide-react';
import { OwnerSidebar } from '@/components/owner/OwnerSidebar';
import { ThemeToggle } from '@/components/ThemeToggle';
import api from '@/lib/api';
import { toast } from 'sonner';

type Plan = {
  id: string;
  name: string;
  price: number;
  features: string[] | Record<string, any>;
};

type Subscription = {
  id: string;
  planId: string;
  startsAt: string;
  expiresAt: string;
  isActive: boolean;
  plan: Plan;
};

export function OwnerSubscriptionPage() {
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedDuration, setSelectedDuration] = useState<Record<string, number>>({});
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['owner-subscription'],
    queryFn: async () => {
      const res = await api.get('/owner/subscription');
      return res.data.data as {
        plans: Plan[];
        activeSubscription: Subscription | null;
        subscriptions: Subscription[];
        restaurant: { id: string; name: string; isSuspended: boolean; isOpen: boolean };
      };
    },
  });

  const buySubscriptionMutation = useMutation({
    mutationFn: async ({ planId, durationInDays }: { planId: string; durationInDays: number }) => {
      const res = await api.post('/owner/subscription/buy', { planId, durationInDays });
      return res.data;
    },
    onSuccess: (res) => {
      toast.success(res.message || 'Subscription activated successfully! 🎉', {
        description: 'Your restaurant has been automatically reactivated and is ready for orders.',
        duration: 5000,
      });
      setSubscribingPlanId(null);
      qc.invalidateQueries({ queryKey: ['owner-subscription'] });
      qc.invalidateQueries({ queryKey: ['owner-restaurant-sidebar'] });
      qc.invalidateQueries({ queryKey: ['owner-restaurant-layout'] });
      qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
      refetch();
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to complete subscription purchase.');
      setSubscribingPlanId(null);
    },
  });

  const activeSub = data?.activeSubscription;
  const restaurant = data?.restaurant;
  const isSuspended = restaurant?.isSuspended;

  // Calculate days remaining
  const daysRemaining = activeSub
    ? Math.max(0, Math.ceil((new Date(activeSub.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0;

  const getPlanPriceForDuration = (basePrice: number, duration: number) => {
    if (basePrice <= 0) return 0;
    if (duration === 30) return basePrice;
    if (duration === 90) return basePrice * 3;
    if (duration === 180) return basePrice * 6;
    if (duration === 365) return basePrice * 12;
    const months = Math.max(1, Math.round(duration / 30));
    return basePrice * months;
  };

  const getDurationLabel = (duration: number) => {
    if (duration === 30) return '1 Mo';
    if (duration === 90) return '3 Mo';
    if (duration === 180) return '6 Mo';
    if (duration === 365) return '1 Yr';
    return `${duration}d`;
  };

  const getDurationFullText = (duration: number) => {
    if (duration === 30) return '1 Month (30 days)';
    if (duration === 90) return '3 Months (90 days)';
    if (duration === 180) return '6 Months (180 days)';
    if (duration === 365) return '1 Year (365 days)';
    return `${duration} days`;
  };

  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') return resolve(false);
      if ((window as any).Razorpay) return resolve(true);
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleBuy = async (plan: Plan) => {
    const duration = selectedDuration[plan.id] || 30;
    const totalPrice = getPlanPriceForDuration(plan.price, duration);
    const durationDesc = getDurationFullText(duration);

    setSubscribingPlanId(plan.id);

    try {
      // 1. Create order on server
      const orderRes = await api.post('/owner/subscription/create-order', {
        planId: plan.id,
        durationInDays: duration,
      });

      const orderData = orderRes.data.data;

      // If free plan, activate directly
      if (orderData.isFree) {
        buySubscriptionMutation.mutate({ planId: plan.id, durationInDays: duration });
        return;
      }

      // 2. Load Razorpay SDK
      const isLoaded = await loadRazorpayScript();
      if (!isLoaded || !(window as any).Razorpay) {
        toast.info('Razorpay modal unavailable, proceeding with direct activation.');
        buySubscriptionMutation.mutate({ planId: plan.id, durationInDays: duration });
        return;
      }

      // 3. Launch Razorpay Checkout Modal
      const options = {
        key: orderData.keyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID,
        amount: orderData.amountInPaise,
        currency: orderData.currency || 'INR',
        name: 'EZ- Restaurant',
        description: `${plan.name} Tier Subscription (${duration} days)`,
        order_id: orderData.orderId,
        prefill: {
          name: orderData.user?.name || orderData.restaurant?.name,
          email: orderData.user?.email || '',
          contact: orderData.user?.phone || '',
        },
        theme: {
          color: '#f97316',
        },
        handler: async (response: any) => {
          try {
            const verifyRes = await api.post('/owner/subscription/verify-payment', {
              planId: plan.id,
              durationInDays: duration,
              razorpayOrderId: response.razorpay_order_id || orderData.orderId,
              razorpayPaymentId: response.razorpay_payment_id,
              razorpaySignature: response.razorpay_signature,
            });

            toast.success('Payment Successful! 🎉', {
              description: verifyRes.data.message || `Your restaurant is now active under the ${plan.name} plan.`,
              duration: 5000,
            });

            qc.invalidateQueries({ queryKey: ['owner-subscription'] });
            qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
            qc.invalidateQueries({ queryKey: ['owner-restaurant-sidebar'] });
            qc.invalidateQueries({ queryKey: ['owner-restaurant-layout'] });
            qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
            refetch();
          } catch (verifyErr: any) {
            toast.error(verifyErr.response?.data?.message || 'Payment verification failed. Please contact support.');
          } finally {
            setSubscribingPlanId(null);
          }
        },
        modal: {
          ondismiss: () => {
            setSubscribingPlanId(null);
            toast.info('Payment checkout closed.');
          },
        },
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', (resp: any) => {
        toast.error(`Payment failed: ${resp.error?.description || 'Transaction declined'}`);
        setSubscribingPlanId(null);
      });
      rzp.open();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to initiate Razorpay subscription order');
      setSubscribingPlanId(null);
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <OwnerSidebar mobileOpen={sidebarOpen} onMobileClose={() => setSidebarOpen(false)} />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-between px-4 sm:px-6 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm gap-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-xl text-muted-foreground hover:bg-muted"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-base sm:text-xl font-bold font-display flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-primary" />
                Subscription Plans & Billing
              </h1>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Choose a plan to power your restaurant, unlock management tools, and keep ordering active.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <ThemeToggle size="sm" />
          </div>
        </header>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6 max-w-6xl w-full mx-auto">
          {/* Suspended Alert Banner */}
          {isSuspended && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 sm:p-5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-400 flex items-start gap-3 shadow-md"
            >
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1 text-xs sm:text-sm">
                <p className="font-extrabold text-sm sm:text-base">Restaurant Suspended due to Inactive / Expired Subscription</p>
                <p className="mt-1 leading-relaxed opacity-90">
                  Your restaurant is currently suspended and customers cannot place orders. Please select and subscribe to any of the plans below to instantly reactivate your restaurant and reopen your digital ordering portal.
                </p>
              </div>
            </motion.div>
          )}

          {/* Active Subscription Status Banner */}
          {activeSub ? (
            <div className="p-5 sm:p-6 rounded-3xl bg-card border border-border shadow-sm relative overflow-hidden">
              <div className="absolute top-0 right-0 w-36 h-36 bg-primary/5 rounded-bl-full pointer-events-none" />
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/20 shrink-0">
                    <Award className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Current Tier</span>
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">
                        🟢 Active
                      </span>
                    </div>
                    <h2 className="text-xl sm:text-2xl font-black font-display text-foreground mt-0.5">
                      {activeSub.plan.name} Tier
                    </h2>
                  </div>
                </div>

                <div className="flex items-center gap-4 text-xs sm:text-sm">
                  <div className="p-3 rounded-2xl bg-muted/30 border border-border">
                    <span className="text-muted-foreground block text-[11px] font-semibold">Remaining Validity</span>
                    <span className="font-extrabold text-primary text-base">
                      {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  <div className="p-3 rounded-2xl bg-muted/30 border border-border">
                    <span className="text-muted-foreground block text-[11px] font-semibold">Renewal Expiration</span>
                    <span className="font-bold text-foreground">
                      {new Date(activeSub.expiresAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : !isSuspended && (
            <div className="p-4 sm:p-5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 flex items-center justify-between gap-3 text-xs sm:text-sm">
              <div className="flex items-center gap-2.5">
                <AlertTriangle className="w-5 h-5 shrink-0" />
                <span>You are currently on a <strong>Free Starter Trial</strong>. Upgrade to a paid plan below to unlock full restaurant capabilities!</span>
              </div>
            </div>
          )}

          {/* Pricing Tiers Section */}
          <div className="space-y-4">
            <div>
              <h2 className="font-display font-extrabold text-lg sm:text-xl text-foreground">
                Available Subscription Plans
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Select your preferred package. Subscribing automatically extends or reactivates your restaurant.
              </p>
            </div>

            {isLoading ? (
              <div className="grid md:grid-cols-3 gap-5">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-96 rounded-3xl bg-card border border-border animate-pulse p-6" />
                ))}
              </div>
            ) : (
              <div className="grid md:grid-cols-3 gap-6 items-stretch">
                {data?.plans?.map((plan) => {
                  const isCurrentPlan = activeSub?.planId === plan.id && activeSub.isActive;
                  const isHighlighted = plan.name.toLowerCase().includes('pro') || plan.name.toLowerCase().includes('popular');

                  // Normalize features list
                  const features = Array.isArray(plan.features)
                    ? plan.features
                    : typeof plan.features === 'object' && plan.features !== null
                    ? Object.entries(plan.features).map(([k, v]) => `${k}: ${v}`)
                    : [
                        'Full Digital Menu & Categories',
                        'Table & Hotel Room Service Calling',
                        'QR Code Ordering Portal',
                        'Real-time Order Management',
                        'Customer Reviews & Analytics',
                      ];

                  const duration = selectedDuration[plan.id] || 30;

                  return (
                    <motion.div
                      key={plan.id}
                      initial={{ opacity: 0, y: 15 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`rounded-3xl p-6 sm:p-7 flex flex-col justify-between transition-all relative overflow-hidden border shadow-sm ${
                        isHighlighted
                          ? 'bg-card border-primary ring-2 ring-primary/20 shadow-lg shadow-primary/5'
                          : 'bg-card border-border hover:border-primary/40'
                      }`}
                    >
                      {isHighlighted && (
                        <div className="absolute top-4 right-4 px-2.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-extrabold uppercase tracking-wider shadow-sm">
                          Recommended
                        </div>
                      )}

                      <div>
                        <div className="mb-4">
                          <h3 className="font-display font-extrabold text-xl text-foreground">{plan.name}</h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            {plan.price === 0 ? 'Essential features to get started' : 'Designed to accelerate growing restaurants'}
                          </p>
                        </div>

                        {/* Price */}
                        {(() => {
                          const totalPrice = getPlanPriceForDuration(plan.price, duration);
                          const monthsCount = duration === 365 ? 12 : Math.max(1, Math.round(duration / 30));
                          return (
                            <div className="my-5 pb-5 border-b border-border">
                              <div className="flex items-baseline gap-1.5 flex-wrap">
                                <span className="text-3xl sm:text-4xl font-black font-display text-foreground transition-all">
                                  ₹{totalPrice.toLocaleString('en-IN')}
                                </span>
                                <span className="text-xs text-muted-foreground font-semibold">
                                  / {getDurationLabel(duration)} ({duration} days)
                                </span>
                              </div>
                              {monthsCount > 1 && plan.price > 0 && (
                                <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-muted-foreground">
                                  <span>Rate: <strong className="text-foreground font-bold">₹{plan.price.toLocaleString('en-IN')}/mo</strong></span>
                                  <span>•</span>
                                  <span className="px-1.5 py-0.5 rounded-md bg-primary/10 text-primary font-bold text-[10px]">
                                    {monthsCount} months billing
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {/* Duration Selector */}
                        <div className="mb-5">
                          <label className="text-[11px] font-bold text-muted-foreground block mb-2 uppercase tracking-wider">
                            Choose Duration
                          </label>
                          <div className="grid grid-cols-4 gap-1.5">
                            {[30, 90, 180, 365].map((d) => (
                              <button
                                key={d}
                                type="button"
                                onClick={() => setSelectedDuration({ ...selectedDuration, [plan.id]: d })}
                                className={`py-1.5 px-1 rounded-xl text-xs font-bold transition-all border ${
                                  duration === d
                                    ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                                    : 'bg-muted/40 border-border text-muted-foreground hover:bg-muted'
                                }`}
                              >
                                {getDurationLabel(d)}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Feature List */}
                        <div className="space-y-3 mb-6">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">What's Included:</p>
                          {features.map((feature, idx) => (
                            <div key={idx} className="flex items-start gap-2.5 text-xs text-muted-foreground leading-relaxed">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                              <span className="text-foreground">{String(feature)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* CTA Action Button */}
                      <div className="pt-4 border-t border-border">
                        {(() => {
                          const totalPrice = getPlanPriceForDuration(plan.price, duration);
                          return (
                            <button
                              onClick={() => handleBuy(plan)}
                              disabled={buySubscriptionMutation.isPending}
                              className={`w-full py-3 px-4 rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer ${
                                isCurrentPlan
                                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                  : isHighlighted
                                  ? 'bg-primary hover:bg-primary/95 text-primary-foreground shadow-primary/20'
                                  : 'bg-foreground text-background hover:opacity-90'
                              }`}
                            >
                              {subscribingPlanId === plan.id ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span>Activating Plan...</span>
                                </>
                              ) : isCurrentPlan ? (
                                <>
                                  <RefreshCw className="w-4 h-4" />
                                  <span>Renew / Extend ({getDurationLabel(duration)} · ₹{totalPrice.toLocaleString('en-IN')})</span>
                                </>
                              ) : (
                                <>
                                  <Zap className="w-4 h-4" />
                                  <span>Subscribe Now ({getDurationLabel(duration)} · ₹{totalPrice.toLocaleString('en-IN')})</span>
                                </>
                              )}
                            </button>
                          );
                        })()}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Past Subscription History Table */}
          {data?.subscriptions && data.subscriptions.length > 0 && (
            <div className="p-5 sm:p-6 rounded-3xl bg-card border border-border shadow-sm space-y-4">
              <h3 className="font-display font-bold text-base flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" /> Subscription & Renewal History
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground text-left">
                      <th className="pb-3 font-semibold">Tier Plan</th>
                      <th className="pb-3 font-semibold">Amount</th>
                      <th className="pb-3 font-semibold">Start Date</th>
                      <th className="pb-3 font-semibold">Expiration Date</th>
                      <th className="pb-3 font-semibold text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.subscriptions.map((sub) => {
                      const days = Math.max(1, Math.round((new Date(sub.expiresAt).getTime() - new Date(sub.startsAt).getTime()) / (1000 * 60 * 60 * 24)));
                      const months = days >= 360 ? 12 : Math.max(1, Math.round(days / 30));
                      const totalPaid = sub.plan.price * months;
                      return (
                        <tr key={sub.id} className="hover:bg-muted/20">
                          <td className="py-3 font-bold text-foreground">
                            {sub.plan.name}
                            <span className="text-[10px] text-muted-foreground font-normal ml-1.5">({days}d)</span>
                          </td>
                          <td className="py-3 font-semibold text-foreground">
                            ₹{totalPaid.toLocaleString('en-IN')}
                            {months > 1 && <span className="text-[10px] text-muted-foreground ml-1">(@ ₹{sub.plan.price}/mo)</span>}
                          </td>
                          <td className="py-3 text-muted-foreground">{new Date(sub.startsAt).toLocaleDateString()}</td>
                          <td className="py-3 text-muted-foreground">{new Date(sub.expiresAt).toLocaleDateString()}</td>
                          <td className="py-3 text-right">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              sub.isActive ? 'bg-green-500/10 text-green-600 border border-green-500/20' : 'bg-muted text-muted-foreground'
                            }`}>
                              {sub.isActive ? 'Active' : 'Expired'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
