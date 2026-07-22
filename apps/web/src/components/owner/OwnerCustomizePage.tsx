'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Palette, GripVertical, Plus, Trash2, Save, Sparkles, LayoutDashboard,
  UtensilsCrossed, ShoppingBag, Tag, BarChart3, Settings, LogOut, Menu,
  Check, Eye, RefreshCw, Layers, ArrowUp, ArrowDown, Info, Smartphone, Loader2,
  LayoutGrid, Grid, List, Sparkle, Utensils, Star
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { WaiterBell } from '@/components/owner/WaiterBell';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { label: 'Coupons', icon: Tag, href: '/owner/coupons' },
  { label: 'Reviews', icon: Star, href: '/owner/reviews' },
  { label: 'Analytics', icon: BarChart3, href: '/owner/analytics' },
  { label: 'Customize', icon: Palette, href: '/owner/customize' },
  { label: 'Settings', icon: Settings, href: '/owner/settings' },
];

const PRESET_THEMES = [
  { name: 'Warm Orange', color: '#E85D04', bg: 'from-orange-500 to-amber-500', desc: 'Default energetic vibrant food theme' },
  { name: 'Forest Emerald', color: '#10B981', bg: 'from-emerald-500 to-teal-600', desc: 'Fresh, organic & healthy vibe' },
  { name: 'Royal Indigo', color: '#6366F1', bg: 'from-indigo-500 to-purple-600', desc: 'Modern upscale dining aesthetic' },
  { name: 'Crimson Rose', color: '#E11D48', bg: 'from-rose-500 to-pink-600', desc: 'Bold, romantic & fiery' },
  { name: 'Ocean Cyan', color: '#06B6D4', bg: 'from-cyan-500 to-blue-600', desc: 'Cool, refreshing & seafood theme' },
  { name: 'Golden Amber', color: '#F59E0B', bg: 'from-amber-500 to-yellow-600', desc: 'Rich, bakery & cafe vibes' },
  { name: 'Midnight Dark', color: '#3B82F6', bg: 'from-blue-600 to-slate-900', desc: 'Sleek dark lounge layout' },
  { name: 'Berry Grape', color: '#8B5CF6', bg: 'from-violet-500 to-fuchsia-600', desc: 'Trendy dessert & cocktail bar' },
  { name: 'Sunset Coral', color: '#FF6B6B', bg: 'from-red-400 to-amber-500', desc: 'Warm sunset glow for lounge & diner' },
  { name: 'Mint Refresh', color: '#14B8A6', bg: 'from-teal-400 to-emerald-600', desc: 'Clean, light & refreshing smoothies/salads' },
  { name: 'Deep Violet', color: '#7C3AED', bg: 'from-purple-600 to-indigo-800', desc: 'Premium nightlife & lounge aesthetic' },
  { name: 'Classic Gold', color: '#D97706', bg: 'from-yellow-600 to-amber-700', desc: 'Luxury fine dining & heritage cuisine' },
];

const MENU_DESIGN_TEMPLATES = [
  {
    id: 'modern',
    name: 'Modern Cards',
    icon: Grid,
    desc: 'Clean, rounded card design with floating imagery & badges.',
    badge: 'Popular',
    previewBg: 'bg-gradient-to-br from-orange-500/10 to-amber-500/10',
  },
  {
    id: 'compact',
    name: 'Compact List',
    icon: List,
    desc: 'High-density row layout for quick scanning & fast ordering.',
    badge: 'Fast Scan',
    previewBg: 'bg-gradient-to-br from-slate-800 to-slate-900',
  },
  {
    id: 'bistro',
    name: 'Bistro Fine-Dining',
    icon: Utensils,
    desc: 'Classic elegance with leader dots, serif typography & gold accents.',
    badge: 'Luxury',
    previewBg: 'bg-gradient-to-br from-amber-900/20 to-stone-900',
  },
  {
    id: 'showcase',
    name: 'Visual Showcase',
    icon: LayoutGrid,
    desc: 'Full-bleed imagery focus with dark gradient overlays.',
    badge: 'Photo Focus',
    previewBg: 'bg-gradient-to-br from-purple-900/20 to-pink-900/20',
  },
];

type CustomField = {
  id: string;
  key: string;
  value: string;
  icon: string;
};

type Restaurant = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  themeColor: string | null;
  logo: string | null;
  banner: string | null;
};

type Category = {
  id: string;
  name: string;
  sortOrder: number;
  _count?: { items: number };
};

