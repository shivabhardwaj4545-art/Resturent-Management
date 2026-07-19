'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Clock,
  ChefHat,
  Package,
  Bike,
  Star,
  RotateCcw,
  Utensils,
  MapPin,
  CreditCard,
  Copy,
} from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { InvoiceDownload } from './InvoiceDownload';

// ─── Tracking Step Definitions ────────────────────────────────────────────────

const DELIVERY_STEPS = [
  { key: 'PENDING',    icon: <Clock className="w-5 h-5" />,        label: 'Order Placed' },
  { key: 'CONFIRMED',  icon: <CheckCircle2 className="w-5 h-5" />, label: 'Confirmed' },
  { key: 'PREPARING',  icon: <ChefHat className="w-5 h-5" />,      label: 'Preparing' },
  { key: 'READY',      icon: <Package className="w-5 h-5" />,      label: 'Ready for Pickup' },
  { key: 'ON_THE_WAY', icon: <Bike className="w-5 h-5" />,         label: 'On the Way' },
  { key: 'DELIVERED',  icon: <Star className="w-5 h-5" />,         label: 'Delivered' },
];

const DINE_IN_STEPS = [
  { key: 'PENDING',   icon: <Clock className="w-5 h-5" />,        label: 'Order Placed' },
  { key: 'CONFIRMED', icon: <CheckCircle2 className="w-5 h-5" />, label: 'Confirmed' },
  { key: 'PREPARING', icon: <ChefHat className="w-5 h-5" />,      label: 'Preparing' },
  { key: 'READY',     icon: <Utensils className="w-5 h-5" />,     label: 'Ready to Serve' },
  { key: 'DELIVERED', icon: <Star className="w-5 h-5" />,         label: 'Served & Completed' },
];

/**
 * Returns the step index for a given status.
 * 'BAKING' is treated as an intermediate state mapped to the PREPARING slot.
 */
