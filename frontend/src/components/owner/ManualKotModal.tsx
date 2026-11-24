'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Printer, X, Plus, Minus, Trash2, Utensils, Search } from 'lucide-react';
import api from '@/services/api';
import { toast } from 'sonner';
import { printKitchenOrderTicket } from '@/utils/kotPrint';

function getFoodFallbackImage(image?: string | null, name: string = '', isVeg: boolean = true): string {
  if (image && image.trim().length > 0) return image;
  const lower = name.toLowerCase();
  if (lower.includes('paneer')) return 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('chicken') || lower.includes('meat') || lower.includes('mutton') || lower.includes('fish') || lower.includes('egg') || lower.includes('tikka') || lower.includes('kebab')) return 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('naan') || lower.includes('roti') || lower.includes('bread') || lower.includes('paratha') || lower.includes('kulcha')) return 'https://images.unsplash.com/photo-1626074353765-517a681e40be?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('biryani') || lower.includes('rice') || lower.includes('pulao') || lower.includes('fried rice')) return 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('jamun') || lower.includes('dessert') || lower.includes('sweet') || lower.includes('ice cream') || lower.includes('cake') || lower.includes('halwa')) return 'https://images.unsplash.com/photo-1601050690597-df0568f70950?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('lassi') || lower.includes('drink') || lower.includes('mango') || lower.includes('tea') || lower.includes('chai') || lower.includes('coffee') || lower.includes('shake') || lower.includes('juice') || lower.includes('beverage') || lower.includes('mojito') || lower.includes('soda') || lower.includes('cola')) return 'https://images.unsplash.com/photo-1546173159-315724a31696?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('pizza')) return 'https://images.unsplash.com/photo-1513104890138-7c749659a591?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('burger')) return 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('fries') || lower.includes('finger') || lower.includes('french fries')) return 'https://images.unsplash.com/photo-1576107232684-1279f3908594?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('dal') || lower.includes('curry') || lower.includes('gravy') || lower.includes('chole') || lower.includes('rajma') || lower.includes('soup')) return 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('noodle') || lower.includes('chowmein') || lower.includes('manchurian') || lower.includes('pasta')) return 'https://images.unsplash.com/photo-1612927601601-6638404737ce?q=80&w=800&auto=format&fit=crop';
  if (lower.includes('chaat') || lower.includes('tikki') || lower.includes('roll') || lower.includes('wrap') || lower.includes('sandwich') || lower.includes('momos') || lower.includes('samosa')) return 'https://images.unsplash.com/photo-1606471191009-63994c53433b?q=80&w=800&auto=format&fit=crop';
  return isVeg
    ? 'https://images.unsplash.com/photo-1540420773420-3366772f4999?q=80&w=800&auto=format&fit=crop'
    : 'https://images.unsplash.com/photo-1626777552726-4a6b54c97e46?q=80&w=800&auto=format&fit=crop';
}

interface MenuItem {
  id: string;
  name: string;
  price: number;
  isAvailable: boolean;
  image?: string | null;
  isVeg?: boolean;
  category?: { name: string } | null;
  variants?: Array<{ id: string; name: string; price: number }>;
}

interface SelectedItem {
  menuItemId: string;
  name: string;
  image?: string | null;
  isVeg?: boolean;
  variantId?: string | null;
  variantName?: string | null;
  unitPrice: number;
  quantity: number;
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
  const [kitchenNotes, setKitchenNotes] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([]);
  // Track selected portion per menuItemId (variantId or 'full')
  const [selectedPortions, setSelectedPortions] = useState<Record<string, string>>({});

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

  // Fetch Active Table Sessions
  const { data: sessionsData } = useQuery({
    queryKey: ['owner-active-sessions-for-kot'],
    queryFn: async () => {
      const res = await api.get('/table-sessions');
      return (res.data?.data?.sessions || []) as Array<{
        id: string;
        tableNumber: string;
        status: string;
      }>;
    },
    enabled: isOpen,
    staleTime: 15 * 1000,
  });

