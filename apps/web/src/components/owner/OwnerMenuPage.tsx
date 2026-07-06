'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UtensilsCrossed, LayoutDashboard, ShoppingBag, Tag, BarChart3, Settings, LogOut,
  Menu, Plus, Trash2, Edit2, Eye, EyeOff, Image, Leaf, X, Check, ChevronDown, Palette
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import api from '@/lib/api';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';

const NAV_ITEMS = [
  { label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { label: 'Coupons', icon: Tag, href: '/owner/coupons' },
  { label: 'Analytics', icon: BarChart3, href: '/owner/analytics' },
  { label: 'Customize', icon: Palette, href: '/owner/customize' },
  { label: 'Settings', icon: Settings, href: '/owner/settings' },
];

type Category = { id: string; name: string; sortOrder: number; _count: { items: number } };
type MenuItem = {
  id: string; name: string; description: string | null; price: number;
  categoryId: string; image: string | null; isVeg: boolean; isVegan: boolean;
  isAvailable: boolean; badges: string[];
  category: { name: string };
};

export function OwnerMenuPage() {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const qc = useQueryClient();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [editItem, setEditItem] = useState<MenuItem | null>(null);
  const [form, setForm] = useState({
    name: '', description: '', price: '', categoryId: '', isVeg: true, isAvailable: true,
    image: null as File | null,
  });
  const [previewVersion, setPreviewVersion] = useState(0);

  const { data: restaurantData } = useQuery({
    queryKey: ['owner-restaurant'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as { slug: string; themeColor: string | null };
    },
  });

  const { data: catData } = useQuery({
    queryKey: ['owner-categories'],
    queryFn: async () => {
      const res = await api.get('/owner/menu/categories');
      return res.data.data.categories as Category[];
    },
  });

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['owner-menu-items'],
    queryFn: async () => {
      const res = await api.get('/owner/menu/items');
      return res.data.data.items as MenuItem[];
    },
  });

  const createCategoryMutation = useMutation({
    mutationFn: async () => { await api.post('/owner/menu/categories', { name: newCategory }); },
    onSuccess: () => {
      toast.success('Category created');
      setNewCategory('');
      setShowAddCategory(false);
      qc.invalidateQueries({ queryKey: ['owner-categories'] });
      setPreviewVersion(v => v + 1);
    },
    onError: () => toast.error('Failed to create category'),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/owner/menu/categories/${id}`); },
    onSuccess: () => {
      toast.success('Category deleted');
      qc.invalidateQueries({ queryKey: ['owner-categories'] });
      setPreviewVersion(v => v + 1);
    },
    onError: () => toast.error('Failed to delete category'),
  });

  const toggleItemMutation = useMutation({
    mutationFn: async (id: string) => { await api.patch(`/owner/menu/items/${id}/availability`); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['owner-menu-items'] });
      setPreviewVersion(v => v + 1);
    },
    onError: () => toast.error('Failed to toggle item'),
  });

  const deleteItemMutation = useMutation({
    mutationFn: async (id: string) => { await api.delete(`/owner/menu/items/${id}`); },
    onSuccess: () => {
      toast.success('Item deleted');
      qc.invalidateQueries({ queryKey: ['owner-menu-items'] });
      setPreviewVersion(v => v + 1);
    },
    onError: () => toast.error('Failed to delete item'),
  });

  const submitItem = async () => {
    if (!form.name || !form.price || !form.categoryId) {
      toast.error('Please fill all required fields');
      return;
    }
    const fd = new FormData();
    fd.append('name', form.name);
    if (form.description) fd.append('description', form.description);
    fd.append('price', form.price);
    fd.append('categoryId', form.categoryId);
    fd.append('isVeg', String(form.isVeg));
    fd.append('isAvailable', String(form.isAvailable));
    if (form.image) fd.append('image', form.image);

    try {
      if (editItem) {
        await api.put(`/owner/menu/items/${editItem.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Item updated');
      } else {
        await api.post('/owner/menu/items', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
        toast.success('Item created');
      }
      setShowAddItem(false);
      setEditItem(null);
      setForm({ name: '', description: '', price: '', categoryId: '', isVeg: true, isAvailable: true, image: null });
      qc.invalidateQueries({ queryKey: ['owner-menu-items'] });
      setPreviewVersion(v => v + 1);
    } catch {
      toast.error('Failed to save item');
    }
  };

  const handleLogout = async () => {
    try { await api.post('/auth/logout'); } finally { logout(); router.push('/login'); }
  };

  const filteredItems = activeCategory ? itemsData?.filter(i => i.categoryId === activeCategory) : itemsData;
  const iframeUrl = restaurantData?.slug ? `/r/${restaurantData.slug}` : '';

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {sidebarOpen && <div className="fixed inset-0 bg-black/60 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Add/Edit Item Modal */}
      <AnimatePresence>
        {showAddItem && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-5">
                <h2 className="font-display font-bold text-lg">{editItem ? 'Edit Item' : 'Add Menu Item'}</h2>
                <button onClick={() => { setShowAddItem(false); setEditItem(null); }} className="p-2 hover:bg-muted rounded-xl">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Item Name *</label>
                  <input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. Butter Chicken"
                    className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Description</label>
                  <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Describe the dish..." rows={2}
                    className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Price (₹) *</label>
                    <input type="number" value={form.price} onChange={(e) => setForm(f => ({ ...f, price: e.target.value }))}
                      placeholder="0.00" min="0"
                      className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Category *</label>
                    <select value={form.categoryId} onChange={(e) => setForm(f => ({ ...f, categoryId: e.target.value }))}
                      className="w-full px-3 py-2.5 bg-muted/30 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                      <option value="">Select category</option>
                      {catData?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.isVeg} onChange={(e) => setForm(f => ({ ...f, isVeg: e.target.checked }))} className="accent-green-500" />
                    <span className="text-sm">Vegetarian</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={form.isAvailable} onChange={(e) => setForm(f => ({ ...f, isAvailable: e.target.checked }))} className="accent-primary" />
                    <span className="text-sm">Available</span>
                  </label>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1.5 block">Image (optional)</label>
                  <input type="file" accept="image/*" onChange={(e) => setForm(f => ({ ...f, image: e.target.files?.[0] ?? null }))}
                    className="w-full px-3 py-2 text-sm text-muted-foreground border border-dashed border-border rounded-xl" />
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={submitItem}
                    className="flex-1 py-2.5 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 transition-colors">
                    {editItem ? 'Update Item' : 'Add Item'}
                  </button>
                  <button onClick={() => { setShowAddItem(false); setEditItem(null); }}
                    className="px-4 py-2.5 bg-muted rounded-xl font-medium text-sm hover:bg-muted/70 transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${isActive ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
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

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden p-2 rounded-xl hover:bg-muted">
              <Menu className="w-5 h-5" />
            </button>
            <h1 className="font-display font-bold text-xl">Menu Management</h1>
          </div>
          <button onClick={() => { setEditItem(null); setForm({ name: '', description: '', price: '', categoryId: activeCategory ?? '', isVeg: true, isAvailable: true, image: null }); setShowAddItem(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-xl font-medium text-sm hover:bg-primary/90 transition-colors">
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </header>

        <div className="flex-1 overflow-hidden flex">
          {/* Categories Sidebar */}
          <div className="w-56 border-r border-border bg-card/50 flex flex-col hidden md:flex">
            <div className="p-3 border-b border-border">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Categories</p>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <button onClick={() => setActiveCategory(null)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm transition-all ${!activeCategory ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'}`}>
                All Items ({itemsData?.length ?? 0})
              </button>
              {catData?.map((c) => (
                <div key={c.id} className="flex items-center gap-1">
                  <button onClick={() => setActiveCategory(c.id)}
                    className={`flex-1 text-left px-3 py-2 rounded-xl text-sm transition-all ${activeCategory === c.id ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'}`}>
                    {c.name} ({c._count.items})
                  </button>
                  <button onClick={() => deleteCategoryMutation.mutate(c.id)} className="p-1 text-muted-foreground hover:text-red-500 opacity-0 hover:opacity-100 transition-all rounded-lg hover:bg-muted">
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-border">
              {showAddCategory ? (
                <div className="flex gap-2">
                  <input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="Category name"
                    className="flex-1 px-2 py-1.5 text-xs bg-muted/30 border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary/30" />
                  <button onClick={() => createCategoryMutation.mutate()} className="p-1.5 text-green-600 hover:bg-green-100 dark:hover:bg-green-900/20 rounded-lg">
                    <Check className="w-3 h-3" />
                  </button>
                  <button onClick={() => setShowAddCategory(false)} className="p-1.5 text-muted-foreground hover:bg-muted rounded-lg">
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowAddCategory(true)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors">
                  <Plus className="w-3 h-3" /> Add Category
                </button>
              )}
            </div>
          </div>

          {/* Items Grid */}
          <div className="flex-1 overflow-y-auto p-5">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1,2,3,4,5,6].map(i => <div key={i} className="h-44 skeleton rounded-2xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredItems?.map((item) => (
                  <motion.div key={item.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                    className={`bg-card border rounded-2xl overflow-hidden transition-all ${item.isAvailable ? 'border-border' : 'border-dashed border-border opacity-60'}`}>
                    {item.image ? (
                      <img src={item.image} alt={item.name} className="w-full h-36 object-cover" />
                    ) : (
                      <div className="w-full h-36 bg-gradient-to-br from-orange-500/10 to-amber-500/10 flex items-center justify-center">
                        <Image className="w-10 h-10 text-orange-300" />
                      </div>
                    )}
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <div className={`w-3 h-3 rounded-full border-2 flex-shrink-0 ${item.isVeg ? 'border-green-500' : 'border-red-500'}`}>
                              <div className={`w-1.5 h-1.5 rounded-full m-px ${item.isVeg ? 'bg-green-500' : 'bg-red-500'}`} />
                            </div>
                            <p className="font-semibold text-sm truncate">{item.name}</p>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">{item.category.name}</p>
                        </div>
                        <p className="font-bold text-sm text-primary flex-shrink-0">₹{item.price}</p>
                      </div>
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex gap-1">
                          <button onClick={() => { setEditItem(item); setForm({ name: item.name, description: item.description ?? '', price: String(item.price), categoryId: item.categoryId, isVeg: item.isVeg, isAvailable: item.isAvailable, image: null }); setShowAddItem(true); }}
                            className="p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button onClick={() => deleteItemMutation.mutate(item.id)}
                            className="p-1.5 text-muted-foreground hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <button onClick={() => toggleItemMutation.mutate(item.id)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium transition-colors ${item.isAvailable ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 hover:bg-green-200' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}>
                          {item.isAvailable ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                          {item.isAvailable ? 'Available' : 'Hidden'}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}
                {filteredItems?.length === 0 && (
                  <div className="col-span-3 text-center py-20 text-muted-foreground">
                    <UtensilsCrossed className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No items yet</p>
                    <p className="text-sm">Add your first menu item to get started</p>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Live Mobile Preview (Right Side) */}
          <div className="w-[340px] border-l border-border bg-card/20 p-4 hidden xl:flex flex-col items-center justify-start overflow-y-auto">
            <div className="w-full flex items-center justify-between mb-4 pb-2 border-b border-border">
              <h3 className="font-semibold text-sm flex items-center gap-1.5">
                Live Customer Menu Preview
              </h3>
              <span className="text-[10px] text-muted-foreground bg-muted px-2.5 py-1 rounded-lg">
                Real-time
              </span>
            </div>

            <div className="relative w-[280px] h-[560px] rounded-[3rem] border-[10px] border-zinc-950 bg-zinc-950 shadow-2xl overflow-hidden">
              {/* Speaker Notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 h-4 w-32 bg-zinc-950 rounded-b-2xl z-45 flex items-center justify-center">
                <div className="w-10 h-1 bg-zinc-800 rounded-full" />
              </div>
              
              {/* Iframe */}
              {iframeUrl && (
                <iframe
                  key={previewVersion}
                  src={`${iframeUrl}?v=${previewVersion}`}
                  className="w-full h-full border-0 select-none bg-background"
                  title="Menu Preview"
                />
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