function getStepIndex(
  status: string,
  steps: typeof DELIVERY_STEPS | typeof DINE_IN_STEPS,
): number {
  const idx = steps.findIndex((s) => s.key === status);
  if (idx !== -1) return idx;
  if (status === 'BAKING') return steps.findIndex((s) => s.key === 'PREPARING');
  return 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface Address {
  id: string;
  flat: string;
  street: string;
  area: string;
  city: string;
  pincode: string;
}

interface Order {
  id: string;
  restaurantId: string;
  status: string;
  subtotal: number;
  gstAmount: number;
  deliveryFee: number;
  packagingFee: number;
  discount: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  guestName: string | null;
  tableNumber: string | null;
  addressId: string | null;
  address: Address | null;
  createdAt: string;
  restaurant: {
    name: string;
    logo: string | null;
    themeColor: string | null;
    phone: string | null;
    paymentQrCode?: string | null;
    paymentUpiId?: string | null;
    paymentPhone?: string | null;
    bankName?: string | null;
    bankAccountNumber?: string | null;
    bankIfsc?: string | null;
    bankAccountHolder?: string | null;
  };
  items: Array<{
    id: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    menuItem: { name: string; image: string | null };
    variant: { name: string } | null;
    addOns?: any;
  }>;
}

interface OrderTrackingPageProps {
  orderId: string;
  restaurantSlug: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OrderTrackingPage({ orderId, restaurantSlug }: OrderTrackingPageProps) {
  const router = useRouter();
  const [currentStatus, setCurrentStatus] = useState<string>('PENDING');
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);

  const handleAddMoreItems = () => {
    if (!order) return;
    sessionStorage.setItem('qr_restaurant_addon_order_id', orderId);
    sessionStorage.setItem('qr_restaurant_addon_order_num', order.id.slice(-8).toUpperCase());
    router.push(`/r/${restaurantSlug}`);
  };

  // ── Fetch order data ──────────────────────────────────────────────────────
  const { data: order, isLoading } = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => {
      const response = await api.get(`/orders/${orderId}`);
      const ord = response.data.data.order as Order;
      setCurrentStatus(ord.status);
      return ord;
    },
  });

  // ── Socket.io real-time tracking ──────────────────────────────────────────
  useEffect(() => {
    const socket: Socket = io(
      process.env.NEXT_PUBLIC_API_URL?.replace('/api/v1', '') ?? 'http://localhost:4000',
      { transports: ['websocket'], withCredentials: true },
    );

    // ✅ Correct event name: 'join:order'
    socket.emit('join:order', orderId);

    // ✅ Correct event name: 'order:status_updated'
    socket.on('order:status_updated', (data: { orderId: string; status: string }) => {
      if (data.orderId === orderId) {
        setCurrentStatus(data.status);
        toast.info(`Order status: ${data.status.replace(/_/g, ' ')}`, { icon: '🍽️' });
        if (data.status === 'DELIVERED') {
          setShowRating(true);
        }
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [orderId]);

  // ── Loading skeleton ──────────────────────────────────────────────────────
  if (isLoading || !order) {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="max-w-lg mx-auto space-y-4">
          <div className="h-8 skeleton rounded-lg w-48" />
          <div className="h-40 skeleton rounded-2xl" />
          <div className="h-32 skeleton rounded-2xl" />
          <div className="h-48 skeleton rounded-2xl" />
        </div>
      </div>
    );
  }

  // ── Determine order type and steps ────────────────────────────────────────
  const isDeliveryOrder = Boolean(order.addressId || order.address);
  const steps = isDeliveryOrder ? DELIVERY_STEPS : DINE_IN_STEPS;
  const stepIndex = getStepIndex(currentStatus, steps);

  const themeColor = order.restaurant.themeColor ?? '#E85D04';
  const isCancelled = currentStatus === 'CANCELLED';
  const isCompleted  = currentStatus === 'DELIVERED';

  const completedLabel = isDeliveryOrder ? '✅ Order Delivered!' : '✅ Enjoy Your Meal!';
  const trackingLabel  = isDeliveryOrder ? '🛵 Tracking Your Delivery' : '🍽️ Tracking Your Order';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background pb-10">
      {/* Restaurant Header */}
      <div
        className="px-4 py-6"
        style={{ background: `linear-gradient(135deg, ${themeColor}15, ${themeColor}05)` }}
      >
        <div className="max-w-lg mx-auto">
          <p className="text-muted-foreground text-sm mb-1">
            Order #{order.id.slice(-8).toUpperCase()}
          </p>
          <h1 className="font-display text-2xl font-bold">{order.restaurant.name}</h1>

          {/* Dine-In: show table number */}
          {!isDeliveryOrder && order.tableNumber && (
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
              <Utensils className="w-3.5 h-3.5" />
              Table {order.tableNumber}
            </p>
          )}

          {/* Delivery: show delivery address */}
          {isDeliveryOrder && order.address && (
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" />
              {order.address.flat}, {order.address.street}, {order.address.city} –{' '}
              {order.address.pincode}
            </p>
          )}

          {/* Badge showing order type */}
          <span
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: `${themeColor}20`, color: themeColor }}
          >
            {isDeliveryOrder ? (
              <>
                <Bike className="w-3 h-3" /> Home Delivery
              </>
            ) : (
              <>
                <Utensils className="w-3 h-3" /> Dine-In
              </>
            )}
          </span>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 space-y-5">
        {/* Status tracker */}
        <div className="bg-card border border-border rounded-2xl p-5">
          <h2 className="font-display font-semibold mb-5">
            {isCancelled ? '❌ Order Cancelled' : isCompleted ? completedLabel : trackingLabel}
          </h2>

          {!isCancelled && (
            <div className="space-y-4">
              {steps.map((step, idx) => {
                const isStepCompleted = idx <= stepIndex;
                const isActive = idx === stepIndex;

                return (
                  <div key={step.key} className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all ${
                        isStepCompleted
                          ? 'text-white shadow-lg'
                          : 'bg-muted text-muted-foreground'
                      }`}
                      style={isStepCompleted ? { backgroundColor: themeColor } : {}}
                    >
                      {step.icon}
                    </div>

                    <div className="flex-1">
                      <p
                        className={`font-medium text-sm ${
                          isActive || isStepCompleted
                            ? 'text-foreground'
                            : 'text-muted-foreground'
                        }`}
                      >
                        {step.label}
                      </p>
                      {isActive && !isCompleted && (
                        <motion.p
                          animate={{ opacity: [1, 0.5, 1] }}
                          transition={{ repeat: Infinity, duration: 1.5 }}
                          className="text-xs"
                          style={{ color: themeColor }}
                        >
                          In progress...
                        </motion.p>
                      )}
                    </div>

                    {isStepCompleted && (
                      <CheckCircle2
                        className="w-4 h-4 flex-shrink-0"
                        style={{ color: themeColor }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Direct Payment Card */}
        {order.paymentStatus !== 'PAID' && order.paymentMethod === 'RAZORPAY' && (order.restaurant.paymentQrCode || order.restaurant.paymentUpiId || order.restaurant.paymentPhone || order.restaurant.bankAccountNumber) && (
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4 shadow-sm">
            <div className="flex items-center gap-2 border-b border-border pb-3">
              <CreditCard className="w-5 h-5 text-primary" style={{ color: themeColor }} />
              <h3 className="font-display font-semibold text-sm">Direct Payment Details</h3>
            </div>
            
            <p className="text-xs text-muted-foreground leading-relaxed">
              Please transfer the total amount of <strong className="text-foreground">₹{order.total.toFixed(2)}</strong> directly to the restaurant owner using the details below:
            </p>

            {order.restaurant.paymentQrCode && (
              <div className="flex flex-col items-center justify-center p-3 bg-white rounded-2xl border border-border max-w-[200px] mx-auto">
                <img
                  src={order.restaurant.paymentQrCode}
                  alt="Restaurant Payment QR"
                  className="w-40 h-40 object-contain"
                />
                <span className="text-[10px] text-gray-500 mt-1 font-semibold">Scan to Pay</span>
              </div>
            )}

            <div className="space-y-2.5 text-xs">
              {order.restaurant.paymentUpiId && (
                <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">UPI ID</span>
                    <span className="font-mono font-medium text-foreground">{order.restaurant.paymentUpiId}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(order.restaurant.paymentUpiId || '');
                      toast.success('UPI ID copied!');
                    }}
                    className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                    title="Copy UPI ID"
                    style={{ color: themeColor }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {order.restaurant.paymentPhone && (
                <div className="flex items-center justify-between p-2.5 bg-muted/40 rounded-xl">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Phone for Payment</span>
                    <span className="font-mono font-medium text-foreground">{order.restaurant.paymentPhone}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(order.restaurant.paymentPhone || '');
                      toast.success('Phone number copied!');
                    }}
                    className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                    title="Copy Phone"
                    style={{ color: themeColor }}
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {order.restaurant.bankAccountNumber && (
                <div className="p-3 bg-muted/20 border border-border/60 rounded-xl space-y-2">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold tracking-wider">Bank Account Details</span>
                  
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    {order.restaurant.bankAccountHolder && (
                      <div>
                        <span className="text-muted-foreground block">Holder Name</span>
                        <span className="font-medium text-foreground">{order.restaurant.bankAccountHolder}</span>
                      </div>
                    )}
                    {order.restaurant.bankName && (
                      <div>
                        <span className="text-muted-foreground block">Bank Name</span>
                        <span className="font-medium text-foreground">{order.restaurant.bankName}</span>
                      </div>
                    )}
                    <div className="col-span-2 flex items-center justify-between border-t border-border/50 pt-1.5 mt-1">
                      <div>
                        <span className="text-muted-foreground block">Account Number</span>
                        <span className="font-mono font-medium text-foreground">{order.restaurant.bankAccountNumber}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(order.restaurant.bankAccountNumber || '');
                          toast.success('Account number copied!');
                        }}
                        className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                        title="Copy Account Number"
                        style={{ color: themeColor }}
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {order.restaurant.bankIfsc && (
                      <div className="col-span-2 flex items-center justify-between border-t border-border/50 pt-1.5 mt-1">
                        <div>
                          <span className="text-muted-foreground block">IFSC Code</span>
                          <span className="font-mono font-medium text-foreground">{order.restaurant.bankIfsc}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(order.restaurant.bankIfsc || '');
                            toast.success('IFSC Code copied!');
                          }}
                          className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center justify-center"
                          title="Copy IFSC Code"
                          style={{ color: themeColor }}
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="p-3 rounded-xl text-[11px] leading-relaxed font-medium bg-muted/50 border border-border">
              Your order has been placed. Once you complete the payment, the restaurant owner will manually confirm and mark the order as PAID.
            </div>
          </div>
        )}

        {/* Order items */}
        <div className="bg-card border border-border rounded-2xl p-4">
          <h2 className="font-display font-semibold mb-3">Your Order</h2>
          <div className="space-y-2">
            {order.items.map((item) => (
              <div key={item.id} className="space-y-0.5 border-b border-border/50 pb-2 last:border-0 last:pb-0">
                <div className="flex justify-between text-sm">
                  <span>
                    {item.menuItem.name}
                    {item.variant && (
                      <span className="text-muted-foreground"> ({item.variant.name})</span>
                    )}
                    <span className="text-muted-foreground"> × {item.quantity}</span>
                  </span>
                  <span>₹{(item.unitPrice * item.quantity).toFixed(0)}</span>
                </div>
                {item.addOns && Array.isArray(item.addOns) && item.addOns.length > 0 && (
                  <div className="text-[11px] text-muted-foreground pl-2">
                    + {item.addOns.map((ao: any) => ao.name).join(', ')}
                  </div>
                )}
              </div>
            ))}
            <div className="border-t border-border pt-3 space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal</span>
                <span>₹{order.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>GST (18%)</span>
                <span>₹{order.gstAmount.toFixed(2)}</span>
              </div>
              {order.deliveryFee > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Delivery Fee</span>
                  <span>₹{order.deliveryFee.toFixed(2)}</span>
                </div>
              )}
              {order.packagingFee > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Packaging Fee</span>
                  <span>₹{order.packagingFee.toFixed(2)}</span>
                </div>
              )}
              {order.discount > 0 && (
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Discount</span>
                  <span>-₹{order.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-border pt-2">
                <span>Total Paid</span>
                <span>₹{order.total.toFixed(2)}</span>
              </div>
            </div>
            {!['DELIVERED', 'CANCELLED'].includes(order.status) && (
              <button
                onClick={handleAddMoreItems}
                className="w-full mt-3 py-2.5 px-4 border border-dashed rounded-xl text-xs font-semibold hover:bg-muted transition-colors flex items-center justify-center gap-1.5"
                style={{ color: themeColor, borderColor: themeColor }}
              >
                <span>➕ Add More Items (Roti, Paneer, etc.)</span>
              </button>
            )}
          </div>
        </div>

        {/* Rating — shown when order is completed */}
        {(showRating || isCompleted) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-2xl p-4"
          >
            <h2 className="font-display font-semibold mb-3">Rate Your Experience</h2>
            <div className="flex gap-2 justify-center mb-4">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  className="text-3xl transition-transform hover:scale-110"
                >
                  {star <= rating ? '⭐' : '☆'}
                </button>
              ))}
            </div>
            {rating > 0 && (
              <button
                className="w-full py-3 rounded-xl text-white font-semibold"
                style={{ backgroundColor: themeColor }}
                onClick={() => toast.success('Thanks for your feedback!')}
              >
                Submit Rating
              </button>
            )}
          </motion.div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <Link
              href={`/r/${restaurantSlug}`}
              className="flex-1 py-3 rounded-xl border border-border text-center text-sm font-semibold hover:bg-muted transition-colors flex items-center justify-center"
            >
              Back to Menu
            </Link>
            {isCompleted && (
              <button
                className="flex-1 py-3 rounded-xl text-white text-sm font-semibold flex items-center justify-center gap-2"
                style={{ backgroundColor: themeColor }}
              >
                <RotateCcw className="w-4 h-4" />
                Reorder
              </button>
            )}
          </div>
          {['CONFIRMED', 'PREPARING', 'BAKING', 'READY', 'ON_THE_WAY', 'DELIVERED'].includes(currentStatus) && (
            <InvoiceDownload order={order} themeColor={themeColor} />
          )}
        </div>
      </div>
    </div>
  );
}
