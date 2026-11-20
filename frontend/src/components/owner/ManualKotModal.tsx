'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Printer,
  X,
  Search,
  Plus,
  Minus,
  Trash2,
  Utensils,
  Receipt,
  FileText,
  AlertCircle,
  Check,
} from 'lucide-react';
import api from '@/services/api';
import { toast } from 'sonner';
import { printKitchenOrderTicket } from '@/utils/kotPrint';

interface MenuItem {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  category?: { name: string } | null;
  variants?: Array<{ id: string; name: string; price: number }>;
}

interface SelectedItem {
  menuItemId: string;
  name: string;
  variantId?: string | null;
  variantName?: string | null;
  unitPrice: number;
  quantity: number;
  notes?: string;
}

interface ManualKotModalProps {
  isOpen: boolean;
  onClose: () => void;
  restaurantName?: string;
  initialTable?: string;
}

export function ManualKotModal({
  isOpen,
  onClose,
  restaurantName = 'RESTAURANT',
  initialTable = '',
}: ManualKotModalProps) {
  const queryClient = useQueryClient();

  const [tableNumber, setTableNumber] = useState(initialTable);
  const [guestName, setGuestName] = useState('Walk-in Customer');
  const [kitchenNotes, setKitchenNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);

  // Fetch Menu Items
  const { data: menuData, isLoading: isMenuLoading } = useQuery({
    queryKey: ['owner-menu-items-for-kot'],
    queryFn: async () => {
      const res = await api.get('/owner/menu/items');
      return (res.data?.data?.items || []) as MenuItem[];
    },
    enabled: isOpen,
    staleTime: 60 * 1000,
  });

  // Fetch Active Table Sessions for quick select
  const { data: sessionsData } = useQuery({
    queryKey: ['owner-active-sessions-for-kot'],
    queryFn: async () => {
      const res = await api.get('/table-sessions');
      return (res.data?.data?.sessions || []) as Array<{
        id: string;
        tableNumber: string;
        sessionCode: string;
        totalAmount: number;
        status: string;
      }>;
    },
    enabled: isOpen,
    staleTime: 15 * 1000,
  });

  const activeSessions = useMemo(() => {
    return (sessionsData || []).filter((s) => s.status === 'ACTIVE');
  }, [sessionsData]);

  // Filter menu items by search query
  const filteredMenuItems = useMemo(() => {
    if (!menuData) return [];
    if (!searchQuery.trim()) return menuData.slice(0, 30);
    const q = searchQuery.toLowerCase();
    return menuData.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.category?.name && m.category.name.toLowerCase().includes(q))
    );
  }, [menuData, searchQuery]);

  // Add Item to Order
  const handleAddItem = (item: MenuItem, variantId?: string) => {
    let unitPrice = item.price;
    let variantName: string | null = null;

    if (variantId && item.variants) {
      const v = item.variants.find((vr) => vr.id === variantId);
      if (v) {
        unitPrice = v.price;
        variantName = v.name;
      }
    }

    setSelectedItems((prev) => {
      const existingIdx = prev.findIndex(
        (p) => p.menuItemId === item.id && (p.variantId || null) === (variantId || null)
      );

      if (existingIdx !== -1) {
        const copy = [...prev];
        copy[existingIdx].quantity += 1;
        return copy;
      }

      return [
        ...prev,
        {
          menuItemId: item.id,
          name: item.name,
          variantId: variantId || null,
          variantName,
          unitPrice,
          quantity: 1,
        },
      ];
    });
  };

  const handleUpdateQty = (index: number, delta: number) => {
    setSelectedItems((prev) => {
      const copy = [...prev];
      const newQty = copy[index].quantity + delta;
      if (newQty <= 0) {
        return copy.filter((_, i) => i !== index);
      }
      copy[index].quantity = newQty;
      return copy;
    });
  };

  const handleRemoveItem = (index: number) => {
    setSelectedItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Calculations
  const subtotal = selectedItems.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
  const gstAmount = subtotal * 0.05; // 5% GST
  const total = subtotal + gstAmount;

  // Mutation to Create Manual Order & Print KOT
  const manualKotMutation = useMutation({
    mutationFn: async () => {
      if (!tableNumber.trim()) {
        throw new Error('Please enter or select a table number.');
      }
      if (selectedItems.length === 0) {
        throw new Error('Please select at least one item.');
      }

      const payload = {
        tableNumber: tableNumber.trim(),
        guestName: guestName.trim() || 'Manual Counter Order',
        notes: kitchenNotes.trim() || undefined,
        items: selectedItems.map((item) => ({
          menuItemId: item.menuItemId,
          variantId: item.variantId || undefined,
          quantity: item.quantity,
          notes: item.notes,
        })),
      };

      const res = await api.post('/owner/orders/manual', payload);
      return res.data?.data?.order;
    },
    onSuccess: (createdOrder) => {
      toast.success(`Manual KOT generated for Table ${tableNumber}!`);

      // Print physical thermal KOT ticket
      try {
        printKitchenOrderTicket({
          order: {
            ...createdOrder,
            notes: kitchenNotes || createdOrder?.notes,
            orderSource: 'MANUAL',
          },
          restaurantName,
          orderSource: 'MANUAL',
        });
      } catch (err) {
        console.error('Failed to auto-print KOT:', err);
      }

      // Invalidate queries so dashboard, orders, and table sessions refresh immediately
      queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['owner-recent-orders'] });
      queryClient.invalidateQueries({ queryKey: ['table-sessions'] });

      // Reset and close
      setSelectedItems([]);
      setKitchenNotes('');
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to create manual KOT');
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-sm overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="bg-card border border-border rounded-2xl max-w-4xl w-full p-4 sm:p-6 shadow-2xl flex flex-col max-h-[92vh] overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-400 flex items-center justify-center">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-base sm:text-lg text-foreground">
                + New Manual KOT
              </h2>
              <p className="text-xs text-muted-foreground">
                Fast Cashier Entry • Directly Accepted • Prints Kitchen Ticket
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-muted-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body: Split Layout */}
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-12 gap-4 py-4 overflow-y-auto">
          {/* Left Column: Table & Menu Selection (7 cols) */}
          <div className="md:col-span-7 flex flex-col space-y-3.5 min-h-0">
            {/* Table Number & Guest Name Row */}
            <div className="grid grid-cols-2 gap-2.5 shrink-0">
              <div>
                <label className="text-xs font-bold text-foreground mb-1 block">
                  Table / Room Number *
                </label>
                <input
                  type="text"
                  value={tableNumber}
                  onChange={(e) => setTableNumber(e.target.value)}
                  placeholder="e.g. 5 or Room 102"
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-muted/40 border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-foreground mb-1 block">
                  Guest Reference
                </label>
                <input
                  type="text"
                  value={guestName}
                  onChange={(e) => setGuestName(e.target.value)}
                  placeholder="e.g. Counter Guest"
                  className="w-full px-3 py-2 text-xs font-semibold rounded-xl bg-muted/40 border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>
            </div>

            {/* Active Sessions Quick-select chips */}
            {activeSessions.length > 0 && (
              <div className="shrink-0">
                <span className="text-[11px] font-bold text-muted-foreground block mb-1">
                  Active Running Tables (Click to select):
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-16 overflow-y-auto">
                  {activeSessions.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setTableNumber(s.tableNumber)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all border cursor-pointer ${
                        tableNumber.trim().toLowerCase() === s.tableNumber.trim().toLowerCase()
                          ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                          : 'bg-muted/50 text-foreground border-border hover:bg-muted'
                      }`}
                    >
                      {s.tableNumber} (Running ₹{s.totalAmount})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Menu Items Search */}
            <div className="relative shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search dish name or category..."
                className="w-full pl-9 pr-3 py-2 text-xs font-medium rounded-xl bg-muted/40 border border-border focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {/* Dishes List */}
            <div className="flex-1 min-h-[180px] overflow-y-auto space-y-1.5 pr-1 border border-border/60 rounded-xl p-2 bg-muted/10">
              {isMenuLoading ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  Loading menu items...
                </p>
              ) : filteredMenuItems.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">
                  No matching dishes found.
                </p>
              ) : (
                filteredMenuItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-2.5 rounded-xl border border-border/60 bg-card hover:bg-muted/40 transition-colors flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="font-bold text-xs text-foreground truncate">
                        {item.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        ₹{item.price}{' '}
                        {item.category?.name ? `• ${item.category.name}` : ''}
                      </p>
                    </div>

                    {/* If item has variants */}
                    {item.variants && item.variants.length > 0 ? (
                      <div className="flex items-center gap-1 shrink-0">
                        {item.variants.map((v) => (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => handleAddItem(item, v.id)}
                            className="px-2 py-1 rounded-lg bg-primary/10 hover:bg-primary text-primary hover:text-primary-foreground text-[11px] font-bold transition-all cursor-pointer"
                          >
                            +{v.name} (₹{v.price})
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleAddItem(item)}
                        className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity cursor-pointer shrink-0 flex items-center gap-1 shadow-2xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Add
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Column: Selected Items Summary (5 cols) */}
          <div className="md:col-span-5 flex flex-col border border-border rounded-xl p-3.5 bg-muted/15 min-h-0">
            <div className="flex items-center justify-between pb-2 border-b border-border shrink-0">
              <span className="font-bold text-xs text-foreground">
                KOT Items ({selectedItems.length})
              </span>
              {selectedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedItems([])}
                  className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>

            {/* Selected Items List */}
            <div className="flex-1 min-h-[140px] overflow-y-auto space-y-2 py-2 pr-1">
              {selectedItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center py-6 text-muted-foreground">
                  <Utensils className="w-8 h-8 opacity-40 mb-1" />
                  <p className="text-xs font-semibold">No items selected</p>
                  <p className="text-[10px]">Select items from the menu to build the KOT ticket.</p>
                </div>
              ) : (
                selectedItems.map((item, idx) => (
                  <div
                    key={`${item.menuItemId}-${item.variantId || 'base'}`}
                    className="p-2 rounded-xl bg-card border border-border/80 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold truncate max-w-[140px]">
                        {item.name}
                        {item.variantName ? ` (${item.variantName})` : ''}
                      </span>
                      <span className="font-bold text-foreground">
                        ₹{item.unitPrice * item.quantity}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(idx, -1)}
                          className="w-5 h-5 rounded-md bg-muted flex items-center justify-center hover:bg-muted/80 cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-bold px-1.5">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(idx, 1)}
                          className="w-5 h-5 rounded-md bg-muted flex items-center justify-center hover:bg-muted/80 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveItem(idx)}
                        className="text-red-500 hover:text-red-700 p-1 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Kitchen Instructions */}
            <div className="pt-2 border-t border-border shrink-0">
              <label className="text-[11px] font-bold text-muted-foreground block mb-1">
                Kitchen Instructions (Printed on ticket):
              </label>
              <input
                type="text"
                value={kitchenNotes}
                onChange={(e) => setKitchenNotes(e.target.value)}
                placeholder="e.g. Less spicy, make it fast"
                className="w-full px-3 py-1.5 text-xs rounded-xl bg-card border border-border focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Totals */}
            <div className="pt-2.5 mt-2 border-t border-border text-xs space-y-1 shrink-0">
              <div className="flex justify-between text-muted-foreground">
                <span>Subtotal:</span>
                <span className="font-semibold text-foreground">₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>GST (5%):</span>
                <span className="font-semibold text-foreground">₹{gstAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-extrabold text-sm text-foreground pt-1 border-t border-border/60">
                <span>Total Amount:</span>
                <span className="text-primary font-black">₹{total.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-border hover:bg-muted text-foreground transition-all cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => manualKotMutation.mutate()}
            disabled={manualKotMutation.isPending || selectedItems.length === 0 || !tableNumber.trim()}
            className="px-5 py-2.5 text-xs font-bold rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white transition-all flex items-center gap-2 shadow-md disabled:opacity-50 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>
              {manualKotMutation.isPending ? 'Generating & Printing...' : 'Save & Print KOT'}
            </span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
