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
import { getImageUrl } from '@/lib/image';
import QRCode from 'qrcode';

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
    } else {
      setManualTableNumber(tableNumber);
    }
  }, [tableNumber, restaurantSlug]);

  const handleTableNumberChange = (val: string) => {
    setManualTableNumber(val);
    if (val.trim()) {
      localStorage.setItem(`table_num_${restaurantSlug}`, val.trim());
    } else {
      localStorage.removeItem(`table_num_${restaurantSlug}`);
    }
  };

  const hasTableToken = useMemo(() => {
    if (tableToken && tableToken.trim() !== '') return true;
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

      // Deep link trigger for mobile devices
      if (typeof window !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) {
        window.location.href = paymentInfo.upiIntentUrl;
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Failed to initialize UPI Payment.';
      toast.error(msg);
    }
  };

  // QR Tab state inside UPI Modal
  const [selectedQrTab, setSelectedQrTab] = useState<'dynamic' | 'custom'>('dynamic');

  // Status Polling for UPI Payment Verification
  useEffect(() => {
    if (!showUpiModal || !upiData?.paymentId) return;

    const checkStatus = async () => {
      try {
        setIsCheckingUpiStatus(true);
        const res = await api.get(`/payments/${upiData.paymentId}/status`);
        const status = res.data?.data?.status || res.data?.data?.orderPaymentStatus;
        if (status === 'PAID') {
          saveOrderToRecent(upiData.orderId, restaurantSlug);
          clearCart();
          setShowUpiModal(false);
          toast.success('Payment Verified & Order Confirmed! 🎉');
          router.push(`/r/${restaurantSlug}/order/${upiData.orderId}`);
        }
      } catch (err) {
        console.error('Error polling payment status:', err);
      } finally {
        setIsCheckingUpiStatus(false);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);
    return () => clearInterval(interval);
  }, [showUpiModal, upiData, restaurantSlug, router, clearCart]);

  const onGuestSubmit = async (formData: GuestForm) => {
    if (items.length === 0) {
      toast.error('Your cart is empty');
      return;
    }
    if (diningOption === 'DINE_IN' && (!manualTableNumber || !manualTableNumber.trim())) {
      toast.error('Please enter your table number.');
      return;
    }
    setLoading(true);
    try {
      const token = tableToken || localStorage.getItem(`table_token_${restaurantSlug}`) || '';
      const response = await api.post('/orders/guest', {
        guestName: formData.guestName?.trim() || 'Guest',
        guestPhone: formData.guestPhone?.trim() || '',
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

      if (selectedPayment === 'RAZORPAY') {
        await handleUpiIntentPayment(order.id);
      } else {
        saveOrderToRecent(order.id, restaurantSlug);
        clearCart();
        toast.success('Order placed successfully! 🎉');
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
    if (diningOption === 'DINE_IN' && (!manualTableNumber || !manualTableNumber.trim())) {
      toast.error('Please enter your table number.');
      return;
    }
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

      if (selectedPayment === 'RAZORPAY') {
        await handleUpiIntentPayment(order.id);
      } else {
        queryClient.invalidateQueries({ queryKey: ['user-profile'] });
        queryClient.invalidateQueries({ queryKey: ['user-profile-loyalty'] });
        saveOrderToRecent(order.id, restaurantSlug);
        clearCart();
        toast.success('Order placed! 🎉');
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

            {/* Direct Payment sub-options removed to directly present owner QR & bank details */}
          </div>
        )}

        {selectedPayment === 'RAZORPAY' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-2xl p-4 space-y-2.5 shadow-sm"
          >
            <div className="flex items-center gap-2 text-primary">
              <Smartphone className="w-4.5 h-4.5" />
              <h3 className="font-display font-semibold text-xs text-foreground">Pay Online via UPI</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              When you click <strong>Place Order</strong> below, a secure UPI payment window will open allowing you to pay <strong>₹{grandTotal.toFixed(2)}</strong> via Google Pay, PhonePe, Paytm, or QR scan.
            </p>
            {restaurant?.merchantName && (
              <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[11px]">
                <span className="text-muted-foreground">Merchant / Payee Name:</span>
                <span className="font-semibold text-foreground">{restaurant.merchantName}</span>
              </div>
            )}
            {restaurant?.paymentUpiId && (
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-muted-foreground">Merchant UPI ID:</span>
                <span className="font-mono font-medium text-foreground">{restaurant.paymentUpiId}</span>
              </div>
            )}
          </motion.div>
        )}

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
                <label className="text-xs font-semibold text-muted-foreground mb-1 flex items-center justify-between">
                  <span>Table Number <span className="text-red-500">*</span></span>
                  {hasTableToken ? (
                    <span className="text-[10px] text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Scanned Table QR (Locked)
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full font-medium">
                      General QR (Enter Table No.)
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  placeholder="Enter Table Number (e.g. 5, A2)"
                  value={manualTableNumber}
                  readOnly={hasTableToken}
                  onChange={(e) => !hasTableToken && handleTableNumberChange(e.target.value)}
                  className={`w-full px-3.5 py-2.5 rounded-xl text-sm border-0 focus:outline-none text-foreground transition-all ${
                    hasTableToken
                      ? 'bg-muted/80 cursor-not-allowed font-semibold text-primary border border-primary/20 select-none'
                      : 'bg-muted focus:ring-2 focus:ring-primary/20'
                  }`}
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

            {diningOption === 'DINE_IN' && (
              <div>
                <label className="text-sm font-medium mb-1.5 flex items-center justify-between">
                  <span>Table Number <span className="text-red-500">*</span></span>
                  {hasTableToken ? (
                    <span className="text-[10px] text-green-600 bg-green-500/10 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1">
                      <Lock className="w-3 h-3" /> Scanned Table QR (Locked)
                    </span>
                  ) : (
                    <span className="text-[10px] text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded-full font-medium">
                      General QR (Enter Table No.)
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  placeholder="Enter Table Number (e.g. 5, A2)"
                  value={manualTableNumber}
                  readOnly={hasTableToken}
                  onChange={(e) => !hasTableToken && handleTableNumberChange(e.target.value)}
                  className={`w-full px-4 py-3 rounded-xl text-sm border-0 focus:outline-none text-foreground transition-all ${
                    hasTableToken
                      ? 'bg-muted/80 cursor-not-allowed font-semibold text-primary border border-primary/20 select-none'
                      : 'bg-muted focus:ring-2 focus:ring-primary/20'
                  }`}
                />
              </div>
            )}


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
              className="bg-card border border-border w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative z-10"
            >
              {/* Header */}
              <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white p-6 relative">
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
              <div className="p-6 border-b border-border bg-muted/30 flex justify-between items-center">
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
                    className={`flex-1 py-2 font-semibold rounded-lg transition-all ${
                      selectedQrTab === 'dynamic' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    Auto Dynamic QR (₹{upiData.amount.toFixed(0)})
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedQrTab('custom')}
                    className={`flex-1 py-2 font-semibold rounded-lg transition-all ${
                      selectedQrTab === 'custom' ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:bg-muted/50'
                    }`}
                  >
                    Owner Uploaded QR Image
                  </button>
                </div>
              )}

              {/* QR Code & Mobile Launch */}
              <div className="p-6 space-y-5 text-center">
                {selectedQrTab === 'custom' && restaurant?.paymentQrCode ? (
                  <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl border border-border max-w-[220px] mx-auto shadow-sm">
                    <img
                      src={getImageUrl(restaurant.paymentQrCode)}
                      alt="Owner Uploaded Payment QR"
                      className="w-44 h-44 object-contain"
                    />
                    <span className="text-[10px] text-gray-500 mt-2 font-semibold flex items-center gap-1">
                      <QrCode className="w-3 h-3 text-primary" /> Owner's Uploaded QR Image
                    </span>
                  </div>
                ) : upiQrCodeDataUrl ? (
                  <div className="flex flex-col items-center justify-center p-4 bg-white rounded-2xl border border-border max-w-[220px] mx-auto shadow-sm">
                    <img
                      src={upiQrCodeDataUrl}
                      alt="UPI Payment QR Code"
                      className="w-44 h-44 object-contain"
                    />
                    <span className="text-[10px] text-gray-500 mt-2 font-semibold flex items-center gap-1">
                      <QrCode className="w-3 h-3 text-primary" /> Scan with any UPI App (Exact ₹{upiData.amount.toFixed(2)})
                    </span>
                  </div>
                ) : (
                  <div className="w-44 h-44 rounded-2xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  </div>
                )}

                {/* Open UPI App Button */}
                <a
                  href={upiData.upiIntentUrl}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg shadow-orange-500/20"
                >
                  <Smartphone className="w-4 h-4" />
                  Open UPI App to Pay ₹{upiData.amount.toFixed(0)}
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
                      className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                      title="Copy UPI ID"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Real-time Verification Status Box */}
                <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl flex items-center gap-3 text-left">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                  <div>
                    <p className="font-semibold text-xs text-foreground">Verifying payment with backend server...</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {isCheckingUpiStatus ? 'Checking provider transaction state...' : 'Waiting for payment confirmation. Page will auto-update upon payment.'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="p-6 pt-3 border-t border-border flex gap-3 bg-muted/10">
                <button
                  type="button"
                  onClick={() => {
                    setShowUpiModal(false);
                    toast.info('You can track payment status on the order tracking page.');
                  }}
                  className="flex-1 py-3 rounded-xl border border-border font-semibold text-sm hover:bg-muted transition-colors text-foreground"
                >
                  Close & View Order
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
