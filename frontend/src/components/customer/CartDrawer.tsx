'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShoppingBag, Minus, Plus, Trash2, ChevronRight, Loader2 } from 'lucide-react';
import { useCartStore } from '@/store/cart.store';
import { useAuthStore } from '@/store/auth.store';
import { useRouter } from 'next/navigation';
import { UpsellItem } from './UpsellModal';

const GST_RATE = 0.05;

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  restaurantSlug: string;
  tableNumber?: string;
  tableToken?: string;
  isTableVerified?: boolean;
  themeColor: string;
  suggestedItems?: UpsellItem[];
}

export function CartDrawer({ open, onClose, restaurantSlug, tableNumber, tableToken, isTableVerified, themeColor, suggestedItems = [] }: CartDrawerProps) {
  const { items, updateQuantity, removeItem, couponCode, couponDiscount, subtotal, gstAmount, total } = useCartStore();
  const { user } = useAuthStore();
  const router = useRouter();

  // Prevent background scrolling when cart drawer is open
  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      const originalTouchAction = document.body.style.touchAction;
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      return () => {
        document.body.style.overflow = originalOverflow;
        document.body.style.touchAction = originalTouchAction;
      };
    }
  }, [open]);

  const subtotalAmount = subtotal();
  const gst = gstAmount();
  const discount = couponDiscount;
  const grandTotal = Math.max(subtotalAmount + gst - discount, 0);

  const [navigating, setNavigating] = useState(false);

  // Prefetch the checkout route immediately so navigating to checkout is instant
  useEffect(() => {
    if (restaurantSlug) {
      router.prefetch(`/r/${restaurantSlug}/checkout`);
    }
  }, [restaurantSlug, router]);

  const handleCheckout = () => {
    if (navigating) return;
    setNavigating(true);

    const params = new URLSearchParams();
    const storedTable = typeof window !== 'undefined' ? localStorage.getItem(`table_num_${restaurantSlug}`) : null;
    const storedToken = typeof window !== 'undefined' ? localStorage.getItem(`table_token_${restaurantSlug}`) : null;

    const activeTable = tableNumber || storedTable;
    const activeToken = tableToken || storedToken;

    const activeOrderId = typeof window !== 'undefined'
      ? (localStorage.getItem(`active_table_order_id_${restaurantSlug}`) || localStorage.getItem('active_table_order_id'))
      : null;
    if (activeOrderId) {
      sessionStorage.setItem('qr_restaurant_addon_order_id', activeOrderId);
      sessionStorage.setItem('qr_restaurant_addon_order_num', activeOrderId.slice(-8).toUpperCase());
    }

    if (activeTable) params.set('table', activeTable);
    if (activeToken) params.set('t', activeToken);

    const queryString = params.toString();
    const targetUrl = `/r/${restaurantSlug}/checkout${queryString ? `?${queryString}` : ''}`;

    router.push(targetUrl);

    // Keep drawer open briefly during transition so the user doesn't see a momentary flash back to the menu screen
    setTimeout(() => {
      onClose();
      setNavigating(false);
    }, 120);
  };

  const handleProceedClick = () => {
    if (navigating) return;
    handleCheckout();
  };

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="cart-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[99998]"
            onClick={onClose}
            onTouchMove={(e) => e.preventDefault()}
          />
        )}
        {open && (
          <motion.div
            key="cart-drawer-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-background shadow-2xl z-[99999] flex flex-col border-l border-border opacity-100"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-background">
              <div className="flex items-center gap-2">
                <ShoppingBag className="w-5 h-5 text-primary" />
                <h2 className="font-display font-bold text-lg">Your Cart</h2>
                <span className="bg-primary text-primary-foreground text-xs font-bold px-2 py-0.5 rounded-full">
                  {items.reduce((sum, i) => sum + i.quantity, 0)}
                </span>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center hover:bg-muted/80 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-4 space-y-3 scrollbar-thin">
              {items.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center py-16">
                  <ShoppingBag className="w-16 h-16 text-muted-foreground/30 mb-4" />
                  <h3 className="font-display font-semibold text-lg mb-2">Your cart is empty</h3>
                  <p className="text-muted-foreground text-sm">Add items from the menu to get started</p>
                </div>
              ) : (
                <>
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3 bg-muted/30 rounded-xl p-3">
                      <div className={`w-3 h-3 flex-shrink-0 rounded border-2 ${item.isVeg ? 'border-green-500' : 'border-red-500'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full m-0.5 ${item.isVeg ? 'bg-green-500' : 'bg-red-500'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm line-clamp-1">{item.name}</p>
                        {item.variantName && (
                          <p className="text-xs text-muted-foreground">{item.variantName}</p>
                        )}
                        {item.addOns.length > 0 && (
                          <p className="text-xs text-muted-foreground">{item.addOns.map((ao) => ao.name).join(', ')}</p>
                        )}
                        <p className="text-sm font-bold mt-0.5">₹{((item.unitPrice + item.addOns.reduce((s, ao) => s + ao.price, 0)) * item.quantity).toFixed(0)}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 rounded-lg border border-border">
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity - 1)}
                            className="p-1.5 hover:bg-muted rounded-l-lg transition-colors"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-6 text-center text-sm font-semibold">{item.quantity}</span>
                          <button
                            onClick={() => updateQuantity(item.id, item.quantity + 1)}
                            className="p-1.5 hover:bg-muted rounded-r-lg transition-colors"
                            style={{ color: themeColor }}
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="p-1.5 text-muted-foreground hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Bill Summary & Proceed */}
            {items.length > 0 && (
              <div className="border-t border-border p-4 space-y-4">
                {/* Bill Summary */}
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span>₹{subtotalAmount.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST (5%)</span>
                    <span>₹{gst.toFixed(2)}</span>
                  </div>

                  {discount > 0 && (
                    <div className="flex justify-between text-green-600 font-medium">
                      <span>Coupon discount ({couponCode})</span>
                      <span>-₹{discount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="border-t border-border pt-2 flex justify-between font-bold text-base">
                    <span>Total</span>
                    <span>₹{grandTotal.toFixed(2)}</span>
                  </div>
                </div>

                <button
                  onClick={handleProceedClick}
                  disabled={navigating}
                  className="w-full py-4 rounded-2xl text-white font-bold text-base flex items-center justify-between px-5 shadow-lg active:scale-98 transition-all hover:opacity-95 disabled:opacity-90 cursor-pointer min-h-[52px]"
                  style={{ background: `linear-gradient(135deg, ${themeColor}, #F48C06)` }}
                >
                  <div className="flex items-center gap-2">
                    {navigating && <Loader2 className="w-4 h-4 animate-spin text-white" />}
                    <span>{navigating ? 'Opening Checkout...' : 'Proceed to Checkout'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span>₹{grandTotal.toFixed(2)}</span>
                    <ChevronRight className="w-5 h-5" />
                  </div>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