export function OwnerCustomizePage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'THEME' | 'DESIGN_TEMPLATES' | 'DRAG_MENU' | 'CUSTOM_FIELDS'>('DESIGN_TEMPLATES');

  // Theme State
  const [selectedThemeColor, setSelectedThemeColor] = useState('#E85D04');
  const [selectedLayout, setSelectedLayout] = useState<'modern' | 'compact' | 'bistro' | 'showcase'>('modern');
  
  // Custom Fields State
  const [customFields, setCustomFields] = useState<CustomField[]>([
    { id: '1', key: 'WiFi Network', value: 'Guest_WiFi_5G (Pass: TastyBites2026)', icon: '📶' },
    { id: '2', key: 'Parking', value: 'Free valet parking behind restaurant', icon: '🅿️' },
    { id: '3', key: 'Instagram', value: '@my_restaurant_official', icon: '📸' },
  ]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newIcon, setNewIcon] = useState('✨');

  // Category Drag & Drop state
  const [categoriesList, setCategoriesList] = useState<Category[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  // Fetch restaurant
  const { data: restaurant, isLoading: isRestLoading } = useQuery({
    queryKey: ['owner-restaurant'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as Restaurant;
    },
  });

  // Fetch categories (correct route: /owner/menu/categories)
  const { data: categoriesData, isLoading: isCatLoading } = useQuery({
    queryKey: ['owner-categories'],
    queryFn: async () => {
      const res = await api.get('/owner/menu/categories');
      return res.data.data.categories as Category[];
    },
  });

  useEffect(() => {
    if (restaurant?.themeColor) {
      setSelectedThemeColor(restaurant.themeColor);
    }
  }, [restaurant]);

  useEffect(() => {
    if (categoriesData) {
      setCategoriesList([...categoriesData].sort((a, b) => a.sortOrder - b.sortOrder));
    }
  }, [categoriesData]);

  // Save Theme Mutation
  const saveThemeMutation = useMutation({
    mutationFn: async (color: string) => {
      await api.put('/owner/restaurant', { themeColor: color });
    },
    onSuccess: () => {
      toast.success('Theme color updated successfully! 🎨');
      qc.invalidateQueries({ queryKey: ['owner-restaurant'] });
      qc.invalidateQueries({ queryKey: ['owner-restaurant-layout'] });
    },
    onError: () => toast.error('Failed to update theme'),
  });

  // Save Category Order Mutation
  const saveCategoryOrderMutation = useMutation({
    mutationFn: async (orderPayload: Array<{ id: string; sortOrder: number }>) => {
      await api.put('/owner/menu/categories/reorder', { order: orderPayload });
    },
    onSuccess: () => {
      toast.success('Menu section order saved! 🔀');
      qc.invalidateQueries({ queryKey: ['owner-categories'] });
    },
    onError: () => toast.error('Failed to save section order'),
  });

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const updated = [...categoriesList];
    const [draggedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, draggedItem);

    setDraggedIndex(targetIndex);
    setCategoriesList(updated);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const moveCategory = (index: number, direction: 'UP' | 'DOWN') => {
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= categoriesList.length) return;

    const updated = [...categoriesList];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;

    setCategoriesList(updated);
  };

  const saveReorderedCategories = () => {
    const orderPayload = categoriesList.map((cat, idx) => ({
      id: cat.id,
      sortOrder: idx,
    }));
    saveCategoryOrderMutation.mutate(orderPayload);
  };

  const handleAddField = () => {
    if (!newKey.trim() || !newValue.trim()) {
      toast.error('Please enter both label and value');
      return;
    }
    const item: CustomField = {
      id: Date.now().toString(),
      key: newKey.trim(),
      value: newValue.trim(),
      icon: newIcon || '✨',
    };
    setCustomFields([...customFields, item]);
    setNewKey('');
    setNewValue('');
    toast.success('Field added! Saved locally.');
  };

  const handleRemoveField = (id: string) => {
    setCustomFields(customFields.filter((f) => f.id !== id));
    toast.info('Field removed');
  };

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally { logout(); router.push('/login'); }
  };

  const iframeUrl = restaurant?.slug
    ? `/r/${restaurant.slug}?preview=true` +
      `&themeColor=${encodeURIComponent(selectedThemeColor)}` +
      `&layout=${selectedLayout}` +
      `&name=${encodeURIComponent(restaurant.name ?? '')}` +
      `&description=${encodeURIComponent(restaurant.description ?? '')}`
    : '';

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Sidebar */}
      <aside className={`fixed lg:relative left-0 top-0 h-full z-30 w-64 bg-card border-r border-border flex flex-col transition-transform lg:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-5 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center">
              <UtensilsCrossed className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="font-display font-bold text-sm">Restaurant</p>
              <p className="text-xs text-muted-foreground">Owner Panel</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-primary/10 text-primary font-bold shadow-sm' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
                <Icon className="w-4 h-4" />{item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-sm font-bold text-primary">{user?.name?.[0] ?? 'O'}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm truncate">{user?.name}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm">
            <LogOut className="w-4 h-4" /> Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-xl hover:bg-muted">
              <Menu className="w-5 h-5" />
            </button>
            <div>
              <h1 className="font-display font-bold text-xl flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary animate-pulse" />
                Restaurant Studio & Customization
              </h1>
              <p className="text-xs text-muted-foreground">Customize branding, menu templates, section order & fields</p>
            </div>
          </div>
          <WaiterBell />
        </header>

        {/* Studio Sub-header Navigation */}
        <div className="border-b border-border px-5 py-2.5 bg-muted/20 flex gap-2 overflow-x-auto">
          <button
            onClick={() => setActiveTab('DESIGN_TEMPLATES')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'DESIGN_TEMPLATES' ? 'bg-primary text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            <LayoutGrid className="w-4 h-4" /> Menu Design Templates
          </button>
          <button
            onClick={() => setActiveTab('THEME')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'THEME' ? 'bg-primary text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            <Palette className="w-4 h-4" /> Color Themes & Palettes
          </button>
          <button
            onClick={() => setActiveTab('DRAG_MENU')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'DRAG_MENU' ? 'bg-primary text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            <Layers className="w-4 h-4" /> Reorder Menu Sections
          </button>
          <button
            onClick={() => setActiveTab('CUSTOM_FIELDS')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === 'CUSTOM_FIELDS' ? 'bg-primary text-white shadow-md' : 'bg-muted/50 text-muted-foreground hover:bg-muted'
            }`}
          >
            <Plus className="w-4 h-4" /> Custom Info Fields
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid lg:grid-cols-12 gap-6 max-w-7xl mx-auto items-start">
            
            {/* Left Column — Studio Controls */}
            <div className="lg:col-span-7 space-y-6">

              {/* TAB 0: MENU DESIGN TEMPLATES */}
              {activeTab === 'DESIGN_TEMPLATES' && (
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                  <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="font-display font-bold text-lg text-foreground">Menu Layout & Design Templates</h2>
                        <p className="text-xs text-muted-foreground">Select your favorite layout template style to instantly transform your restaurant's digital menu appearance.</p>
                      </div>
                    </div>

                    {/* Template Selection Grid */}
                    <div className="grid sm:grid-cols-2 gap-4 mb-4">
                      {MENU_DESIGN_TEMPLATES.map((tmpl) => {
                        const Icon = tmpl.icon;
                        const isSelected = selectedLayout === tmpl.id;
                        return (
                          <div
                            key={tmpl.id}
                            onClick={() => {
                              setSelectedLayout(tmpl.id as any);
                              toast.success(`Activated "${tmpl.name}" layout! Preview updated. ✨`);
                            }}
                            className={`relative cursor-pointer p-5 rounded-2xl border transition-all duration-200 ${
                              isSelected
                                ? 'border-primary ring-2 ring-primary/20 bg-primary/5 shadow-lg scale-[1.01]'
                                : 'border-border hover:border-primary/40 bg-card hover:bg-muted/30'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2.5">
                                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                                  <Icon className="w-5 h-5" />
                                </div>
                                <div>
                                  <h3 className="font-bold text-sm text-foreground">{tmpl.name}</h3>
                                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-semibold">
                                    {tmpl.badge}
                                  </span>
                                </div>
                              </div>
                              {isSelected && (
                                <span className="w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center text-xs">
                                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed mb-3">{tmpl.desc}</p>
                            <div className={`h-12 rounded-xl ${tmpl.previewBg} border border-border/40 p-2 flex items-center justify-between`}>
                              <div className="w-16 h-3 bg-white/20 rounded" />
                              <div className="w-8 h-3 bg-primary/40 rounded" />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* TAB 1: THEME & COLOR BUILDER */}
              {activeTab === 'THEME' && (
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                  <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="font-display font-bold text-lg text-foreground">Color Palettes & Branding Themes</h2>
                        <p className="text-xs text-muted-foreground">Pick a theme preset to automatically style your customer-facing QR menu page.</p>
                      </div>
                    </div>

                    {/* Preset Themes Grid */}
                    <div className="grid sm:grid-cols-2 gap-3.5 mb-6">
                      {PRESET_THEMES.map((theme) => {
                        const isSelected = selectedThemeColor.toLowerCase() === theme.color.toLowerCase();
                        return (
                          <div
                            key={theme.name}
                            onClick={() => {
                              setSelectedThemeColor(theme.color);
                              saveThemeMutation.mutate(theme.color);
                            }}
                            className={`relative cursor-pointer p-4 rounded-2xl border transition-all duration-200 ${
                              isSelected
                                ? 'border-primary ring-2 ring-primary/20 bg-primary/5 shadow-md'
                                : 'border-border hover:border-muted-foreground/30 bg-card hover:bg-muted/30'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                <div className={`w-6 h-6 rounded-full bg-gradient-to-tr ${theme.bg} shadow-sm border border-white/20`} />
                                <span className="font-semibold text-sm text-foreground">{theme.name}</span>
                              </div>
                              {isSelected && (
                                <span className="w-5 h-5 rounded-full bg-primary text-white flex items-center justify-center text-xs">
                                  <Check className="w-3 h-3 stroke-[3]" />
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{theme.desc}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Custom Color Picker */}
                    <div className="border-t border-border pt-4">
                      <label className="text-xs font-semibold text-foreground mb-2 block flex items-center gap-1.5">
                        <Palette className="w-4 h-4 text-primary" /> Custom Hex Color Picker
                      </label>
                      <div className="flex items-center gap-3">
                        <input
                          type="color"
                          value={selectedThemeColor}
                          onChange={(e) => setSelectedThemeColor(e.target.value)}
                          className="w-12 h-12 rounded-xl border border-border cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={selectedThemeColor}
                          onChange={(e) => setSelectedThemeColor(e.target.value)}
                          className="flex-1 px-3.5 py-2.5 bg-muted/40 border border-border rounded-xl text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                        />
                        <button
                          onClick={() => saveThemeMutation.mutate(selectedThemeColor)}
                          disabled={saveThemeMutation.isPending}
                          className="px-4 py-2.5 bg-primary text-white rounded-xl font-semibold text-xs shadow-md hover:bg-primary/95 disabled:opacity-60 transition-all flex items-center gap-1.5"
                        >
                          <Save className="w-4 h-4" />
                          Apply Color
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {/* TAB 2: DRAG & DROP MENU CATEGORY REORDER */}
              {activeTab === 'DRAG_MENU' && (
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                  <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="font-display font-bold text-lg text-foreground">Menu Section Order</h2>
                        <p className="text-xs text-muted-foreground">Drag & drop sections to rearrange how menu categories appear to your customers.</p>
                      </div>
                      <button
                        onClick={saveReorderedCategories}
                        disabled={saveCategoryOrderMutation.isPending}
                        className="px-4 py-2 bg-primary text-white rounded-xl font-bold text-xs shadow-md hover:bg-primary/90 disabled:opacity-60 transition-all flex items-center gap-1.5"
                      >
                        <Save className="w-4 h-4" />
                        {saveCategoryOrderMutation.isPending ? 'Saving...' : 'Save Order'}
                      </button>
                    </div>

                    {isCatLoading ? (
                      <div className="py-12 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" /> Loading categories...
                      </div>
                    ) : categoriesList.length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground border border-dashed border-border rounded-2xl">
                        No categories found. Create categories in Menu Management first!
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {categoriesList.map((cat, idx) => (
                          <div
                            key={cat.id}
                            draggable
                            onDragStart={() => handleDragStart(idx)}
                            onDragOver={(e) => handleDragOver(e, idx)}
                            onDragEnd={handleDragEnd}
                            className={`flex items-center justify-between p-3.5 rounded-2xl border bg-card transition-all duration-150 ${
                              draggedIndex === idx
                                ? 'border-primary bg-primary/10 shadow-lg scale-[1.02]'
                                : 'border-border hover:border-primary/40 hover:shadow-sm'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="cursor-grab active:cursor-grabbing p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                                <GripVertical className="w-5 h-5" />
                              </div>
                              <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground font-mono">
                                {idx + 1}
                              </span>
                              <div>
                                <h4 className="font-semibold text-sm text-foreground">{cat.name}</h4>
                                {cat._count?.items !== undefined && (
                                  <p className="text-[11px] text-muted-foreground">{cat._count.items} items</p>
                                )}
                              </div>
                            </div>

                            {/* Up / Down Buttons */}
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => moveCategory(idx, 'UP')}
                                disabled={idx === 0}
                                className="p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground disabled:opacity-30 transition-colors"
                                title="Move Up"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => moveCategory(idx, 'DOWN')}
                                disabled={idx === categoriesList.length - 1}
                                className="p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground disabled:opacity-30 transition-colors"
                                title="Move Down"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* TAB 3: CUSTOM RESTAURANT FIELDS */}
              {activeTab === 'CUSTOM_FIELDS' && (
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">
                  <div className="bg-card border border-border rounded-2xl p-6 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h2 className="font-display font-bold text-lg text-foreground">Custom Information & Badges</h2>
                        <p className="text-xs text-muted-foreground">Add custom information cards like WiFi details, Parking notes, or Social handles.</p>
                      </div>
                    </div>

                    {/* Existing Custom Fields */}
                    <div className="space-y-3 mb-6">
                      {customFields.map((field) => (
                        <div key={field.id} className="flex items-center justify-between p-3.5 rounded-2xl border border-border bg-muted/20">
                          <div className="flex items-center gap-3">
                            <span className="text-xl">{field.icon}</span>
                            <div>
                              <p className="font-semibold text-xs text-foreground uppercase tracking-wider">{field.key}</p>
                              <p className="text-sm font-medium text-muted-foreground">{field.value}</p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleRemoveField(field.id)}
                            className="p-2 rounded-xl text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                            title="Delete Field"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    {/* Add New Custom Field Form */}
                    <div className="border-t border-border pt-4 space-y-3">
                      <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Add New Custom Field</h3>
                      <div className="grid grid-cols-12 gap-2">
                        <input
                          type="text"
                          placeholder="Icon (e.g. 📶, 🅿️)"
                          value={newIcon}
                          onChange={(e) => setNewIcon(e.target.value)}
                          className="col-span-2 px-3 py-2 bg-muted/40 border border-border rounded-xl text-center text-sm"
                        />
                        <input
                          type="text"
                          placeholder="Label (e.g. WiFi, Parking)"
                          value={newKey}
                          onChange={(e) => setNewKey(e.target.value)}
                          className="col-span-4 px-3 py-2 bg-muted/40 border border-border rounded-xl text-sm"
                        />
                        <input
                          type="text"
                          placeholder="Details / Value"
                          value={newValue}
                          onChange={(e) => setNewValue(e.target.value)}
                          className="col-span-6 px-3 py-2 bg-muted/40 border border-border rounded-xl text-sm"
                        />
                      </div>
                      <button
                        onClick={handleAddField}
                        className="w-full py-2.5 bg-primary/10 text-primary hover:bg-primary/20 font-semibold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5"
                      >
                        <Plus className="w-4 h-4" /> Add Field
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}

            </div>

            {/* Right Column — Live Mobile Preview Mockup */}
            <div className="lg:col-span-5 hidden lg:block sticky top-6 self-start">
              <div className="border border-border bg-card rounded-2xl p-4 shadow-sm">
                <div className="flex items-center justify-between mb-4 pb-2 border-b border-border">
                  <h3 className="font-semibold text-sm flex items-center gap-1.5">
                    <Smartphone className="w-4 h-4 text-primary" /> Live Mobile Menu Preview
                  </h3>
                  <span className="text-[10px] text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                    Real-time Live Sync
                  </span>
                </div>
                
                <div className="relative mx-auto w-[290px] h-[580px] rounded-[3rem] border-[10px] border-zinc-950 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col items-center justify-center">
                  {/* Speaker Notch */}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 h-4 w-32 bg-zinc-950 rounded-b-2xl z-45 flex items-center justify-center">
                    <div className="w-10 h-1 bg-zinc-800 rounded-full" />
                  </div>
                  
                  {/* Dynamic Iframe with Loader */}
                  {isRestLoading ? (
                    <div className="flex flex-col items-center gap-2 text-zinc-400">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <span className="text-xs">Loading live preview...</span>
                    </div>
                  ) : restaurant?.slug ? (
                    <iframe
                      key={`${restaurant.slug}-${selectedThemeColor}-${selectedLayout}`}
                      src={iframeUrl}
                      className="w-full h-full border-0 select-none bg-background"
                      title="Menu Preview"
                    />
                  ) : (
                    <div className="p-4 text-center text-xs text-zinc-400">
                      No restaurant slug found. Please setup your restaurant in settings.
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
