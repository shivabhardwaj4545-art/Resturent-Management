'use client';

import { useState, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  UtensilsCrossed,
  ShoppingBag,
  ChefHat,
  Tag,
  Star,
  BarChart3,
  Palette,
  Settings,
  LogOut,
  X,
  Lock,
  CreditCard,
  Users,
  Sparkles,
  BellRing,
  ChevronDown,
  Check,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { ThemeToggle } from '@/components/ThemeToggle';
import api from '@/services/api';
import { toast } from 'sonner';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getImageUrl } from '@/lib/image';

export const OWNER_NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, href: '/owner/dashboard' },
  { key: 'table-sessions', label: 'Table Sessions', icon: Users, href: '/owner/table-sessions' },
  { key: 'table-clearance', label: 'Table Clearance', icon: Sparkles, href: '/owner/table-clearance' },
  { key: 'waiter-requests', label: 'Waiter Requests', icon: BellRing, href: '/owner/waiter-requests' },
  { key: 'menu', label: 'Menu', icon: UtensilsCrossed, href: '/owner/menu' },
  { key: 'orders', label: 'Orders', icon: ShoppingBag, href: '/owner/orders' },
  { key: 'coupons', label: 'Coupons', icon: Tag, href: '/owner/coupons' },
  { key: 'reviews', label: 'Reviews', icon: Star, href: '/owner/reviews' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, href: '/owner/analytics' },
  { key: 'subscription', label: 'Subscription', icon: CreditCard, href: '/owner/subscription' },
  { key: 'customize', label: 'Customize', icon: Palette, href: '/owner/customize' },
  { key: 'settings', label: 'Settings', icon: Settings, href: '/owner/settings' },
];

