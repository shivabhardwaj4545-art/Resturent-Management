'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Plus, Check, ChevronRight, UtensilsCrossed } from 'lucide-react';
import { useCartStore } from '@/store/cart.store';
import { toast } from 'sonner';
import { getImageUrl } from '@/lib/image';

export interface UpsellItem {
  id: string;
  name: string;
  price: number;
  image: string | null;
  isVeg: boolean;
  categoryName?: string;
  description?: string | null;
}

interface UpsellModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProceedToCheckout: () => void;
  suggestedItems: UpsellItem[];
  themeColor?: string;
}

export function UpsellModal({
  isOpen,
  onClose,
  onProceedToCheckout,
  suggestedItems,
  themeColor = '#F48C06',
}: UpsellModalProps) {
  const { addItem, items: cartItems } = useCartStore();
  const [addingId, setAddingId] = useState<string | null>(null);

  // Filter out items already in cart or limit to 4
  const availableSuggestions = (suggestedItems || [])
    .filter((s) => !cartItems.some((ci) => ci.menuItemId === s.id))
    .slice(0, 4);

  // If modal opened but no suggestions available, proceed straight to checkout
  useEffect(() => {
    if (isOpen && availableSuggestions.length === 0) {
      onProceedToCheckout();
    }
  }, [isOpen, availableSuggestions.length, onProceedToCheckout]);

  if (!isOpen || availableSuggestions.length === 0) return null;

  const handleAdd = (item: UpsellItem) => {
    if (addingId === item.id) return;
    setAddingId(item.id);

    addItem({
      menuItemId: item.id,
      name: item.name,
      image: item.image,
      isVeg: item.isVeg,
      variantId: null,
      variantName: null,
      unitPrice: item.price,
      addOns: [],
      quantity: 1,
    });

    toast.success(`Added ${item.name} to cart! 🎉`);
    setTimeout(() => {
      setAddingId(null);
    }, 400);
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100000] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0"
        />

        <motion.div
          initial={{ y: 80, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 80, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg bg-card border border-border/80 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden z-10 max-h-[88vh] flex flex-col"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-border flex items-center justify-between bg-muted/20">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0"
                style={{ backgroundColor: themeColor }}
              >
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-display font-bold text-base sm:text-lg text-foreground flex items-center gap-1.5">
                  Complete Your Meal
                </h3>
                <p className="text-xs text-muted-foreground leading-tight">
                  Popular drinks, sides &amp; desserts paired with your order
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* List of Add-on / Upsell Items */}
          <div className="p-4 sm:p-5 space-y-3 overflow-y-auto max-h-[50vh] divide-y divide-border/40">
            {availableSuggestions.map((item) => {
              const inCart = cartItems.find((ci) => ci.menuItemId === item.id);
              const qty = inCart?.quantity ?? 0;

              return (
                <div
                  key={item.id}
                  className="pt-3 first:pt-0 flex items-center justify-between gap-3"
                >
                  {/* Item Image */}
                  <div className="relative w-16 h-16 sm:w-18 sm:h-18 rounded-xl overflow-hidden bg-muted border border-border/40 shrink-0">
                    {item.image ? (
                      <img
                        src={getImageUrl(item.image)}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-xl bg-primary/10">
                        {item.isVeg ? '🥗' : '🍗'}
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div
                        className={`w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 ${
                          item.isVeg ? 'border-green-500' : 'border-red-500'
                        }`}
                      >
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${
                            item.isVeg ? 'bg-green-500' : 'bg-red-500'
                          }`}
                        />
                      </div>
                      <h4 className="font-semibold text-sm text-foreground truncate">
                        {item.name}
                      </h4>
                    </div>
                    {item.description && (
                      <p className="text-[11px] text-muted-foreground line-clamp-1 mb-1">
                        {item.description}
                      </p>
                    )}
                    <span className="font-bold text-sm text-foreground">
                      ₹{item.price.toFixed(0)}
                    </span>
                  </div>

                  {/* Add / Added Button */}
                  <div className="shrink-0">
                    {qty > 0 ? (
                      <span className="px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-xs flex items-center gap-1 border border-emerald-500/30 min-h-[44px]">
                        <Check className="w-4 h-4" /> Added ({qty})
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAdd(item)}
                        disabled={addingId === item.id}
                        className="px-4 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm flex items-center gap-1 transition-all active:scale-95 disabled:opacity-50 min-h-[44px]"
                        style={{ backgroundColor: themeColor }}
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer Action Buttons */}
          <div className="p-4 sm:p-5 border-t border-border bg-muted/10 flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 px-4 rounded-xl border border-border font-semibold text-xs sm:text-sm hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-center min-h-[48px]"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={onProceedToCheckout}
              className="flex-[1.8] py-3.5 px-4 rounded-xl font-bold text-xs sm:text-sm text-white shadow-md transition-all flex items-center justify-center gap-1.5 active:scale-98 min-h-[48px]"
              style={{ background: `linear-gradient(135deg, ${themeColor}, #F48C06)` }}
            >
              <span>Continue to Checkout</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
