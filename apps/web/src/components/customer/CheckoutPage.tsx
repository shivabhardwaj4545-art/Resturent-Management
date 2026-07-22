'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ChevronLeft, CreditCard, Banknote, Wallet, MapPin, User, Phone, Loader2, Plus, PlusCircle, Check, Home, Briefcase, Lock, X, Smartphone, Building, Gift, Copy, QrCode } from 'lucide-react';
import { useCartStore } from '@/store/cart.store';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import { toast } from 'sonner';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';

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
  guestName: z.string().min(2, 'Name required'),
  guestPhone: z.string().regex(/^[6-9]\d{9}$/, 'Enter valid 10-digit number'),
  paymentMethod: z.enum(['RAZORPAY', 'COD', 'PAY_TO_WAITER']),
});

type GuestForm = z.infer<typeof guestSchema>;

const GST_RATE = 0.18;
const DELIVERY_FEE = 40;
const PACKAGING_FEE = 15;

interface Address {
  id: string;
  label: string;
  flat: string;
  street: string;
  area: string;
  city: string;
  pincode: string;
  isDefault: boolean;
}

interface CheckoutPageProps {
  restaurantSlug: string;
  tableNumber?: string;
  tableToken?: string;
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


export function CheckoutPage({ restaurantSlug, tableNumber, tableToken }: CheckoutPageProps) {
  const router = useRouter();
  const { user: rawUser, logout } = useAuthStore();
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
  const hasDelivery = restaurant?.hasDelivery ?? true;

  const [diningOption, setDiningOption] = useState<'DINE_IN' | 'DELIVERY'>('DINE_IN');

  useEffect(() => {
    setDiningOption('DINE_IN');
  }, [restaurant, hasDelivery]);

  const [manualTableNumber, setManualTableNumber] = useState(tableNumber || '');

  useEffect(() => {
    if (!tableNumber) {
      const storedTable = localStorage.getItem(`table_num_${restaurantSlug}`);
      if (storedTable) {
        setManualTableNumber(storedTable);
      }
    }
  }, [tableNumber, restaurantSlug]);

  // Mock Payment Modal state
  const [showMockPaymentModal, setShowMockPaymentModal] = useState(false);
  const [mockPaymentData, setMockPaymentData] = useState<{
    orderId: string;
    razorpayOrderId: string;
    amount: number;
    customerName: string;
    customerPhone: string;
  } | null>(null);
  const [mockPaymentMethod, setMockPaymentMethod] = useState<'manual' | 'automatic'>('manual');
  const [isProcessingMockPayment, setIsProcessingMockPayment] = useState(false);
  const [mockCardNumber, setMockCardNumber] = useState('');
  const [mockCardExpiry, setMockCardExpiry] = useState('');
  const [mockCardCVV, setMockCardCVV] = useState('');
  const [mockCardName, setMockCardName] = useState('');
  const [mockUPIId, setMockUPIId] = useState('');
  const [selectedBank, setSelectedBank] = useState('');

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
  const { data: addressesData, refetch: refetchAddresses } = useQuery({
    queryKey: ['profile-addresses'],
    queryFn: async () => {
      const response = await api.get('/profile/addresses');
      return response.data.data.addresses as Address[];
    },
    enabled: !!activeUser,
  });

  const { data: profileData, refetch: refetchProfile } = useQuery({
    queryKey: ['user-profile'],
    queryFn: async () => {
      const response = await api.get('/profile');
      return response.data.data.user as { loyaltyPoints: number; walletBalance: number };
    },
    enabled: !!activeUser,
  });

  const [usePoints, setUsePoints] = useState(false);

  const addresses = addressesData ?? [];
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);

  useEffect(() => {
    if (addresses.length > 0 && !selectedAddressId) {
      const defaultAddr = addresses.find((a) => a.isDefault);
      setSelectedAddressId(defaultAddr ? defaultAddr.id : addresses[0].id);
    }
  }, [addresses, selectedAddressId]);

  // Add address form state
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [addressLabel, setAddressLabel] = useState('Home');
  const [addressFlat, setAddressFlat] = useState('');
  const [addressStreet, setAddressStreet] = useState('');
  const [addressArea, setAddressArea] = useState('');
  const [addressCity, setAddressCity] = useState('');
  const [addressPincode, setAddressPincode] = useState('');
  const [addingAddress, setAddingAddress] = useState(false);

