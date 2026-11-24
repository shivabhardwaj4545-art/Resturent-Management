'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ChevronLeft, CreditCard, Banknote, Wallet, MapPin, User, Phone, Loader2, Plus, PlusCircle, Check, Lock, X, Smartphone, Building, Copy, QrCode, AlertCircle, UtensilsCrossed, Pencil, Tag, Percent } from 'lucide-react';
import { useCartStore } from '@/store/cart.store';
import { useAuthStore } from '@/store/auth.store';
import api, { getSocketUrl } from '@/services/api';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getImageUrl } from '@/lib/image';
import { generateUniqueTableCode } from '@/utils/tableCode';
import QRCode from 'qrcode';
import { buildAppUpiUrl, triggerUpiLaunch } from '@/utils/upiIntent';
import { applyThemeColor } from '@/utils/theme';

declare global {
  interface Window {
    Razorpay: new (options: RazorpayOptions) => {
      open: () => void;
      on: (event: string, handler: (response: any) => void) => void;
    };
  }
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id?: string;
  handler: (response: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => void;
  prefill: { name: string; email: string; contact: string };
  theme: { color: string };
  modal?: {
    ondismiss?: () => void;
  };
}

const guestSchema = z.object({
  guestName: z.string().optional().or(z.literal('')),
  guestPhone: z.string().optional().or(z.literal('')),
  paymentMethod: z.enum(['UPI_INTENT', 'RAZORPAY', 'COD', 'PAY_TO_WAITER', 'PAY_AT_COUNTER']).default('PAY_AT_COUNTER'),
});

type GuestForm = z.infer<typeof guestSchema>;

const GST_RATE = 0.05;
// Dine-in only (no delivery fees)


interface CheckoutPageProps {
  restaurantSlug: string;
  tableNumber?: string;
  tableToken?: string;
  isTableVerified?: boolean;
}

const saveOrderToRecent = (orderId: string, restaurantSlug: string) => {
  try {
    const orders = localStorage.getItem('qr_restaurant_recent_orders');
    let parsed = [];
    if (orders) {
      parsed = JSON.parse(orders);
      if (!Array.isArray(parsed)) parsed = [];
    }
    parsed = parsed.filter((o: any) => o.orderId !== orderId);
    parsed.unshift({
      orderId,
      restaurantSlug,
      createdAt: Date.now(),
    });
    parsed = parsed.slice(0, 10);
    localStorage.setItem('qr_restaurant_recent_orders', JSON.stringify(parsed));
  } catch (e) {
    console.error('Failed to save order to recent orders list', e);
  }
};


export function CheckoutPage({ restaurantSlug, tableNumber, tableToken, isTableVerified }: CheckoutPageProps) {
  const router = useRouter();
  const { user: rawUser, accessToken, logout } = useAuthStore();
  const queryClient = useQueryClient();

  const activeUser = useMemo(() => {
    if (!rawUser) return null;
    return rawUser;
  }, [rawUser]);

  // Fetch Restaurant Data
  const { data: menuData } = useQuery({
    queryKey: ['menu', restaurantSlug],
    queryFn: async () => {
      const response = await api.get(`/menu/${restaurantSlug}`);
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const restaurant = menuData?.restaurant;

  // ── Synchronize dynamic restaurant theme color across UI ────────────────
  const themeColor = restaurant?.themeColor;
  useEffect(() => {
    if (themeColor) {
      applyThemeColor(themeColor);
      if (typeof window !== 'undefined' && restaurantSlug) {
        localStorage.setItem(`restaurant_theme_${restaurantSlug}`, themeColor);
      }
    } else if (typeof window !== 'undefined' && restaurantSlug) {
      const cached = localStorage.getItem(`restaurant_theme_${restaurantSlug}`);
      if (cached) {
        applyThemeColor(cached);
      }
    }
  }, [themeColor, restaurantSlug]);


  const [manualTableNumber, setManualTableNumber] = useState(tableNumber || '');

  useEffect(() => {
    if (!tableNumber || !isTableVerified) {
      const storedTable = localStorage.getItem(`table_num_${restaurantSlug}`);
      if (storedTable) {
        setManualTableNumber(storedTable);
      }
    } else {
      setManualTableNumber(tableNumber);
    }
  }, [tableNumber, isTableVerified, restaurantSlug]);

  const handleTableNumberChange = (val: string) => {
    setManualTableNumber(val);
    if (val.trim()) {
      localStorage.setItem(`table_num_${restaurantSlug}`, val.trim());
    } else {
      localStorage.removeItem(`table_num_${restaurantSlug}`);
    }
  };

  const hasTableToken = useMemo(() => {
    if (isTableVerified || (tableToken && tableToken.trim() !== '')) return true;
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem(`table_token_${restaurantSlug}`);
      return !!(storedToken && storedToken.trim() !== '');
    }
    return false;
  }, [tableToken, restaurantSlug]);

  // UPI Intent Payment Modal state
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [upiData, setUpiData] = useState<{
    paymentId: string;
    orderId: string;
    txnRef: string;
    amount: number;
    currency: string;
    merchantVpa: string;
    merchantName: string;
    upiIntentUrl: string;
  } | null>(null);
  const [upiQrCodeDataUrl, setUpiQrCodeDataUrl] = useState<string>('');
  const [isCheckingUpiStatus, setIsCheckingUpiStatus] = useState<boolean>(false);

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];

    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }

    if (parts.length > 0) {
      return parts.join(' ');
    } else {
      return v;
    }
  };

  const formatExpiry = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (v.length >= 2) {
      return `${v.slice(0, 2)}/${v.slice(2, 4)}`;
    }
    return v;
  };

  // Address queries & state

  const { data: profileData, refetch: refetchProfile } = useQuery({
    queryKey: ['user-profile'],
    queryFn: async () => {
      const response = await api.get('/profile');
      return response.data.data.user as { loyaltyPoints: number; walletBalance: number };
    },
    enabled: !!activeUser && !!accessToken,
  });

  const {
    items,
    couponCode,
    couponDiscount,
    applyCoupon,
    removeCoupon,
    clearCart,
    subtotal,
    total,
    removeItem,
    updateQuantity,
  } = useCartStore();
  const [couponInput, setCouponInput] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<'PAY_AT_COUNTER' | 'PAY_TO_WAITER' | 'COD' | 'UPI_INTENT'>('PAY_AT_COUNTER');
  const [onlinePaymentType, setOnlinePaymentType] = useState<'DIRECT' | 'RAZORPAY'>('DIRECT');

  const isUpiRestricted = false;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (restaurant) {
      const hasDirect = !!(restaurant.paymentQrCode || restaurant.paymentUpiId || restaurant.paymentPhone || restaurant.bankAccountNumber);
      setOnlinePaymentType(hasDirect ? 'DIRECT' : 'RAZORPAY');
    }
  }, [restaurant]);
  const [razorpayKeyId, setRazorpayKeyId] = useState<string>('');
  // Use a ref so handleRazorpayPayment always reads the latest key (avoids stale closure race condition)
  const razorpayKeyRef = useRef<string>('');

  const [addonOrderId, setAddonOrderId] = useState<string | null>(null);
  const [addonOrderNum, setAddonOrderNum] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedId =
        sessionStorage.getItem('qr_restaurant_addon_order_id') ||
        sessionStorage.getItem(`qr_restaurant_addon_order_id_${restaurantSlug}`) ||
        localStorage.getItem(`active_table_order_id_${restaurantSlug}`) ||
        localStorage.getItem('active_table_order_id');
      const storedNum =
        sessionStorage.getItem('qr_restaurant_addon_order_num') ||
        (storedId ? storedId.slice(-8).toUpperCase() : null);
      if (storedId) {
        setAddonOrderId(storedId);
        setAddonOrderNum(storedNum);
        setSelectedPayment('PAY_TO_WAITER');
      }
    }
  }, [restaurantSlug]);

  useEffect(() => {
    api.get('/orders/razorpay-key')
      .then(res => {
        const key = res.data?.data?.keyId ?? '';
        setRazorpayKeyId(key);
        razorpayKeyRef.current = key;
      })
      .catch(err => {
        console.error('Failed to fetch Razorpay key ID:', err);
      });
  }, []);

  const subtotalAmount = mounted ? subtotal() : 0;
  const gst = subtotalAmount * GST_RATE;
  const finalCouponDiscount = addonOrderId ? 0 : couponDiscount;
  const grandTotal = Math.max(subtotalAmount + gst - finalCouponDiscount, 0);

  // Live coupons for this restaurant
  const { data: publicCoupons = [], isSuccess: isCouponsFetched } = useQuery<Array<{
    id: string;
    code: string;
    type: 'FLAT' | 'PERCENT';
    value: number;
    minOrderAmount: number;
    maxDiscount?: number | null;
    maxUses?: number | null;
    usedCount?: number;
    expiresAt?: string | null;
  }>>({
    queryKey: ['public-coupons', restaurantSlug],
    queryFn: async () => {
      try {
        const res = await api.get(`/cart/coupons/${restaurantSlug}`);
        return res.data?.data?.coupons ?? [];
      } catch {
        return [];
      }
    },
    staleTime: 0,
  });

  // Socket listener for real-time coupon updates from dashboard
  useEffect(() => {
    const socket = io(getSocketUrl(), {
      transports: ['polling', 'websocket'],
    });

    const handleCouponsUpdated = (payload?: any) => {
      queryClient.invalidateQueries({ queryKey: ['public-coupons', restaurantSlug] });
      queryClient.invalidateQueries({ queryKey: ['coupon-suggestion'] });
      if (payload && (payload.action === 'DELETED' || payload.action === 'TOGGLED' || payload.action === 'DISABLED')) {
        if (couponCode && payload.coupon && payload.coupon.code && payload.coupon.code.toUpperCase() === couponCode.toUpperCase()) {
          removeCoupon();
          toast.error(`Coupon "${couponCode}" is no longer active.`);
        }
      }
    };

    socket.on('coupons:updated', handleCouponsUpdated);
    socket.on('coupon:updated', handleCouponsUpdated);

    return () => {
      socket.disconnect();
    };
  }, [restaurantSlug, queryClient, couponCode, removeCoupon]);

  // If a previously applied coupon becomes invalid or disabled, remove it automatically
  useEffect(() => {
    if (couponCode && isCouponsFetched) {
      const stillValid = publicCoupons.some((c) => c.code.toUpperCase() === couponCode.toUpperCase());
      if (!stillValid) {
        removeCoupon();
        toast.error(`Coupon "${couponCode}" is no longer active.`);
      }
    }
  }, [couponCode, publicCoupons, isCouponsFetched, removeCoupon]);

  const handleApplyCoupon = async (code: string) => {
    if (!code.trim()) return;
    setCouponLoading(true);
    try {
      const response = await api.post('/cart/coupon', {
        code: code.toUpperCase().trim(),
        restaurantSlug,
        cartTotal: subtotalAmount,
      });
      const { discount: discountAmount, coupon } = response.data.data as {
        discount: number;
        coupon: { code: string };
      };
      applyCoupon(coupon.code, discountAmount);
      setCouponInput('');
      toast.success(`Coupon applied! Saved ₹${discountAmount}`);
    } catch (error: any) {
      const msg = error.response?.data?.error || error.response?.data?.message || 'Invalid coupon code';
      toast.error(msg);
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    removeCoupon();
    toast.info('Coupon removed');
  };

  const { register, handleSubmit, formState: { errors } } = useForm<GuestForm>({
    resolver: zodResolver(guestSchema),
    defaultValues: { paymentMethod: 'PAY_AT_COUNTER' },
  });

  const loadRazorpay = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (typeof window !== 'undefined' && window.Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleRazorpayPayment = async (
    orderId: string,
    razorpayOrderId: string | null,
    amount: number,
    customerName: string,
    customerPhone: string
  ) => {
    const key = razorpayKeyRef.current || razorpayKeyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_live_TAVv5bDEV3HwgB';

    if (!key) {
      await handleUpiIntentPayment(orderId);
      return;
    }

    const loaded = await loadRazorpay();
    if (!loaded) {
      toast.error('Payment gateway unavailable. Launching direct UPI fallback.');
      await handleUpiIntentPayment(orderId);
      return;
    }

    const options: RazorpayOptions = {
      key,
      amount: Math.round(amount * 100),
      currency: 'INR',
      name: restaurant?.merchantName || restaurant?.name || 'EZ- Restaurant',
      description: `Order #${orderId.slice(-8).toUpperCase()}`,
      ...(razorpayOrderId ? { order_id: razorpayOrderId } : {}),
      prefill: {
        name: customerName,
        email: activeUser?.email || '',
        contact: customerPhone,
      },
      theme: { color: restaurant?.themeColor || '#E85D04' },
      handler: async (response) => {
        try {
          setLoading(true);
          await api.post('/orders/verify-payment', {
            orderId,
            razorpayOrderId: response.razorpay_order_id || razorpayOrderId || '',
            razorpayPaymentId: response.razorpay_payment_id || `pay_${Date.now()}`,
            razorpaySignature: response.razorpay_signature || 'direct_signature',
          });
          if (activeUser) {
            queryClient.invalidateQueries({ queryKey: ['user-profile'] });
          }
          saveOrderToRecent(orderId, restaurantSlug);
          clearCart();
          toast.success('Payment verified & order confirmed! 🎉');
          // Automatically redirect straight to order tracking status page
          router.push(`/r/${restaurantSlug}/order/${orderId}`);
        } catch (err: any) {
          toast.error(err.response?.data?.error || 'Payment verification failed. Check order status.');
          router.push(`/r/${restaurantSlug}/order/${orderId}`);
        } finally {
          setLoading(false);
        }
      },
      modal: {
        ondismiss: () => {
          toast.info('Payment window closed. You can complete payment on the order page.');
          saveOrderToRecent(orderId, restaurantSlug);
          clearCart();
          router.push(`/r/${restaurantSlug}/order/${orderId}`);
        },
      },
    };

    const rzp = new window.Razorpay(options);
    rzp.open();
  };

  const handleUpiIntentPayment = async (orderId: string) => {
    try {
      const res = await api.post('/payments/create-upi-intent', { orderId });
      const paymentInfo = res.data?.data;
      if (!paymentInfo) {
        throw new Error('Failed to obtain payment configuration.');
      }
      setUpiData(paymentInfo);

      if (paymentInfo.upiIntentUrl) {
        try {
          const qrUrl = await QRCode.toDataURL(paymentInfo.upiIntentUrl, { width: 300, margin: 1 });
          setUpiQrCodeDataUrl(qrUrl);
        } catch (err) {
          console.error('Failed to generate UPI QR code:', err);
        }
      }

      setShowUpiModal(true);

      // Deep link trigger for mobile devices with user-gesture safe check
      if (typeof window !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        try {
          window.location.href = paymentInfo.upiIntentUrl;
        } catch {
          // ignore auto-navigate restriction in strict browser contexts
        }
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to initialize UPI Payment.';
      toast.error(msg);
    }
  };

  const getAppDeepLink = (app: 'gpay' | 'phonepe' | 'paytm' | 'bhim' | 'all', url: string) => {
    if (!url) return '';
    return buildAppUpiUrl(app === 'all' ? 'generic' : app, url);
  };

  const handleCheckPaymentStatus = async (manual = false) => {
    if (!upiData?.paymentId) return;
    setIsCheckingUpiStatus(true);
    try {
      const res = await api.get(`/payments/${upiData.paymentId}/status`, { skipToast: true } as any);
      const data = res.data?.data;
      if (data?.utr) {
        setLatestUtr(data.utr);
      }
      const status = data?.status || data?.orderPaymentStatus;
      if (status === 'PAID') {
        saveOrderToRecent(upiData.orderId, restaurantSlug);
        clearCart();
        setShowUpiModal(false);
        toast.success('Payment Verified & Order Confirmed! 🎉');
        router.push(`/r/${restaurantSlug}/order/${upiData.orderId}`);
      } else if (manual) {
        toast.info('Payment verification in progress. Please approve the request in your UPI app.');
      }
    } catch (err: any) {
      if (manual) {
        toast.error('Could not check payment status. Please try again.');
      }
    } finally {
      setIsCheckingUpiStatus(false);
    }
  };

  const [latestUtr, setLatestUtr] = useState<string | null>(null);
  const [showCancelConfirmModal, setShowCancelConfirmModal] = useState(false);
  const [isCancellingOrder, setIsCancellingOrder] = useState(false);

  const confirmCancelOrder = async () => {
    if (!upiData?.orderId) {
      setShowCancelConfirmModal(false);
      setShowUpiModal(false);
      return;
    }
    setIsCancellingOrder(true);
    try {
      await api.post(`/payments/orders/${upiData.orderId}/cancel`);
      setShowCancelConfirmModal(false);
      setShowUpiModal(false);
      toast.info('Order payment attempt cancelled.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not cancel order.');
    } finally {
      setIsCancellingOrder(false);
    }
  };

  const handleCancelOrder = async () => {
    setShowCancelConfirmModal(true);
  };

  // QR Tab state inside UPI Modal
  const [selectedQrTab, setSelectedQrTab] = useState<'dynamic' | 'custom'>('dynamic');

  // Status Polling for UPI Payment Verification
  useEffect(() => {
    if (!showUpiModal || !upiData?.paymentId) return;

    handleCheckPaymentStatus(false);
    const interval = setInterval(() => handleCheckPaymentStatus(false), 3000);
    return () => clearInterval(interval);
  }, [showUpiModal, upiData?.paymentId]);


  const onGuestSubmit = async (formData: GuestForm) => {
    if (items.length === 0) {
      toast.error('Your cart is empty');
      return;
    }
    if (!manualTableNumber || !manualTableNumber.trim()) {
      toast.error('Please enter your table or room number.');
      return;
    }
    setLoading(true);
    try {
      const token = tableToken || localStorage.getItem(`table_token_${restaurantSlug}`) || (manualTableNumber ? generateUniqueTableCode(restaurantSlug, manualTableNumber.trim()) : '');
      // Online payment is temporarily disabled on customer checkout.
      // All orders are placed with offline counter payment and given a 4-digit verification code.
      const isOnline = false;
      const effectiveMethod = 'PAY_AT_COUNTER';

      const response = await api.post('/orders/guest', {
        guestName: formData.guestName?.trim() || 'Guest',
        guestPhone: formData.guestPhone?.trim() || '',
        tableNumber: manualTableNumber ? manualTableNumber.trim() : '1',
        tableToken: token,
        paymentMethod: effectiveMethod,
        isDirect: false,
        couponCode: couponCode ?? undefined,
        restaurantSlug,
        cartItems: items.map((item) => ({
          menuItemId: item.menuItemId,
          variantId: item.variantId,
          quantity: item.quantity,
          addOns: item.addOns,
        })),
      });

      const { order } = response.data.data as {
        order: { id: string; total: number; razorpayOrderId: string | null; verificationCode?: string };
      };

      saveOrderToRecent(order.id, restaurantSlug);
      clearCart();
      toast.success('Order placed successfully! 🎉 Show your 4-digit verification code at the counter.');
      router.push(`/r/${restaurantSlug}/order/${order.id}`);
    } catch (err: any) {
      const responseCode = err.response?.data?.code;
      if (responseCode === 'ITEM_NOT_FOUND') {
        const errorText = err.response?.data?.error || '';
        const missingItem = items.find((item) => errorText.includes(item.menuItemId));
        if (missingItem) {
          removeItem(missingItem.id);
          toast.error(`"${missingItem.name}" is no longer available and has been removed from your cart.`);
          return;
        }
      }
      const errMsg = err.response?.data?.error ?? err.response?.data?.message ?? 'Failed to place order. Please try again.';
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const onUserOrder = async () => {
    if (items.length === 0) return;
    if (!manualTableNumber || !manualTableNumber.trim()) {
      toast.error('Please enter your table or room number.');
      return;
    }
    setLoading(true);
    try {
      const token = tableToken || localStorage.getItem(`table_token_${restaurantSlug}`) || (manualTableNumber ? generateUniqueTableCode(restaurantSlug, manualTableNumber.trim()) : '');
      // Online payment is temporarily disabled on customer checkout.
      // All orders are placed with offline counter payment and given a 4-digit verification code.
      const isOnline = false;
      const effectiveMethod = 'PAY_AT_COUNTER';

      const response = await api.post('/orders', {
        tableNumber: manualTableNumber ? manualTableNumber.trim() : undefined,
        tableToken: token,
        paymentMethod: effectiveMethod,
        isDirect: false,
        couponCode: couponCode ?? undefined,
        restaurantSlug,
        useWallet: false,
        usePoints: false,
        cartItems: items.map((item) => ({
          menuItemId: item.menuItemId,
          variantId: item.variantId,
          quantity: item.quantity,
          addOns: item.addOns,
        })),
      });

      const { order } = response.data.data as {
        order: { id: string; total: number; razorpayOrderId: string | null; verificationCode?: string };
      };

      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      saveOrderToRecent(order.id, restaurantSlug);
      clearCart();
      toast.success('Order placed! 🎉 Show your 4-digit verification code at the counter.');
      router.push(`/r/${restaurantSlug}/order/${order.id}`);
    } catch (err: any) {
      const responseCode = err.response?.data?.code;
      if (responseCode === 'ITEM_NOT_FOUND') {
        const errorText = err.response?.data?.error || '';
        const missingItem = items.find((item) => errorText.includes(item.menuItemId));
        if (missingItem) {
          removeItem(missingItem.id);
          toast.error(`"${missingItem.name}" is no longer available and has been removed from your cart.`);
          return;
        }
      }
      const errMsg = err.response?.data?.error ?? err.response?.data?.message ?? 'Failed to place order. Please try again.';
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleAddItemsToOrder = async () => {
    if (items.length === 0) return;
    setLoading(true);
    try {
      const response = await api.post(`/orders/${addonOrderId}/add-items`, {
        cartItems: items.map((item) => ({
          menuItemId: item.menuItemId,
          variantId: item.variantId,
          quantity: item.quantity,
          addOns: item.addOns,
        })),
        paymentMethod: selectedPayment,
      });

      const { order } = response.data.data as {
        order: { id: string; total: number; razorpayOrderId: string | null };
      };

      // Clean up session storage add-on mode
      sessionStorage.removeItem('qr_restaurant_addon_order_id');
      sessionStorage.removeItem('qr_restaurant_addon_order_num');

      saveOrderToRecent(order.id, restaurantSlug);
      clearCart();
      toast.success('Items successfully added to your order! 🎉');
      router.push(`/r/${restaurantSlug}/order/${order.id}`);
    } catch (err: any) {
      const errMsg = err.response?.data?.error ?? err.response?.data?.message ?? 'Failed to add items to order.';
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  };

  if ((menuData?.restaurant as any)?.qrSettings?.enabled === false) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-card border border-amber-500/20 rounded-3xl p-8 shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-amber-500">
            <AlertCircle className="w-8 h-8 animate-pulse" />
          </div>
          <div className="space-y-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 inline-block">
              QR Service Unavailable
            </span>
            <h2 className="text-xl sm:text-2xl font-display font-black text-foreground">
              Currently maintenance is going on kindly order normally!
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Digital QR ordering is temporarily paused for maintenance at {menuData?.restaurant?.name || 'this restaurant'}. Please place your order directly with the waiter or staff at the counter.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href={`/r/${restaurantSlug}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-all shadow-md"
            >
              Back to Restaurant
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (menuData?.restaurant && menuData.restaurant.isOpen === false) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
        <div className="max-w-md w-full bg-card border border-rose-500/20 rounded-3xl p-8 shadow-2xl space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto text-rose-500">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25 inline-block">
              Restaurant Closed
            </span>
            <h2 className="text-xl sm:text-2xl font-display font-black text-foreground">
              {menuData.restaurant.name || 'Restaurant'} is currently closed
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We are not accepting new orders right now. Please check back during operating hours.
            </p>
          </div>
          <div className="pt-2">
            <Link
              href={`/r/${restaurantSlug}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-all shadow-md"
            >
              Back to Menu
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border px-4 py-3">
        <div className="flex items-center gap-3 max-w-lg mx-auto">
          <Link href={`/r/${restaurantSlug}`} className="p-2 rounded-xl hover:bg-muted transition-colors">
            <ChevronLeft className="w-5 h-5" />
          </Link>
          <h1 className="font-display font-bold text-lg">Checkout</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
        {/* Order Summary */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <h2 className="font-display font-semibold mb-3">Order Summary</h2>
          <div className="space-y-2 mb-4" suppressHydrationWarning>
            {mounted && items.map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{item.name} × {item.quantity}</span>
                <span>₹{(item.unitPrice * item.quantity).toFixed(0)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 space-y-1.5 text-sm" suppressHydrationWarning>
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span><span suppressHydrationWarning>₹{subtotalAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>GST (5%)</span><span suppressHydrationWarning>₹{gst.toFixed(2)}</span>
            </div>

            {mounted && !addonOrderId && couponDiscount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Coupon ({couponCode})</span><span>-₹{couponDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-border pt-2">
              <span>Total</span><span suppressHydrationWarning>₹{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Live Coupons & Offers Card */}
        {mounted && !addonOrderId && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-3 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                  <Tag className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Offers & Coupons</h3>
                  <p className="text-xs text-muted-foreground">Real-time restaurant coupons & discounts</p>
                </div>
              </div>
              {couponCode && (
                <span className="text-xs bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" /> Applied
                </span>
              )}
            </div>

            {couponCode ? (
              <div className="flex items-center justify-between p-3 rounded-xl bg-green-50/60 dark:bg-green-950/20 border border-green-200 dark:border-green-900/50">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-green-100 dark:bg-green-900/40 flex items-center justify-center text-green-700 dark:text-green-300">
                    <Tag className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold tracking-wider font-mono text-green-800 dark:text-green-300">
                      {couponCode}
                    </p>
                    <p className="text-xs text-green-700 dark:text-green-400">
                      Saving ₹{couponDiscount.toFixed(2)} on this order
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleRemoveCoupon}
                  className="text-xs font-semibold text-red-600 hover:text-red-700 px-3 py-1.5 rounded-lg border border-red-200 hover:bg-red-50 dark:border-red-900/50 transition-colors"
                >
                  Remove
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="Enter coupon code"
                    className="flex-1 px-3 py-2 text-sm rounded-xl border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 uppercase font-mono"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleApplyCoupon(couponInput);
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleApplyCoupon(couponInput)}
                    disabled={couponLoading || !couponInput.trim()}
                    className="px-4 py-2 text-sm font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-all flex items-center gap-1"
                  >
                    {couponLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                  </button>
                </div>

                {publicCoupons.length > 0 && (
                  <div className="space-y-2 pt-1 border-t border-border/60">
                    <p className="text-xs font-medium text-muted-foreground">Available Coupons:</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {publicCoupons.map((c) => {
                        const meetsMin = !c.minOrderAmount || subtotalAmount >= c.minOrderAmount;
                        const isLimitReached = c.maxUses !== null && c.maxUses !== undefined && (c.usedCount ?? 0) >= c.maxUses;
                        const discountLabel = c.type === 'PERCENT' ? `${c.value}% OFF` : `₹${c.value} OFF`;
                        return (
                          <div
                            key={c.id || c.code}
                            className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                              meetsMin && !isLimitReached
                                ? 'bg-background hover:border-primary/40 border-border'
                                : 'bg-muted/40 border-dashed border-border opacity-60'
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                                  {c.code}
                                </span>
                                <span className="text-xs font-semibold text-foreground">{discountLabel}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5">
                                {c.minOrderAmount && c.minOrderAmount > 0 ? `Min order ₹${c.minOrderAmount}` : 'No min order'}
                                {c.maxDiscount ? ` • Up to ₹${c.maxDiscount}` : ''}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleApplyCoupon(c.code)}
                              disabled={!meetsMin || isLimitReached || couponLoading}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-all shrink-0 ${
                                meetsMin && !isLimitReached
                                  ? 'bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground'
                                  : 'bg-muted text-muted-foreground cursor-not-allowed'
                              }`}
                            >
                              {!meetsMin
                                ? `Add ₹${Math.ceil(c.minOrderAmount - subtotalAmount)}`
                                : isLimitReached
                                ? 'Limit Reached'
                                : 'Apply'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

            {/* Payment Method - Offline Counter Payment */}
            <div className="bg-card border border-border rounded-2xl p-4 space-y-3 shadow-xs">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold">Payment Method</h2>
                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                  Pay at Counter
                </span>
              </div>

                  <div className="w-full flex items-center gap-3 p-3.5 rounded-xl border-2 border-emerald-500/40 bg-emerald-500/5 transition-all">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <Banknote className="w-5 h-5" />
                    </div>
                        <div className="text-left flex-1">
                          <p className="font-bold text-sm text-foreground">Pay at Restaurant / Pay at Counter</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                            Place your order now and complete your payment at the restaurant counter. Show your order verification code to the counter staff or waiter.
                          </p>
                        </div>
                        <div className="w-4 h-4 rounded-full border-2 border-emerald-500 bg-emerald-500 flex items-center justify-center">
                          <Check className="w-2.5 h-2.5 text-white" />
                        </div>
                </div>

                <div className="bg-muted/40 border border-border/70 rounded-xl p-3 text-xs text-muted-foreground leading-relaxed flex items-start gap-2">
                  <span className="text-base leading-none">ℹ️</span>
                  <span>
                    Your order will be prepared immediately upon placement. Please settle your bill at the counter or show your 4-digit code to your waiter.
                  </span>
                </div>
              </div>

        {activeUser && activeUser.role !== 'CUSTOMER' ? (
              <div className="bg-card border border-border rounded-2xl p-6 text-center space-y-4 shadow-xl relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 via-transparent to-transparent pointer-events-none" />
                <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-500 text-2xl">
                  🚫
                </div>
                <h2 className="font-display font-bold text-lg text-foreground">Ordering Restricted</h2>
                <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
                  You are logged in as a <strong>{activeUser.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Restaurant Owner'}</strong>. Owners and administrators are not allowed to place orders.
                </p>
                <div className="pt-2 flex flex-col gap-2">
                  <Link
                    href={activeUser.role === 'SUPER_ADMIN' ? '/admin/dashboard' : '/owner/dashboard'}
                    className="w-full py-3.5 bg-primary hover:bg-primary/95 text-white font-semibold rounded-xl text-center shadow-md transition-all active:scale-95 text-sm"
                  >
                    Back to Dashboard
                  </Link>
                  <button
                    onClick={() => {
                      logout();
                      toast.success('Logged out successfully');
                      router.push(`/r/${restaurantSlug}`);
                    }}
                    className="w-full py-3.5 bg-muted hover:bg-muted/80 text-foreground font-semibold rounded-xl text-center transition-all active:scale-95 text-sm"
                  >
                    Log Out & Continue as Guest
                  </button>
                </div>
              </div>
            ) : addonOrderId ? (
              <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
                <h2 className="font-display font-semibold text-sm">Add Items to Active Order</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  These items will be appended to your active Order #{addonOrderNum} for Table {manualTableNumber || localStorage.getItem(`table_num_${restaurantSlug}`) || '1'}.
                </p>
                <div className="p-3 bg-primary/5 border border-primary/10 rounded-xl text-xs text-primary font-medium">
                  📝 Added items will be billed to your running tab. You can settle the final amount at the end of your meal.
                </div>
                <button
                  onClick={handleAddItemsToOrder}
                  disabled={loading || items.length === 0}
                  className="w-full py-4 rounded-2xl text-white font-bold text-base bg-gradient-to-r from-orange-500 to-amber-500 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Adding Items...' : `Confirm & Add Items · ₹${grandTotal.toFixed(2)}`}
                </button>
              </div>
            ) : activeUser ? (
              <div className="bg-card border border-border rounded-2xl p-4">
                <h2 className="font-display font-semibold mb-3">Your Details</h2>
                <div className="flex items-center gap-3 bg-muted/50 rounded-xl p-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{activeUser.name}</p>
                    <p className="text-xs text-muted-foreground">{activeUser.email}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <label className="text-xs font-semibold text-muted-foreground mb-1 flex items-center justify-between">
                    <span>Table Number <span className="text-red-500">*</span></span>
                    {hasTableToken || !!tableNumber ? (
                      <span className="text-[10px] text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <Lock className="w-3 h-3" /> QR Verified (Locked)
                      </span>
                    ) : (
                      <span className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full font-medium">
                        Table QR Scan Required
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    placeholder="Enter Table / Room Number (e.g. 5, Room 301)"
                    value={manualTableNumber}
                    readOnly={hasTableToken || !!tableNumber}
                    onChange={(e) => !(hasTableToken || !!tableNumber) && handleTableNumberChange(e.target.value)}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-sm border-0 focus:outline-none text-foreground transition-all ${hasTableToken || !!tableNumber
                      ? 'bg-muted/80 cursor-not-allowed font-semibold text-primary border border-primary/20 select-none'
                      : 'bg-muted focus:ring-2 focus:ring-primary/20'
                      }`}
                  />
                </div>
                <button
                  onClick={onUserOrder}
                  disabled={loading || items.length === 0}
                  className="w-full mt-4 py-4 rounded-2xl text-white font-bold text-base bg-gradient-to-r from-orange-500 to-amber-500 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Placing Order...' : `Place Order · ₹${grandTotal.toFixed(2)}`}
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onGuestSubmit)} className="bg-card border border-border rounded-2xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-semibold">Your Details</h2>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Full Name <span className="text-muted-foreground text-xs font-normal">(Optional)</span></label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      {...register('guestName')}
                      placeholder="John Doe (Optional)"
                      className="w-full pl-9 pr-4 py-3 bg-muted rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 block">Phone Number <span className="text-muted-foreground text-xs font-normal">(Optional)</span></label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      {...register('guestPhone')}
                      placeholder="9876543210 (Optional)"
                      type="tel"
                      maxLength={10}
                      className="w-full pl-9 pr-4 py-3 bg-muted rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1.5 flex items-center justify-between">
                    <span>Table / Room Number <span className="text-red-500">*</span></span>
                    {hasTableToken ? (
                      <span className="text-[10px] text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Scanned QR (Locked)
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">
                        Enter your table or room
                      </span>
                    )}
                  </label>
                  <input
                    type="text"
                    placeholder="Enter Table Number (e.g. 5, 11, Room 102)"
                    value={manualTableNumber}
                    readOnly={hasTableToken}
                    onChange={(e) => !hasTableToken && handleTableNumberChange(e.target.value)}
                    className={`w-full px-4 py-3 rounded-xl text-sm border-0 focus:outline-none text-foreground transition-all ${hasTableToken
                      ? 'bg-muted/80 cursor-not-allowed font-semibold text-primary border border-primary/20 select-none'
                      : 'bg-muted focus:ring-2 focus:ring-primary/20'
                      }`}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || items.length === 0}
                  className="w-full py-4 rounded-2xl text-white font-bold text-base bg-gradient-to-r from-orange-500 to-amber-500 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Placing Order...' : `Place Order · ₹${grandTotal.toFixed(2)}`}
                </button>
              </form>
            )}
          </div>

          {/* UPI Intent Payment Modal & Verification Screen */}
          <AnimatePresence>
            {showUpiModal && upiData && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                {/* Backdrop */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => {
                    setShowUpiModal(false);
                    toast.info('Payment window closed. You can track payment verification on your order page.');
                  }}
                  className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                />

                {/* Modal Body */}
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: 20 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: 20 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 350 }}
                  className="bg-card border border-border w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative z-10 my-auto flex flex-col max-h-[90vh]"
                >
                  {/* Header */}
                  <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white p-4 sm:p-5 relative flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setShowUpiModal(false);
                        toast.info('Payment window closed.');
                      }}
                      className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="bg-white/20 p-1.5 rounded-lg">
                        <Smartphone className="w-4 h-4 text-white" />
                      </div>
                      <span className="text-xs font-bold tracking-wider uppercase opacity-90">UPI Deep Link Payment</span>
                    </div>
                    <h3 className="font-display font-bold text-xl">Pay with UPI App</h3>
                    <p className="text-xs opacity-85 mt-1">Google Pay · PhonePe · Paytm · BHIM</p>
                  </div>

                  {/* Order Info & Reference */}
                  <div className="p-3.5 sm:p-4 border-b border-border bg-muted/30 flex justify-between items-center flex-shrink-0">
                    <div>
                      <p className="text-xs text-muted-foreground">Authoritative Amount</p>
                      <p className="font-display font-extrabold text-2xl text-foreground font-mono">₹{upiData.amount.toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] bg-primary/10 text-primary px-2.5 py-1 rounded-full font-bold inline-block border border-primary/20 font-mono">
                        Ref: {upiData.txnRef}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">Pay to: <span className="font-semibold text-foreground">{upiData.merchantName}</span></p>
                    </div>
                  </div>

                  {/* QR Code Selection Tabs if owner uploaded custom QR image */}
                  {restaurant?.paymentQrCode && (
                    <div className="flex border-b border-border p-1 bg-muted/20 text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedQrTab('dynamic')}
                        className={`flex-1 py-2 font-semibold rounded-lg transition-all ${selectedQrTab === 'dynamic' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted/50'
                          }`}
                      >
                        Auto Dynamic QR (₹{upiData.amount.toFixed(2)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedQrTab('custom')}
                        className={`flex-1 py-2 font-semibold rounded-lg transition-all ${selectedQrTab === 'custom' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted/50'
                          }`}
                      >
                        Owner Uploaded QR Image
                      </button>
                    </div>
                  )}

                  {/* QR Code & Mobile Launch */}
                  <div className="p-4 sm:p-5 space-y-4 text-center overflow-y-auto flex-1 overscroll-contain">
                    {selectedQrTab === 'custom' && restaurant?.paymentQrCode ? (
                      <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl border border-border max-w-[200px] mx-auto shadow-sm p-3">
                        <img
                          src={getImageUrl(restaurant.paymentQrCode)}
                          alt="Owner Uploaded Payment QR"
                          className="w-36 h-36 object-contain"
                        />
                        <span className="text-[10px] text-gray-500 mt-2 font-semibold flex items-center gap-1">
                          <QrCode className="w-3 h-3 text-primary" /> Owner's Uploaded QR Image
                        </span>
                      </div>
                    ) : upiQrCodeDataUrl ? (
                      <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl border border-border max-w-[200px] mx-auto shadow-sm p-3">
                        <img
                          src={upiQrCodeDataUrl}
                          alt="UPI Payment QR Code"
                          className="w-36 h-36 object-contain"
                        />
                        <span className="text-[10px] text-gray-500 mt-2 font-semibold flex items-center gap-1">
                          <QrCode className="w-3 h-3 text-primary" /> Scan with any UPI App (Exact ₹{upiData.amount.toFixed(2)})
                        </span>
                      </div>
                    ) : (
                      <div className="w-36 h-36 rounded-2xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      </div>
                    )}

                    {/* Quick App Launch Buttons for Mobile */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <a
                        href={buildAppUpiUrl('gpay', upiData.upiIntentUrl)}
                        onClick={(e) => {
                          e.preventDefault();
                          triggerUpiLaunch('gpay', upiData.upiIntentUrl);
                        }}
                        className="py-2.5 px-3 rounded-xl bg-muted/60 hover:bg-muted border border-border/80 text-foreground font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                      >
                        <span>Google Pay</span>
                      </a>
                      <a
                        href={buildAppUpiUrl('phonepe', upiData.upiIntentUrl)}
                        onClick={(e) => {
                          e.preventDefault();
                          triggerUpiLaunch('phonepe', upiData.upiIntentUrl);
                        }}
                        className="py-2.5 px-3 rounded-xl bg-muted/60 hover:bg-muted border border-border/80 text-foreground font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                      >
                        <span>PhonePe</span>
                      </a>
                      <a
                        href={buildAppUpiUrl('paytm', upiData.upiIntentUrl)}
                        onClick={(e) => {
                          e.preventDefault();
                          triggerUpiLaunch('paytm', upiData.upiIntentUrl);
                        }}
                        className="py-2.5 px-3 rounded-xl bg-muted/60 hover:bg-muted border border-border/80 text-foreground font-semibold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                      >
                        <span>Paytm</span>
                      </a>
                      <a
                        href={buildAppUpiUrl('bhim', upiData.upiIntentUrl)}
                        onClick={(e) => {
                          e.preventDefault();
                          triggerUpiLaunch('bhim', upiData.upiIntentUrl);
                        }}
                        className="py-2.5 px-3 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary font-bold text-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                      >
                        <span>BHIM / Other</span>
                      </a>
                    </div>

                    {/* Primary Launch Button with Exact Authoritative Amount */}
                    <a
                      href={buildAppUpiUrl('generic', upiData.upiIntentUrl)}
                      onClick={(e) => {
                        e.preventDefault();
                        triggerUpiLaunch('generic', upiData.upiIntentUrl);
                      }}
                      className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20 cursor-pointer"
                    >
                      <Smartphone className="w-4 h-4" />
                      Open Default UPI App to Pay ₹{upiData.amount.toFixed(2)}
                    </a>

                    {/* Details Copy Bar */}
                    <div className="space-y-2 text-xs text-left pt-1">
                      <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                        <div>
                          <span className="text-muted-foreground block text-[9px] uppercase font-bold tracking-wider">Merchant VPA / UPI ID</span>
                          <span className="font-mono font-medium text-foreground">{upiData.merchantVpa}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(upiData.merchantVpa);
                            toast.success('UPI ID copied!');
                          }}
                          className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center cursor-pointer"
                          title="Copy UPI ID"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Real-time Verification Status Box (Authoritative, Automatic) */}
                    <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl text-left space-y-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                          <Loader2 className="w-4 h-4 animate-spin" />
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-xs text-foreground">Waiting for Bank Payment Confirmation...</p>
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {isCheckingUpiStatus ? 'Contacting bank payment gateway...' : 'Checking automatically every 3 seconds.'}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCheckPaymentStatus(true)}
                        disabled={isCheckingUpiStatus}
                        className="w-full py-2.5 px-3 rounded-xl bg-card border border-border hover:bg-muted font-semibold text-xs transition-all flex items-center justify-center gap-2 text-foreground disabled:opacity-60 cursor-pointer"
                      >
                        {isCheckingUpiStatus ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5 text-primary" />}
                        <span>I Have Paid (Refresh Status)</span>
                      </button>
                    </div>

                    {/* Authoritative Transaction Proof Display */}
                    <div className="bg-muted/40 border border-border/80 rounded-2xl p-3.5 text-xs font-mono text-left space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-sans">Merchant Order Ref:</span>
                        <span className="font-bold text-foreground">{upiData.txnRef || (upiData as any).merchantRef}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-sans">Bank Reference / UTR:</span>
                        <span className="text-muted-foreground font-sans italic">
                          {latestUtr || 'Awaiting bank confirmation'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground font-sans">Payable Amount:</span>
                        <span className="font-bold text-foreground">₹{upiData.amount.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>

          {/* Explicit Order Cancellation Confirmation Dialog */}
          <AnimatePresence>
            {showCancelConfirmModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setShowCancelConfirmModal(false)}
                  className="absolute inset-0 bg-black/60 backdrop-blur-xs"
                />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-card border border-border rounded-2xl p-5 max-w-sm w-full relative z-10 shadow-2xl space-y-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-base text-foreground">Cancel Order Attempt?</h3>
                      <p className="text-xs text-muted-foreground">Are you sure you want to cancel this order?</p>
                    </div>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed bg-muted/30 p-3 rounded-xl border border-border">
                    Cancelling will permanently cancel order <strong>#{upiData?.orderId?.slice(-6)?.toUpperCase()}</strong> and expire your active payment session.
                  </p>

                  <div className="flex gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowCancelConfirmModal(false)}
                      className="flex-1 py-2.5 px-3 rounded-xl border border-border font-semibold text-xs hover:bg-muted text-foreground transition-colors cursor-pointer"
                    >
                      Keep Order
                    </button>
                    <button
                      type="button"
                      onClick={confirmCancelOrder}
                      disabled={isCancellingOrder}
                      className="flex-1 py-2.5 px-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {isCancellingOrder ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                      <span>Yes, Cancel Order</span>
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>
        </div>
        );
}