interface OwnerSidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function OwnerSidebar({ mobileOpen = false, onMobileClose }: OwnerSidebarProps) {
  const pathname = usePathname();
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showRestaurantSwitcher, setShowRestaurantSwitcher] = useState(false);
  const switcherRef = useRef<HTMLDivElement>(null);

  const { data: restaurantData } = useQuery({
    queryKey: ['owner-restaurant-sidebar'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurant');
      return res.data.data.restaurant as {
        id: string;
        name?: string;
        platformType?: string;
        maxLogins?: number;
        disabledTabs?: string[] | null;
        logo?: string | null;
        featureFlags?: {
          kotMode?: 'DIGITAL_KDS' | 'PRINT_KOT';
          [key: string]: any;
        };
      };
    },
    staleTime: 5 * 1000,
  });

  const { data: allRestaurantsData } = useQuery({
    queryKey: ['owner-restaurants-list'],
    queryFn: async () => {
      const res = await api.get('/owner/restaurants');
      return (res.data.data.restaurants || []) as Array<{
        id: string;
        name: string;
        slug: string;
        logo: string | null;
        isOpen: boolean;
        platformType: string;
      }>;
    },
    staleTime: 30 * 1000,
  });

  // Keep localStorage active restaurant id initialized
  useEffect(() => {
    if (restaurantData?.id && typeof window !== 'undefined') {
      const current = localStorage.getItem('owner_active_restaurant_id');
      if (!current) {
        localStorage.setItem('owner_active_restaurant_id', restaurantData.id);
      }
    }
  }, [restaurantData?.id]);

  // Close switcher on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) {
        setShowRestaurantSwitcher(false);
      }
    };
    if (showRestaurantSwitcher) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showRestaurantSwitcher]);

  const handleSwitchRestaurant = (targetId: string, targetName: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('owner_active_restaurant_id', targetId);
    }
    useAuthStore.getState().updateUser({ restaurantId: targetId });
    setShowRestaurantSwitcher(false);
    toast.success(`Switched active dashboard to "${targetName}"! 🏪`);
    queryClient.invalidateQueries();
  };

  const disabledTabs: string[] = Array.isArray(restaurantData?.disabledTabs) ? restaurantData.disabledTabs : [];

  const handleLogout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    } finally {
      logout();
      toast.success('Logged out successfully');
      router.push('/login');
    }
  };

  const sidebarContent = (
    <div className="w-64 h-full bg-card border-r border-border flex flex-col justify-between shrink-0 overflow-hidden">
      {/* Top Header & Nav Container */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0 relative" ref={switcherRef}>
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="w-10 h-10 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/25 shrink-0 overflow-hidden">
              {restaurantData?.logo ? (
                <img
                  src={getImageUrl(restaurantData.logo)}
                  alt={restaurantData.name || 'Restaurant Logo'}
                  className="w-full h-full object-cover rounded-2xl"
                />
              ) : (
                <UtensilsCrossed className="w-5 h-5 text-primary-foreground" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              {allRestaurantsData && allRestaurantsData.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setShowRestaurantSwitcher((prev) => !prev)}
                  className="w-full text-left group flex items-center justify-between gap-1 hover:opacity-85 transition-opacity"
                  title="Click to switch between your restaurants"
                >
                  <div className="min-w-0">
                    <p className="font-extrabold text-sm text-foreground tracking-tight truncate max-w-[105px] group-hover:text-primary transition-colors">
                      {restaurantData?.name || 'Restaurant'}
                    </p>
                    <p className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
                      <span>Switch Outlet</span>
                    </p>
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-transform ${showRestaurantSwitcher ? 'rotate-180' : ''}`} />
                </button>
              ) : (
                <>
                  <div className="flex items-center gap-1.5">
                    <p className="font-extrabold text-sm text-foreground tracking-tight truncate max-w-[110px]">
                      {restaurantData?.name || 'Restaurant'}
                    </p>
                    {restaurantData?.platformType === 'DUAL' ? (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-500 border border-amber-500/30 shrink-0">
                        DUAL
                      </span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground font-medium truncate">
                    {restaurantData?.platformType === 'DUAL'
                      ? 'Restaurant & Hotel'
                      : 'Owner Panel'}
                  </p>
                </>
              )}
            </div>
          </div>

          {onMobileClose && (
            <button
              onClick={onMobileClose}
              className="lg:hidden p-2 rounded-xl text-muted-foreground hover:bg-muted ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          {/* Restaurant Switcher Dropdown Menu */}
          {showRestaurantSwitcher && allRestaurantsData && (
            <div className="absolute top-full left-3 right-3 mt-1.5 bg-card border border-border rounded-2xl shadow-xl z-50 p-2 space-y-1 animate-in fade-in zoom-in-95 duration-150">
              <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Your Outlets ({allRestaurantsData.length})
              </div>
              {allRestaurantsData.map((rest) => {
                const isSelected = rest.id === restaurantData?.id;
                return (
                  <button
                    key={rest.id}
                    type="button"
                    onClick={() => handleSwitchRestaurant(rest.id, rest.name)}
                    className={`w-full flex items-center justify-between p-2 rounded-xl text-left text-xs font-semibold transition-all ${
                      isSelected
                        ? 'bg-primary/10 text-primary font-bold'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-lg bg-muted text-foreground flex items-center justify-center overflow-hidden shrink-0">
                        {rest.logo ? (
                          <img src={getImageUrl(rest.logo)} alt={rest.name} className="w-full h-full object-cover" />
                        ) : (
                          <UtensilsCrossed className="w-3.5 h-3.5 opacity-60" />
                        )}
                      </div>
                      <span className="truncate">{rest.name}</span>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Nav Links */}
        <nav className="p-4 space-y-1.5 flex-1 min-h-0 overflow-y-auto max-h-[calc(100vh-210px)]">
          {OWNER_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            const isTabDisabled = disabledTabs.includes(item.key);

            // If disabled by administration, hide completely from the sidebar
            if (isTabDisabled) {
              return null;
            }

            // If restaurant uses simple physical print KOT or KDS is disabled, digital kitchen staff KDS accounts are hidden
            if (
              item.key === 'kitchen-staff' &&
              (restaurantData?.featureFlags?.kotMode === 'PRINT_KOT' ||
                restaurantData?.featureFlags?.kitchenDisplayEnabled === false)
            ) {
              return null;
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onMobileClose}
                className={`flex items-center gap-3.5 px-4 py-3 rounded-2xl text-sm font-bold transition-all ${
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Bottom User Box */}
      <div className="p-4 border-t border-border bg-card shrink-0 mt-auto">
        <div className="flex items-center gap-3 mb-3 p-2 rounded-2xl bg-muted/50 border border-border/60">
          <div className="w-9 h-9 rounded-xl bg-primary/20 text-primary font-extrabold flex items-center justify-center text-sm shrink-0 border border-primary/30">
            {user?.name?.[0]?.toUpperCase() ?? 'O'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-xs text-foreground truncate">{user?.name || 'Owner'}</p>
            <p className="text-[11px] text-muted-foreground truncate">{user?.email}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleLogout}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-all border border-border/60"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>Logout</span>
          </button>
          <ThemeToggle size="sm" />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-64 h-screen sticky top-0 shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex">
          <div className="w-64 h-full">{sidebarContent}</div>
          <div className="flex-1" onClick={onMobileClose} />
        </div>
      )}
    </>
  );
}