  const activeTables = useMemo(
    () => (sessionsData || []).filter((s) => s.status === 'ACTIVE').map((s) => s.tableNumber),
    [sessionsData]
  );

  // Extract all categories
  const categories = useMemo(() => {
    if (!menuData) return [];
    const set = new Set<string>();
    menuData.forEach((m) => {
      if (m.isAvailable !== false) {
        set.add(m.category?.name || 'Other');
      }
    });
    return Array.from(set);
  }, [menuData]);

  // Group items by category with filters
  const groupedMenu = useMemo(() => {
    if (!menuData) return [];
    const available = menuData.filter((m) => m.isAvailable !== false);
    const q = searchQuery.toLowerCase().trim();
    
    let filtered = available;
    if (q) {
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.category?.name && m.category.name.toLowerCase().includes(q))
      );
    }
    if (selectedCategory !== 'ALL') {
      filtered = filtered.filter((m) => (m.category?.name || 'Other') === selectedCategory);
    }

    const map = new Map<string, MenuItem[]>();
    for (const item of filtered) {
      const cat = item.category?.name || 'Other';
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(item);
    }
    return Array.from(map.entries()).map(([cat, items]) => ({ cat, items }));
  }, [menuData, searchQuery, selectedCategory]);

  // Get the currently selected portion for a menu item (defaults to Full)
  const getPortionKey = (item: MenuItem): { variantId: string | null; variantName: string | null; price: number } => {
    const sel = selectedPortions[item.id];
    if (!sel || sel === 'full' || !item.variants?.length) {
      return { variantId: null, variantName: item.variants?.length ? 'Full' : null, price: item.price };
    }
    const v = item.variants?.find((vr) => vr.id === sel);
    if (!v) return { variantId: null, variantName: null, price: item.price };
    return { variantId: v.id, variantName: v.name, price: v.price };
  };

  const getItemCartQty = (itemId: string, variantId?: string | null) => {
    const found = selectedItems.find(
      (p) => p.menuItemId === itemId && (p.variantId || null) === (variantId || null)
    );
    return found ? found.quantity : 0;
  };

  const handleAddItem = (item: MenuItem) => {
    const portion = getPortionKey(item);

    setSelectedItems((prev) => {
      const existingIdx = prev.findIndex(
        (p) => p.menuItemId === item.id && (p.variantId || null) === (portion.variantId || null)
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
          image: item.image,
          isVeg: item.isVeg,
          variantId: portion.variantId,
          variantName: portion.variantName,
          unitPrice: portion.price,
          quantity: 1,
        },
      ];
    });
  };

  const handleDecrementItem = (item: MenuItem) => {
    const portion = getPortionKey(item);
    setSelectedItems((prev) => {
      const existingIdx = prev.findIndex(
        (p) => p.menuItemId === item.id && (p.variantId || null) === (portion.variantId || null)
      );
      if (existingIdx === -1) return prev;
      const copy = [...prev];
      if (copy[existingIdx].quantity <= 1) {
        return copy.filter((_, i) => i !== existingIdx);
      }
      copy[existingIdx].quantity -= 1;
      return copy;
    });
  };

  const handleUpdateQty = (index: number, delta: number) => {
    setSelectedItems((prev) => {
      const copy = [...prev];
      const newQty = copy[index].quantity + delta;
      if (newQty <= 0) return copy.filter((_, i) => i !== index);
      copy[index].quantity = newQty;
      return copy;
    });
  };

  const handleRemoveItem = (index: number) => {
    setSelectedItems((prev) => prev.filter((_, i) => i !== index));
  };

  const totalQty = selectedItems.reduce((a, i) => a + i.quantity, 0);
  const subtotal = selectedItems.reduce((a, i) => a + i.unitPrice * i.quantity, 0);

  // Mutation to create manual order & print
  const manualKotMutation = useMutation({
    mutationFn: async () => {
      if (!tableNumber.trim()) throw new Error('Please enter a table number.');
      if (selectedItems.length === 0) throw new Error('Please select at least one item.');

      const cleanTable = tableNumber.trim().toLowerCase().startsWith('table') || tableNumber.trim().toLowerCase().startsWith('room')
        ? tableNumber.trim()
        : `Table ${tableNumber.trim()}`;

      const payload = {
        tableNumber: cleanTable,
        guestName: 'Walk-in Customer',
        notes: kitchenNotes.trim() || undefined,
        items: selectedItems.map((item) => ({
          menuItemId: item.menuItemId,
          variantId: item.variantId || undefined,
          quantity: item.quantity,
        })),
      };

      const res = await api.post('/owner/orders/manual', payload);
      return res.data?.data?.order;
    },
    onSuccess: (createdOrder) => {
      toast.success(`KOT created for Table ${tableNumber}!`);
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
        console.error('KOT print failed:', err);
      }
      queryClient.invalidateQueries({ queryKey: ['owner-orders'] });
      queryClient.invalidateQueries({ queryKey: ['owner-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['table-sessions'] });
      setSelectedItems([]);
      setKitchenNotes('');
      setSelectedPortions({});
      onClose();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || err?.message || 'Failed to create KOT');
    },
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-card border border-border rounded-none sm:rounded-2xl w-full sm:max-w-4xl flex flex-col max-h-screen sm:max-h-[92vh] shadow-2xl overflow-hidden">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0 bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-orange-500/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-orange-500 flex items-center justify-center shadow-sm">
              <Printer className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-base text-foreground leading-tight">New Manual KOT</h2>
              <p className="text-[11px] text-muted-foreground">Select items with pictures & portions → Print KOT</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-muted transition-colors cursor-pointer text-muted-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Table Number Bar ── */}
        <div className="px-4 py-2.5 border-b border-border shrink-0 bg-muted/30">
          <div className="flex items-center gap-2.5 sm:gap-4 flex-wrap sm:flex-nowrap">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-foreground whitespace-nowrap">🍽️ Table / Room:</span>
              <input
                type="text"
                value={tableNumber}
                onChange={(e) => setTableNumber(e.target.value)}
                placeholder="e.g. 5"
                className="w-24 sm:w-28 px-3 py-1.5 text-sm font-bold text-center rounded-xl bg-background border-2 border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-400/50"
              />
            </div>

            {/* Active running tables chips */}
            {activeTables.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-full">
                <span className="text-[10px] font-bold text-muted-foreground uppercase whitespace-nowrap">Active:</span>
                {activeTables.slice(0, 8).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTableNumber(t)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-all cursor-pointer whitespace-nowrap ${
                      tableNumber.trim() === t.trim()
                        ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                        : 'bg-muted/70 text-foreground border-border hover:border-orange-400'
                    }`}
                  >
                    Table {t}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Body: Menu (left) + Order Summary (right) ── */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">

          {/* ── Left: Menu ── */}
          <div className="flex-1 min-h-0 flex flex-col border-r border-border overflow-hidden">
            {/* Search + Category Filter Bar */}
            <div className="p-2.5 border-b border-border shrink-0 space-y-2 bg-muted/15">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search dish by name or category..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-background border border-border focus:outline-none focus:ring-2 focus:ring-orange-400/50"
                />
              </div>

              {/* Category tabs */}
              {categories.length > 0 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setSelectedCategory('ALL')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                      selectedCategory === 'ALL'
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'bg-muted text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    All Items
                  </button>
                  {categories.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedCategory(c)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                        selectedCategory === c
                          ? 'bg-orange-500 text-white shadow-xs'
                          : 'bg-muted text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Menu Item Cards List */}
            <div className="flex-1 overflow-y-auto divide-y divide-border/50">
              {isMenuLoading ? (
                <div className="py-16 text-center text-muted-foreground space-y-2">
                  <div className="w-6 h-6 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs font-semibold">Loading menu items...</p>
                </div>
              ) : groupedMenu.length === 0 ? (
                <div className="py-16 text-center text-muted-foreground">
                  <Utensils className="w-8 h-8 opacity-30 mx-auto mb-2" />
                  <p className="text-xs font-semibold">No items match your search</p>
                </div>
              ) : (
                groupedMenu.map(({ cat, items }) => (
                  <div key={cat}>
                    {/* Category sticky subheader */}
                    <div className="px-3.5 py-1.5 bg-muted/60 border-b border-border/60 sticky top-0 z-10 backdrop-blur-xs flex items-center justify-between">
                      <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{cat}</span>
                      <span className="text-[10px] font-bold text-muted-foreground">{items.length} items</span>
                    </div>

                    {/* Dish rows */}
                    {items.map((item) => {
                      const hasVariants = Boolean(item.variants && item.variants.length > 0);
                      const selPortion = selectedPortions[item.id] || 'full';
                      const currentPortion = getPortionKey(item);
                      const inCartQty = getItemCartQty(item.id, currentPortion.variantId);
                      const foodImg = getFoodFallbackImage(item.image, item.name, item.isVeg ?? true);

                      return (
                        <div
                          key={item.id}
                          className="flex items-center p-3 hover:bg-muted/30 transition-colors gap-3 border-b border-border/30 last:border-b-0"
                        >
                          {/* Dish Image Thumbnail */}
                          <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden shrink-0 bg-muted border border-border/70 shadow-2xs">
                            <img
                              src={foodImg}
                              alt={item.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = getFoodFallbackImage(null, item.name, item.isVeg ?? true);
                              }}
                            />
                            {item.isVeg !== undefined && (
                              <span
                                className={`absolute top-1 left-1 w-3 h-3 rounded-full border-2 border-white shadow-xs ${
                                  item.isVeg ? 'bg-emerald-500' : 'bg-rose-500'
                                }`}
                                title={item.isVeg ? 'Vegetarian' : 'Non-Vegetarian'}
                              />
                            )}
                          </div>

                          {/* Dish Name + Price + Portion Selectors */}
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-baseline justify-between gap-2">
                              <h3 className="font-bold text-sm text-foreground leading-tight truncate">
                                {item.name}
                              </h3>
                              <span className="font-black text-sm text-orange-600 dark:text-orange-400 shrink-0">
                                ₹{currentPortion.price}
                              </span>
                            </div>

                            {/* Portion selector chips (Default is Full) */}
                            {hasVariants ? (
                              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                                <span className="text-[10px] font-bold text-muted-foreground uppercase">Portion:</span>
                                <button
                                  type="button"
                                  onClick={() => setSelectedPortions((p) => ({ ...p, [item.id]: 'full' }))}
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
                                    selPortion === 'full'
                                      ? 'bg-orange-500 text-white border-orange-500 shadow-2xs'
                                      : 'bg-muted/80 text-foreground border-border hover:border-orange-400'
                                  }`}
                                >
                                  Full (₹{item.price})
                                </button>
                                {item.variants!.map((v) => (
                                  <button
                                    key={v.id}
                                    type="button"
                                    onClick={() => setSelectedPortions((p) => ({ ...p, [item.id]: v.id }))}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
                                      selPortion === v.id
                                        ? 'bg-orange-500 text-white border-orange-500 shadow-2xs'
                                        : 'bg-muted/80 text-foreground border-border hover:border-orange-400'
                                    }`}
                                  >
                                    {v.name} (₹{v.price})
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px] text-muted-foreground">Standard Portion</p>
                            )}
                          </div>

                          {/* Quick Add / Qty Controls */}
                          <div className="shrink-0 flex items-center">
                            {inCartQty > 0 ? (
                              <div className="flex items-center gap-1 bg-orange-500/10 border border-orange-500/30 rounded-xl p-1">
                                <button
                                  type="button"
                                  onClick={() => handleDecrementItem(item)}
                                  className="w-6 h-6 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors cursor-pointer"
                                  title="Decrease quantity"
                                >
                                  <Minus className="w-3 h-3" />
                                </button>
                                <span className="w-5 text-center text-xs font-black text-orange-600 dark:text-orange-400">
                                  {inCartQty}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleAddItem(item)}
                                  className="w-6 h-6 rounded-lg bg-orange-500 text-white flex items-center justify-center hover:bg-orange-600 transition-colors cursor-pointer"
                                  title="Add one more"
                                >
                                  <Plus className="w-3 h-3" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleAddItem(item)}
                                className="px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs"
                              >
                                <Plus className="w-3.5 h-3.5" />
                                Add
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* ── Right: Order Summary ── */}
          <div className="w-full md:w-72 shrink-0 flex flex-col border-t md:border-t-0 border-border max-h-72 md:max-h-full bg-muted/10">
            {/* Order header */}
            <div className="flex items-center justify-between px-3.5 py-3 border-b border-border shrink-0 bg-muted/30">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-black text-foreground">Current KOT</span>
                {totalQty > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-black bg-orange-500 text-white">
                    {totalQty}
                  </span>
                )}
              </div>
              {selectedItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedItems([])}
                  className="text-[11px] font-semibold text-red-500 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              )}
            </div>

            {/* Selected Items List */}
            <div className="flex-1 overflow-y-auto divide-y divide-border/50 min-h-0">
              {selectedItems.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-6 text-muted-foreground">
                  <Utensils className="w-8 h-8 opacity-25 mb-2" />
                  <p className="text-xs font-bold text-foreground">No items added</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Click + Add next to any dish</p>
                </div>
              ) : (
                selectedItems.map((item, idx) => {
                  const itemImg = getFoodFallbackImage(item.image, item.name, item.isVeg ?? true);
                  return (
                    <div key={`${item.menuItemId}-${item.variantId || 'base'}`} className="p-2.5 flex items-center gap-2.5">
                      {/* Mini Thumbnail */}
                      <img
                        src={itemImg}
                        alt={item.name}
                        className="w-10 h-10 rounded-lg object-cover shrink-0 border border-border/60 bg-muted"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = getFoodFallbackImage(null, item.name, item.isVeg ?? true);
                        }}
                      />

                      {/* Item Details */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-foreground truncate leading-tight">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {item.variantName ? (
                            <span className="text-orange-600 dark:text-orange-400 font-semibold">{item.variantName} • </span>
                          ) : null}
                          ₹{item.unitPrice} each
                        </p>
                      </div>

                      {/* Qty Stepper */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(idx, -1)}
                          className="w-5 h-5 rounded-md bg-muted flex items-center justify-center hover:bg-muted/80 text-foreground cursor-pointer"
                        >
                          <Minus className="w-2.5 h-2.5" />
                        </button>
                        <span className="w-4 text-center text-xs font-black">{item.quantity}</span>
                        <button
                          type="button"
                          onClick={() => handleUpdateQty(idx, 1)}
                          className="w-5 h-5 rounded-md bg-muted flex items-center justify-center hover:bg-muted/80 text-foreground cursor-pointer"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                      </div>

                      {/* Price & Delete */}
                      <div className="text-right shrink-0 flex items-center gap-1">
                        <span className="text-xs font-bold text-foreground">
                          ₹{item.unitPrice * item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="p-1 text-muted-foreground hover:text-red-500 cursor-pointer"
                          title="Remove item"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Total + Kitchen Note + Print Button */}
            <div className="border-t border-border p-3 space-y-2.5 shrink-0 bg-background/80">
              {selectedItems.length > 0 && (
                <div className="flex justify-between items-center text-xs font-bold">
                  <span className="text-muted-foreground">Total:</span>
                  <span className="text-sm font-black text-foreground">₹{subtotal.toFixed(0)}</span>
                </div>
              )}

              {/* Kitchen Instructions input */}
              <input
                type="text"
                value={kitchenNotes}
                onChange={(e) => setKitchenNotes(e.target.value)}
                placeholder="Kitchen note (e.g. less spicy)..."
                className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-muted/40 border border-border focus:outline-none focus:ring-1 focus:ring-orange-400"
              />

              {/* Submit & Print */}
              <button
                type="button"
                onClick={() => manualKotMutation.mutate()}
                disabled={manualKotMutation.isPending || selectedItems.length === 0 || !tableNumber.trim()}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 disabled:opacity-40 text-white font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <Printer className="w-4 h-4" />
                <span>{manualKotMutation.isPending ? 'Printing...' : 'Create & Print KOT'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