  const handleAddAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addressFlat || !addressStreet || !addressArea || !addressCity || !addressPincode) {
      toast.error('Please fill in all address fields.');
      return;
    }
    setAddingAddress(true);
    try {
      const response = await api.post('/profile/addresses', {
        label: addressLabel,
        flat: addressFlat,
        street: addressStreet,
        area: addressArea,
        city: addressCity,
        pincode: addressPincode,
        isDefault: addresses.length === 0,
      });
      const newAddr = response.data.data.address as Address;
      toast.success('Address added successfully! 🎉');
      setSelectedAddressId(newAddr.id);
      setShowAddAddress(false);
      
      setAddressFlat('');
      setAddressStreet('');
      setAddressArea('');
      setAddressCity('');
      setAddressPincode('');
      
      await refetchAddresses();
    } catch {
      toast.error('Failed to add address.');
    } finally {
      setAddingAddress(false);
    }
  };

  const { items, couponCode, couponDiscount, clearCart, subtotal, total, removeItem } = useCartStore();
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<'RAZORPAY' | 'COD' | 'PAY_TO_WAITER'>('RAZORPAY');
  const [onlinePaymentType, setOnlinePaymentType] = useState<'DIRECT' | 'RAZORPAY'>('DIRECT');

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
      const storedId = sessionStorage.getItem('qr_restaurant_addon_order_id');
      const storedNum = sessionStorage.getItem('qr_restaurant_addon_order_num');
      if (storedId) {
        setAddonOrderId(storedId);
        setAddonOrderNum(storedNum);
        setSelectedPayment('PAY_TO_WAITER');
      }
    }
  }, []);

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
  const isDineIn = diningOption === 'DINE_IN';
  const deliveryPlusPackaging = isDineIn ? 0 : (DELIVERY_FEE + PACKAGING_FEE);
  const finalCouponDiscount = addonOrderId ? 0 : couponDiscount;
  const grandTotalBeforePoints = Math.max(subtotalAmount + gst + deliveryPlusPackaging - finalCouponDiscount, 0);

  const pointsAvailable = profileData?.loyaltyPoints ?? activeUser?.loyaltyPoints ?? 0;
  const maxPointsDiscount = pointsAvailable / 50;
  const pointsDiscount = usePoints && !addonOrderId ? Math.min(maxPointsDiscount, grandTotalBeforePoints) : 0;
  const grandTotal = Math.max(grandTotalBeforePoints - pointsDiscount, 0);

  const { register, handleSubmit, formState: { errors } } = useForm<GuestForm>({
    resolver: zodResolver(guestSchema),
    defaultValues: { paymentMethod: 'RAZORPAY' },
  });

  const loadRazorpay = (): Promise<boolean> => {
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleRazorpayPayment = async (orderId: string, razorpayOrderId: string, amount: number, customerName: string, customerPhone: string) => {
    // Always read from ref or env to get the latest key
    const key = razorpayKeyRef.current || razorpayKeyId || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID || 'rzp_live_TAVv5bDEV3HwgB';

    if (!key) {
      toast.error('Payment gateway configuration error. Please contact support.');
      return;
    }

    const loaded = await loadRazorpay();
    if (!loaded) {
      toast.error('Failed to load payment gateway. Please check your internet connection.');
      return;
    }

    const options: RazorpayOptions = {
      key,
      amount: Math.round(amount * 100),
      currency: 'INR',
      name: 'EZ- Restaurant',
      description: `Order #${orderId.slice(-8).toUpperCase()}`,
      ...(razorpayOrderId ? { order_id: razorpayOrderId } : {}),
      handler: async (response) => {
        try {
          await api.post('/orders/verify-payment', {
            orderId,
            razorpayOrderId: response.razorpay_order_id || razorpayOrderId,
            razorpayPaymentId: response.razorpay_payment_id || `pay_${Date.now()}`,
            razorpaySignature: response.razorpay_signature || 'direct_signature',
          });
          queryClient.invalidateQueries({ queryKey: ['user-profile'] });
          queryClient.invalidateQueries({ queryKey: ['user-profile-loyalty'] });
          saveOrderToRecent(orderId, restaurantSlug);
          clearCart();
          toast.success('Payment successful! 🎉');
          router.push(`/r/${restaurantSlug}/order/${orderId}`);
        } catch {
          toast.error('Payment verification failed. Please contact support.');
        }
      },
      prefill: {
        name: customerName,
        email: activeUser?.email ?? '',
        contact: customerPhone,
      },
      theme: { color: '#E85D04' },
      modal: {
        ondismiss: () => {
          toast.error('Payment cancelled by user.');
        },
      },
    };

    try {
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (response: any) => {
        toast.error(response?.error?.description || 'Payment failed. Please try again.');
      });
      rzp.open();
    } catch (err: any) {
      console.error('Failed to initialize Razorpay payment modal:', err);
      toast.error('Could not open Razorpay checkout window. Please try again.');
    }
  };

  const handleConfirmMockPayment = async () => {
    if (!mockPaymentData) return;
    setIsProcessingMockPayment(true);
    try {
      await api.post('/orders/verify-payment', {
        orderId: mockPaymentData.orderId,
        razorpayOrderId: mockPaymentData.razorpayOrderId,
        razorpayPaymentId: `pay_mock_${Math.random().toString(36).substring(2, 15)}`,
        razorpaySignature: 'mock_signature',
      });
      queryClient.invalidateQueries({ queryKey: ['user-profile'] });
      queryClient.invalidateQueries({ queryKey: ['user-profile-loyalty'] });
      saveOrderToRecent(mockPaymentData.orderId, restaurantSlug);
      clearCart();
      toast.success('Payment simulated successfully! 🎉');
      setShowMockPaymentModal(false);
      setMockPaymentData(null);
      router.push(`/r/${restaurantSlug}/order/${mockPaymentData.orderId}`);
    } catch {
      toast.error('Payment verification failed. Please try again.');
    } finally {
      setIsProcessingMockPayment(false);
    }
  };

  const onGuestSubmit = async (formData: GuestForm) => {
    if (items.length === 0) {
      toast.error('Your cart is empty');
      return;
    }
    setLoading(true);
    try {
      const token = tableToken || localStorage.getItem(`table_token_${restaurantSlug}`) || '';
      const response = await api.post('/orders/guest', {
        guestName: formData.guestName,
        guestPhone: formData.guestPhone,
        tableNumber: manualTableNumber || undefined,
        tableToken: token,
        paymentMethod: selectedPayment,
        isDirect: selectedPayment === 'RAZORPAY' && onlinePaymentType === 'DIRECT',
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
        order: { id: string; total: number; razorpayOrderId: string | null };
      };

      if (selectedPayment === 'RAZORPAY' && order.razorpayOrderId && onlinePaymentType === 'RAZORPAY') {
        await handleRazorpayPayment(order.id, order.razorpayOrderId, order.total, formData.guestName, formData.guestPhone);
      } else {
        saveOrderToRecent(order.id, restaurantSlug);
        clearCart();
        const hasDirectPayment = !!(restaurant?.paymentQrCode || restaurant?.paymentUpiId || restaurant?.paymentPhone || restaurant?.bankAccountNumber);
        toast.success(hasDirectPayment && selectedPayment === 'RAZORPAY' ? 'Order placed! Please pay direct to the restaurant.' : 'Order placed successfully! 🎉');
        router.push(`/r/${restaurantSlug}/order/${order.id}`);
      }
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
    if (diningOption === 'DELIVERY' && !selectedAddressId) {
      toast.error('Please select or add a delivery address.');
      return;
    }
    setLoading(true);
    try {
      const token = tableToken || localStorage.getItem(`table_token_${restaurantSlug}`) || '';
      const response = await api.post('/orders', {
        ...(diningOption === 'DINE_IN' ? { tableNumber: manualTableNumber || undefined, tableToken: token } : { addressId: selectedAddressId }),
        paymentMethod: selectedPayment,
        isDirect: selectedPayment === 'RAZORPAY' && onlinePaymentType === 'DIRECT',
        couponCode: couponCode ?? undefined,
        restaurantSlug,
        useWallet: false,
        usePoints,
        cartItems: items.map((item) => ({
          menuItemId: item.menuItemId,
          variantId: item.variantId,
          quantity: item.quantity,
          addOns: item.addOns,
        })),
      });

      const { order } = response.data.data as {
        order: { id: string; total: number; razorpayOrderId: string | null };
      };

      if (selectedPayment === 'RAZORPAY' && order.razorpayOrderId && onlinePaymentType === 'RAZORPAY') {
        await handleRazorpayPayment(order.id, order.razorpayOrderId, order.total, activeUser!.name, activeUser!.phone ?? '');
      } else {
        queryClient.invalidateQueries({ queryKey: ['user-profile'] });
        queryClient.invalidateQueries({ queryKey: ['user-profile-loyalty'] });
        saveOrderToRecent(order.id, restaurantSlug);
        clearCart();
        const hasDirectPayment = !!(restaurant?.paymentQrCode || restaurant?.paymentUpiId || restaurant?.paymentPhone || restaurant?.bankAccountNumber);
        toast.success(hasDirectPayment && selectedPayment === 'RAZORPAY' ? 'Order placed! Please pay direct to the restaurant.' : 'Order placed! 🎉');
        router.push(`/r/${restaurantSlug}/order/${order.id}`);
      }
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
        {/* Dining Option Selector removed (Dine-In only) */}

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
              <span>GST (18%)</span><span suppressHydrationWarning>₹{gst.toFixed(2)}</span>
            </div>
            {!isDineIn && (
              <div className="flex justify-between text-muted-foreground">
                <span>Delivery + Packaging</span><span>₹{DELIVERY_FEE + PACKAGING_FEE}</span>
              </div>
            )}
            {mounted && !addonOrderId && couponDiscount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Coupon ({couponCode})</span><span>-₹{couponDiscount.toFixed(2)}</span>
              </div>
            )}
            {mounted && !addonOrderId && pointsDiscount > 0 && (
              <div className="flex justify-between text-green-600">
                <span>Loyalty Points Discount</span><span>-₹{pointsDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-border pt-2">
              <span>Total</span><span suppressHydrationWarning>₹{grandTotal.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Home Delivery Address Selector (Logged in users only) */}
        {diningOption === 'DELIVERY' && activeUser && (
          <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-semibold flex items-center gap-2 text-sm text-foreground">
                <MapPin className="w-4 h-4 text-primary" /> Delivery Address
              </h2>
              {!showAddAddress && (
                <button
                  type="button"
                  onClick={() => setShowAddAddress(true)}
                  className="text-xs text-primary font-semibold hover:underline flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add Address
                </button>
              )}
            </div>

            {showAddAddress ? (
              <form onSubmit={handleAddAddress} className="space-y-3 border-t border-border pt-4">
                <div className="flex gap-2">
                  {['Home', 'Work', 'Other'].map((lbl) => (
                    <button
                      key={lbl}
                      type="button"
                      onClick={() => setAddressLabel(lbl)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all ${
                        addressLabel === lbl
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <input
                    placeholder="Flat / House No. / Building"
                    value={addressFlat}
                    onChange={(e) => setAddressFlat(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-muted rounded-lg text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                  <input
                    placeholder="Street / Locality"
                    value={addressStreet}
                    onChange={(e) => setAddressStreet(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-muted rounded-lg text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <input
                    placeholder="Area"
                    value={addressArea}
                    onChange={(e) => setAddressArea(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-muted rounded-lg text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                  <input
                    placeholder="City"
                    value={addressCity}
                    onChange={(e) => setAddressCity(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-muted rounded-lg text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                  <input
                    placeholder="Pincode"
                    value={addressPincode}
                    onChange={(e) => setAddressPincode(e.target.value)}
                    required
                    className="w-full px-3 py-2 bg-muted rounded-lg text-xs border-0 focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddAddress(false)}
                    className="px-3.5 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-muted text-foreground"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={addingAddress}
                    className="px-4 py-1.5 rounded-lg text-white bg-primary hover:bg-primary/95 text-xs font-semibold disabled:opacity-60 flex items-center gap-1.5"
                  >
                    {addingAddress && <Loader2 className="w-3 h-3 animate-spin" />}
                    Save Address
                  </button>
                </div>
              </form>
            ) : addresses.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-border rounded-xl space-y-3">
                <p className="text-xs text-muted-foreground">No saved addresses found.</p>
                <button
                  type="button"
                  onClick={() => setShowAddAddress(true)}
                  className="px-4 py-2 bg-primary/10 text-primary hover:bg-primary/20 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 mx-auto"
                >
                  <PlusCircle className="w-4 h-4" /> Add Delivery Address
                </button>
              </div>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {addresses.map((addr) => (
                  <button
                    key={addr.id}
                    type="button"
                    onClick={() => setSelectedAddressId(addr.id)}
                    className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                      selectedAddressId === addr.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0 mt-0.5">
                      {addr.label === 'Home' ? <Home className="w-4 h-4" /> : addr.label === 'Work' ? <Briefcase className="w-4 h-4" /> : <MapPin className="w-4 h-4" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-foreground">{addr.label}</span>
                        {addr.isDefault && <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Default</span>}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{addr.flat}, {addr.street}</p>
                      <p className="text-[11px] text-muted-foreground truncate">{addr.area}, {addr.city} - {addr.pincode}</p>
                    </div>
                    {selectedAddressId === addr.id && (
                      <Check className="w-4 h-4 text-primary mt-1 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Loyalty Points Card */}
        {activeUser && pointsAvailable > 0 && !addonOrderId && (
          <div className="bg-card border border-border rounded-2xl p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center text-orange-500">
                <Gift className="w-5 h-5" />
              </div>
              <div>
                <p className="font-semibold text-sm text-foreground">Redeem Loyalty Points</p>
                <p className="text-xs text-muted-foreground">
                  You have {pointsAvailable} points (Worth ₹{maxPointsDiscount.toFixed(0)})
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setUsePoints(!usePoints)}
              className={`px-4 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                usePoints
                  ? 'border-orange-500 bg-orange-500 text-white'
                  : 'border-border text-foreground hover:bg-muted'
              }`}
            >
              {usePoints ? 'Redeemed' : 'Redeem'}
            </button>
          </div>
        )}

        {/* Payment Method */}
        {!(diningOption === 'DELIVERY' && !activeUser) && (
          <div className="bg-card border border-border rounded-2xl p-4">
            <h2 className="font-display font-semibold mb-3">Payment Method</h2>
            <div className="space-y-2">
              {[
                { value: 'RAZORPAY', label: 'Pay Online', sublabel: 'UPI, Cards, Net Banking', icon: <CreditCard className="w-5 h-5" /> },
                { value: 'COD', label: 'Pay on Counter', sublabel: 'Pay cash or card at the counter', icon: <Banknote className="w-5 h-5" /> },
                { value: 'PAY_TO_WAITER', label: 'Pay to Waiter', sublabel: 'Pay at your table (Cash/UPI/Card)', icon: <User className="w-5 h-5" /> },
              ].map((method) => (
                <button
                  key={method.value}
                  type="button"
                  onClick={() => setSelectedPayment(method.value as 'RAZORPAY' | 'COD' | 'PAY_TO_WAITER')}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-all ${
                    selectedPayment === method.value
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                    selectedPayment === method.value ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                  }`}>
                    {method.icon}
                  </div>
                  <div className="text-left flex-1">
                    <p className="font-semibold text-sm">{method.label}</p>
                    <p className="text-xs text-muted-foreground">{method.sublabel}</p>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 ${
                    selectedPayment === method.value ? 'border-primary bg-primary' : 'border-muted-foreground'
                  }`} />
                </button>
              ))}
            </div>

            <AnimatePresence>
              {selectedPayment === 'RAZORPAY' && !!(restaurant?.paymentQrCode || restaurant?.paymentUpiId || restaurant?.paymentPhone || restaurant?.bankAccountNumber) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 pl-3 border-l-2 border-primary/30 space-y-2 overflow-hidden"
                >
                  <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1">
                    Select Online Payment Option:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setOnlinePaymentType('DIRECT')}
                      className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all relative ${
                        onlinePaymentType === 'DIRECT'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'border-border hover:bg-muted/40'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        onlinePaymentType === 'DIRECT' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      }`}>
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-xs text-foreground font-display">Pay Direct to Owner</p>
                        <p className="text-[10px] text-muted-foreground leading-normal mt-0.5">Use Owner QR, UPI, or Bank</p>
                      </div>
                      {onlinePaymentType === 'DIRECT' && (
                        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setOnlinePaymentType('RAZORPAY')}
                      className={`flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all relative ${
                        onlinePaymentType === 'RAZORPAY'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'border-border hover:bg-muted/40'
                      }`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        onlinePaymentType === 'RAZORPAY' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                      }`}>
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-semibold text-xs text-foreground font-display">Pay using Razorpay</p>
                        <p className="text-[10px] text-muted-foreground leading-normal mt-0.5">Standard online instant payment</p>
                      </div>
                      {onlinePaymentType === 'RAZORPAY' && (
                        <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                      )}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {selectedPayment === 'RAZORPAY' && onlinePaymentType === 'DIRECT' && (restaurant?.paymentQrCode || restaurant?.paymentUpiId || restaurant?.paymentPhone || restaurant?.bankAccountNumber) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-2xl p-5 space-y-4 shadow-sm"
          >
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <CreditCard className="w-5 h-5 text-primary" />
              <h3 className="font-display font-semibold text-sm">Direct Payment Details</h3>
            </div>
            
            <p className="text-xs text-muted-foreground leading-relaxed">
              Please transfer the total amount of <strong className="text-foreground">₹{grandTotal.toFixed(2)}</strong> directly to the restaurant owner using the details below:
            </p>

            {restaurant.paymentQrCode && (
              <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-border max-w-[200px] mx-auto">
                <img
                  src={restaurant.paymentQrCode}
                  alt="Restaurant Payment QR"
                  className="w-40 h-40 object-contain"
                />
                <span className="text-[10px] text-gray-500 mt-1 font-semibold">Scan to Pay</span>
              </div>
            )}

            <div className="space-y-2.5 text-xs">
              {restaurant.paymentUpiId && (
                <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">UPI ID</span>
                    <span className="font-mono font-medium text-foreground">{restaurant.paymentUpiId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(restaurant.paymentUpiId || '');
                      toast.success('UPI ID copied!');
                    }}
                    className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                    title="Copy UPI ID"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {restaurant.paymentPhone && (
                <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Phone for Payment</span>
                    <span className="font-mono font-medium text-foreground">{restaurant.paymentPhone}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(restaurant.paymentPhone || '');
                      toast.success('Phone number copied!');
                    }}
                    className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                    title="Copy Phone"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {restaurant.bankAccountNumber && (
                <div className="p-3 bg-muted/20 border border-border/60 rounded-xl space-y-2">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Bank Account Details</span>
                  
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {restaurant.bankAccountHolder && (
                      <div>
                        <span className="text-muted-foreground block">Holder Name</span>
                        <span className="font-medium text-foreground">{restaurant.bankAccountHolder}</span>
                      </div>
                    )}
                    {restaurant.bankName && (
                      <div>
                        <span className="text-muted-foreground block">Bank Name</span>
                        <span className="font-medium text-foreground">{restaurant.bankName}</span>
                      </div>
                    )}
                    <div className="col-span-2 flex items-center justify-between border-t border-border/50 pt-1.5 mt-1">
                      <div>
                        <span className="text-muted-foreground block">Account Number</span>
                        <span className="font-mono font-medium text-foreground">{restaurant.bankAccountNumber}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(restaurant.bankAccountNumber || '');
                          toast.success('Account number copied!');
                        }}
                        className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                        title="Copy Account Number"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {restaurant.bankIfsc && (
                      <div className="col-span-2 flex items-center justify-between border-t border-border/50 pt-1.5 mt-1">
                        <div>
                          <span className="text-muted-foreground block">IFSC Code</span>
                          <span className="font-mono font-medium text-foreground">{restaurant.bankIfsc}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(restaurant.bankIfsc || '');
                            toast.success('IFSC Code copied!');
                          }}
                          className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                          title="Copy IFSC Code"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 bg-primary/5 border border-primary/10 rounded-xl text-[11px] text-primary leading-relaxed font-medium">
              After transfer, click <strong>Place Order / Settle Payment</strong> below. Your order will be placed as pending, and will be confirmed once the restaurant owner verifies the transaction.
            </div>
          </motion.div>
        )}

        {/* Guest or user form or login required prompt */}
        {diningOption === 'DELIVERY' && !activeUser ? (
          <div className="bg-card border border-border rounded-2xl p-6 text-center space-y-4 shadow-xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-orange-500/5 via-transparent to-transparent pointer-events-none" />
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto text-primary text-2xl">
              🔑
            </div>
            <h2 className="font-display font-bold text-lg text-foreground">Customer Login Required</h2>
            <p className="text-muted-foreground text-sm max-w-sm mx-auto leading-relaxed">
              To request Home Delivery, you must log in to your account. This ensures you can track your order and save delivery addresses.
            </p>
            <div className="pt-2">
              <Link
                href={`/login?restaurant=${restaurantSlug}`}
                className="inline-block px-8 py-3.5 bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold rounded-xl shadow-lg shadow-orange-500/10 transition-all active:scale-95"
              >
                Log In to Continue
              </Link>
            </div>
            <p className="text-xs text-muted-foreground pt-1">
              Don't have an account? <Link href={`/register?restaurant=${restaurantSlug}`} className="text-primary hover:underline font-semibold">Sign up</Link>
            </p>
          </div>
        ) : activeUser && activeUser.role !== 'CUSTOMER' ? (
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
                  router.push(`/login?restaurant=${restaurantSlug}`);
                }}
                className="w-full py-3.5 bg-muted hover:bg-muted/80 text-foreground font-semibold rounded-xl text-center transition-all active:scale-95 text-sm"
              >
                Log Out & Use Customer Account
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
              {loading ? 'Adding Items...' : `Confirm & Add Items · ₹${grandTotal.toFixed(0)}`}
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
            {diningOption === 'DINE_IN' && (
              <div className="mt-4">
                <label className="text-xs font-semibold text-muted-foreground mb-1 block">Table Number</label>
                <input
                  type="text"
                  placeholder="Enter Table Number (e.g. 5, A2)"
                  value={manualTableNumber}
                  onChange={(e) => setManualTableNumber(e.target.value)}
                  className="w-full px-3 py-2 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                />
              </div>
            )}
            <button
              onClick={onUserOrder}
              disabled={loading || items.length === 0}
              className="w-full mt-4 py-4 rounded-2xl text-white font-bold text-base bg-gradient-to-r from-orange-500 to-amber-500 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Placing Order...' : `Place Order · ₹${grandTotal.toFixed(0)}`}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit(onGuestSubmit)} className="bg-card border border-border rounded-2xl p-4 space-y-4">
            <h2 className="font-display font-semibold">Your Details</h2>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  {...register('guestName')}
                  placeholder="John Doe"
                  className="w-full pl-9 pr-4 py-3 bg-muted rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                />
              </div>
              {errors.guestName && <p className="text-red-500 text-xs mt-1">{errors.guestName.message}</p>}
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Phone Number</label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  {...register('guestPhone')}
                  placeholder="9876543210"
                  type="tel"
                  maxLength={10}
                  className="w-full pl-9 pr-4 py-3 bg-muted rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                />
              </div>
              {errors.guestPhone && <p className="text-red-500 text-xs mt-1">{errors.guestPhone.message}</p>}
            </div>

            {diningOption === 'DINE_IN' && (
              <div>
                <label className="text-sm font-medium mb-1.5 block">Table Number</label>
                <input
                  type="text"
                  placeholder="Enter Table Number (e.g. 5, A2)"
                  value={manualTableNumber}
                  onChange={(e) => setManualTableNumber(e.target.value)}
                  className="w-full px-4 py-3 bg-muted rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                />
              </div>
            )}

            <div className="text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href={`/login?restaurant=${restaurantSlug}`} className="text-primary font-medium underline">
                Log in
              </Link>{' '}
              for loyalty points & order history.
            </div>

            <button
              type="submit"
              disabled={loading || items.length === 0}
              className="w-full py-4 rounded-2xl text-white font-bold text-base bg-gradient-to-r from-orange-500 to-amber-500 disabled:opacity-60 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Placing Order...' : `Place Order · ₹${grandTotal.toFixed(0)}`}
            </button>
          </form>
        )}
      </div>

      {/* Mock Payment Modal */}
      <AnimatePresence>
        {showMockPaymentModal && mockPaymentData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                if (!isProcessingMockPayment) {
                  setShowMockPaymentModal(false);
                  toast.error('Payment cancelled');
                }
              }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />

            {/* Modal Body */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="bg-card border border-border w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative z-10"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white p-6 relative">
                <button
                  type="button"
                  disabled={isProcessingMockPayment}
                  onClick={() => {
                    setShowMockPaymentModal(false);
                    toast.error('Payment cancelled');
                  }}
                  className="absolute top-4 right-4 p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors disabled:opacity-50"
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2 mb-1">
                  <div className="bg-white/20 p-1.5 rounded-lg">
                    <Lock className="w-4 h-4 text-white" />
                  </div>
                  <span className="text-xs font-bold tracking-wider uppercase opacity-90">Secure Checkout</span>
                </div>
                <h3 className="font-display font-bold text-xl">Online Payment Gateway</h3>
                <p className="text-xs opacity-75 mt-1">Simulated transaction for Development Mode</p>
              </div>

              {/* Order Info */}
              <div className="p-6 border-b border-border bg-muted/30 flex justify-between items-center">
                <div>
                  <p className="text-xs text-muted-foreground">Amount to Pay</p>
                  <p className="font-display font-extrabold text-2xl text-foreground font-mono">₹{mockPaymentData.amount.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] bg-primary/10 text-primary px-2.5 py-1 rounded-full font-bold inline-block border border-primary/20">
                    Order ID: #{mockPaymentData.orderId.slice(-6).toUpperCase()}
                  </p>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex border-b border-border p-2 bg-muted/10">
                <button
                  type="button"
                  onClick={() => setMockPaymentMethod('manual')}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    mockPaymentMethod === 'manual'
                      ? 'bg-card text-primary shadow-sm border border-border'
                      : 'text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  Pay Manually
                </button>
                <button
                  type="button"
                  onClick={() => setMockPaymentMethod('automatic')}
                  className={`flex-1 flex flex-col items-center gap-1.5 py-2.5 rounded-xl text-xs font-semibold transition-all ${
                    mockPaymentMethod === 'automatic'
                      ? 'bg-card text-primary shadow-sm border border-border'
                      : 'text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  <CreditCard className="w-4 h-4" />
                  Razorpay (Automatic)
                </button>
              </div>

              {/* Content area */}
              <div className="p-6 space-y-4 min-h-[220px]">
                {mockPaymentMethod === 'manual' && (
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-1">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Please transfer the total amount directly to the restaurant owner using the details below, then click <strong>Confirm Manual Payment</strong>.
                    </p>

                    {restaurant?.paymentQrCode && (
                      <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-border max-w-[180px] mx-auto">
                        <img
                          src={restaurant.paymentQrCode}
                          alt="Restaurant Payment QR"
                          className="w-36 h-36 object-contain"
                        />
                        <span className="text-[10px] text-gray-500 mt-1 font-semibold">Scan to Pay</span>
                      </div>
                    )}

                    <div className="space-y-2 text-xs">
                      {restaurant?.paymentUpiId && (
                        <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                          <div>
                            <span className="text-muted-foreground block text-[9px] uppercase font-bold tracking-wider">UPI ID</span>
                            <span className="font-mono font-medium text-foreground">{restaurant.paymentUpiId}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(restaurant.paymentUpiId || '');
                              toast.success('UPI ID copied!');
                            }}
                            className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                            title="Copy UPI ID"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {restaurant?.paymentPhone && (
                        <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                          <div>
                            <span className="text-muted-foreground block text-[9px] uppercase font-bold tracking-wider">Phone for Payment</span>
                            <span className="font-mono font-medium text-foreground">{restaurant.paymentPhone}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(restaurant.paymentPhone || '');
                              toast.success('Phone number copied!');
                            }}
                            className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                            title="Copy Phone"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                      )}

                      {restaurant?.bankAccountNumber && (
                        <div className="p-3 bg-muted/20 border border-border/60 rounded-xl space-y-2">
                          <span className="text-muted-foreground block text-[9px] uppercase font-bold tracking-wider">Bank Account Details</span>
                          <div className="grid grid-cols-2 gap-2 text-[10px]">
                            {restaurant.bankAccountHolder && (
                              <div>
                                <span className="text-muted-foreground block">Holder Name</span>
                                <span className="font-medium text-foreground">{restaurant.bankAccountHolder}</span>
                              </div>
                            )}
                            {restaurant.bankName && (
                              <div>
                                <span className="text-muted-foreground block">Bank Name</span>
                                <span className="font-medium text-foreground">{restaurant.bankName}</span>
                              </div>
                            )}
                            <div className="col-span-2 flex items-center justify-between border-t border-border/50 pt-1.5 mt-1">
                              <div>
                                <span className="text-muted-foreground block">Account Number</span>
                                <span className="font-mono font-medium text-foreground">{restaurant.bankAccountNumber}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(restaurant.bankAccountNumber || '');
                                  toast.success('Account number copied!');
                                }}
                                className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                                title="Copy Account Number"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                            {restaurant.bankIfsc && (
                              <div className="col-span-2 flex items-center justify-between border-t border-border/50 pt-1.5 mt-1">
                                <div>
                                  <span className="text-muted-foreground block">IFSC Code</span>
                                  <span className="font-mono font-medium text-foreground">{restaurant.bankIfsc}</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    navigator.clipboard.writeText(restaurant.bankIfsc || '');
                                    toast.success('IFSC Code copied!');
                                  }}
                                  className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                                  title="Copy IFSC Code"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {!restaurant?.paymentQrCode && !restaurant?.paymentUpiId && !restaurant?.paymentPhone && !restaurant?.bankAccountNumber && (
                        <div className="text-center py-6 text-muted-foreground text-xs flex flex-col items-center gap-1">
                          <QrCode className="w-8 h-8 text-muted-foreground/50 mb-1" />
                          <span>No manual payment details entered by the restaurant owner.</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {mockPaymentMethod === 'automatic' && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Pay online instantly using our simulated Razorpay secure gateway.
                    </p>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Card Number</label>
                        <input
                          type="text"
                          placeholder="4111 2222 3333 4444"
                          maxLength={19}
                          value={mockCardNumber}
                          onChange={(e) => setMockCardNumber(formatCardNumber(e.target.value))}
                          className="w-full px-3.5 py-2.5 bg-muted rounded-xl text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground font-mono"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Expiry Date</label>
                          <input
                            type="text"
                            placeholder="MM/YY"
                            maxLength={5}
                            value={mockCardExpiry}
                            onChange={(e) => setMockCardExpiry(formatExpiry(e.target.value))}
                            className="w-full px-3.5 py-2.5 bg-muted rounded-xl text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground font-mono"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">CVV</label>
                          <input
                            type="password"
                            placeholder="•••"
                            maxLength={3}
                            value={mockCardCVV}
                            onChange={(e) => setMockCardCVV(e.target.value.replace(/[^0-9]/g, ''))}
                            className="w-full px-3.5 py-2.5 bg-muted rounded-xl text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground font-mono"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Card Holder Name</label>
                        <input
                          type="text"
                          placeholder={mockPaymentData.customerName}
                          value={mockCardName}
                          onChange={(e) => setMockCardName(e.target.value)}
                          className="w-full px-3.5 py-2.5 bg-muted rounded-xl text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/20 text-foreground"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Secure footer bar */}
              <div className="px-6 py-3 bg-muted/20 border-t border-border flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground font-medium">
                <span>🔒 Secure 256-bit SSL encrypted simulation</span>
              </div>

              {/* Actions */}
              <div className="p-6 pt-4 border-t border-border flex gap-3 bg-muted/10">
                <button
                  type="button"
                  disabled={isProcessingMockPayment}
                  onClick={() => {
                    setShowMockPaymentModal(false);
                    toast.error('Payment cancelled');
                  }}
                  className="flex-1 py-3 rounded-xl border border-border font-semibold text-sm hover:bg-muted transition-colors disabled:opacity-50 text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isProcessingMockPayment}
                  onClick={handleConfirmMockPayment}
                  className="flex-1 py-3 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-semibold text-sm transition-all active:scale-95 disabled:opacity-60 flex items-center justify-center gap-1.5 shadow-lg shadow-orange-500/20"
                >
                  {isProcessingMockPayment ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Processing...
                    </>
                  ) : mockPaymentMethod === 'manual' ? (
                    'Confirm Manual Payment'
                  ) : (
                    `Pay ₹${mockPaymentData.amount.toFixed(0)}`
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
