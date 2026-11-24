'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Image from 'next/image';
import { Search, Filter, ShoppingCart, Clock, MapPin, Star, Bot, X, ChevronUp, QrCode, ChevronRight, BellRing, Ban, Bed, Sparkles, Utensils, Shirt, Bath, Luggage, Wrench, MessageSquare, CheckCircle2, ChevronDown, Lock, RefreshCw, Phone, Check } from 'lucide-react';
import api, { getSocketUrl } from '@/services/api';
import { useCartStore } from '@/store/cart.store';
import { useAuthStore } from '@/store/auth.store';
import dynamic from 'next/dynamic';
import { MenuItemCard } from './MenuItemCard';
import { CartDrawer } from './CartDrawer';
import { AIRecommendations } from './AIRecommendations';
import type { CustomerAlertData } from './CustomerAlertModal';

const AIChatbot = dynamic(() => import('./AIChatbot').then((mod) => mod.AIChatbot), { ssr: false });
const CustomerNotificationModal = dynamic(() => import('./CustomerNotificationModal').then((mod) => mod.CustomerNotificationModal), { ssr: false });
const CustomerAlertModal = dynamic(() => import('./CustomerAlertModal').then((mod) => mod.CustomerAlertModal), { ssr: false });
import { playWaiterCallSound, playNewOrderSound, processRealTimeEvent } from '@/utils/audio';
import { toast } from 'sonner';
import { Bell } from 'lucide-react';
import Link from 'next/link';
import { getDetailedStatus, formatTime12h } from '@/utils/operatingHours';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useRouter } from 'next/navigation';
import { io } from 'socket.io-client';
import { generateTableToken } from '@qr-restaurant/shared';
import { formatTableLabel } from '@/utils/tableCode';
import { applyThemeColor } from '@/utils/theme';

const WAITER_COOLDOWN_SECONDS = 30;

export const HOTEL_ROOM_PURPOSES = [
  { id: 'Room Cleaning', label: '🧹 Room Cleaning', desc: 'Housekeeping, room tidy & trash pickup' },
  { id: 'Food & Water', label: '🍽️ Food, Cutlery & Water', desc: 'Extra plates, spoons, glasses & drinking water' },
  { id: 'Iron & Laundry', label: '👔 Iron / Ironing Board & Laundry', desc: 'Iron box, ironing board & clothes pressing' },
  { id: 'Towels & Toiletries', label: '🛏️ Fresh Towels & Toiletries', desc: 'Fresh towels, soap, shampoo & bath kit' },
  { id: 'Luggage & Bellboy', label: '🧳 Luggage / Bellboy Assistance', desc: 'Luggage assistance & check-out bags' },
  { id: 'Room Maintenance', label: '🔧 Room Maintenance', desc: 'AC cooling, TV remote, electrical or plumbing' },
  { id: 'General Assistance', label: '🔔 General Room Service', desc: 'Staff visit to the room for assistance' },
  { id: 'Custom Request', label: '✍️ Custom Request / Other', desc: 'Specify any special requirement or custom service' },
];

export const DINE_IN_PURPOSES = [
  { id: 'Food & Cutlery', label: '🍽️ Extra Cutlery, Water & Napkins', desc: 'Drinking water, extra spoons, plates & tissues' },
  { id: 'Table Cleaning', label: '🧹 Clean Table', desc: 'Wipe table, clear used plates' },
  { id: 'Bill & Payment', label: '💳 Bill & Payment Request', desc: 'Request bill copy, payment machine or cash collection' },
  { id: 'Call Waiter', label: '🙋 Call Waiter to Table', desc: 'Assistance with menu, recommendations & order' },
  { id: 'Custom Request', label: '✍️ Custom Request / Other', desc: 'Specify custom request' },
];

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface RestaurantMenuPageProps {
  slug: string;
  tableNumber?: string;
  tableToken?: string;
  isTableVerified?: boolean;
  searchParams?: {
    table?: string;
    t?: string;
    token?: string;
    preview?: string;
    themeColor?: string;
    name?: string;
    description?: string;
    logo?: string;
    banner?: string;
    layout?: string;
  };
}

export function RestaurantMenuPage({ slug, tableNumber, tableToken, isTableVerified, searchParams }: RestaurantMenuPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isPreview = searchParams?.preview === 'true';
  const [mounted, setMounted] = useState(false);
  const [isMaintenanceFromApi, setIsMaintenanceFromApi] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (slug) {
      router.prefetch(`/r/${slug}/checkout`);
    }
  }, [slug, router]);

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'ALL' | 'VEG' | 'NON_VEG' | 'VEGAN'>('ALL');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [showFilterDrawer, setShowFilterDrawer] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [priceSort, setPriceSort] = useState<'DEFAULT' | 'LOW_TO_HIGH' | 'HIGH_TO_LOW'>('DEFAULT');

  const hasActiveFilters = activeFilter !== 'ALL' || maxPrice !== null || priceSort !== 'DEFAULT' || !!searchQuery;
  type WaiterStatus = 'IDLE' | 'PENDING' | 'COMING' | 'OCCUPIED';
  const [waiterStatus, setWaiterStatus] = useState<WaiterStatus>('IDLE');
  const [waiterCooldown, setWaiterCooldown] = useState(0);
  const [waiterLoading, setWaiterLoading] = useState(false);
  const [showTableInput, setShowTableInput] = useState(false);
  const [showServiceModal, setShowServiceModal] = useState(false);
  const [selectedPurpose, setSelectedPurpose] = useState<string>('Room Cleaning');
  const [customServiceNote, setCustomServiceNote] = useState<string>('');
  const [isEditingLocation, setIsEditingLocation] = useState(false);
  const [manualTableNumber, setManualTableNumber] = useState('');
  const [waiterComingTimer, setWaiterComingTimer] = useState(0);
  const [waiterPendingTimer, setWaiterPendingTimer] = useState(0);
  const [tableLockedState, setTableLockedState] = useState<{
    locked: boolean;
    reason?: string;
    message?: string;
    tableNumber?: string;
  } | null>(null);
  const [tableAccessCodeInput, setTableAccessCodeInput] = useState('');
  const [accessCodeError, setAccessCodeError] = useState<string | null>(null);
  const [isValidatingCode, setIsValidatingCode] = useState(false);
  const [isCallingWaiterFromOccupied, setIsCallingWaiterFromOccupied] = useState(false);
  const [waiterCalledSuccess, setWaiterCalledSuccess] = useState(false);
  const [isJoinedViaCode, setIsJoinedViaCode] = useState(false);
  const waiterComingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waiterTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const socketRef = useRef<any>(null);

  const getOrCreateDeviceId = useCallback(() => {
    if (typeof window === 'undefined') return 'device-anon';
    let devId = localStorage.getItem('ez_device_id');
    if (!devId) {
      devId = 'dev_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now().toString(36);
      localStorage.setItem('ez_device_id', devId);
    }
    return devId;
  }, []);

  const effectiveTableForCheck = tableNumber || manualTableNumber || (typeof window !== 'undefined' ? localStorage.getItem(`table_num_${slug}`) : null);

  const { data: tableAccessData, refetch: refetchTableAccess } = useQuery({
    queryKey: ['table-session-check-access', slug, effectiveTableForCheck],
    queryFn: async () => {
      if (!effectiveTableForCheck || !slug) return null;
      try {
        const devId = getOrCreateDeviceId();
        const storedActiveOrder =
          addonOrderId ||
          (typeof window !== 'undefined'
            ? sessionStorage.getItem('qr_restaurant_addon_order_id') ||
            localStorage.getItem(`active_table_order_id_${slug}`) ||
            localStorage.getItem('active_table_order_id')
            : null);

        const res = await api.post('/table-sessions/check-access', {
          restaurantSlug: slug,
          tableNumber: effectiveTableForCheck,
          deviceReference: devId,
          activeOrderId: storedActiveOrder || undefined,
        }, {
          headers: {
            'x-device-id': devId,
            ...(storedActiveOrder ? { 'x-active-order-id': storedActiveOrder } : {}),
          },
        });
        setTableLockedState(null);
        return res.data;
      } catch (err: any) {
        const storedActiveOrder =
          addonOrderId ||
          (typeof window !== 'undefined'
            ? sessionStorage.getItem('qr_restaurant_addon_order_id') ||
            localStorage.getItem(`active_table_order_id_${slug}`) ||
            localStorage.getItem('active_table_order_id')
            : null);

        if (
          err.response?.status === 503 ||
          err.response?.data?.code === 'QR_SERVICE_MAINTENANCE'
        ) {
          setIsMaintenanceFromApi(true);
          return null;
        }

        // If diner is already on this table or added items, never lock them out
        if (storedActiveOrder) {
          setTableLockedState(null);
          return null;
        }

        if (
          err.response?.data?.code === 'TABLE_CURRENTLY_OCCUPIED' ||
          err.response?.data?.code === 'TABLE_ALREADY_OCCUPIED' ||
          err.response?.status === 409
        ) {
          setTableLockedState({
            locked: true,
            reason: err.response?.data?.code || 'TABLE_ALREADY_OCCUPIED',
            message: err.response?.data?.message || 'An active order already exists for this table.',
            tableNumber: effectiveTableForCheck,
          });
        }
        return null;
      }
    },
    enabled: !!effectiveTableForCheck && !!slug,
    retry: false,
    refetchInterval: 8000,
  });

  const handleValidateTableAccessCode = async () => {
    if (!tableAccessCodeInput || tableAccessCodeInput.trim().length !== 4) {
      setAccessCodeError('Please enter a valid 4-digit code.');
      return;
    }
    setIsValidatingCode(true);
    setAccessCodeError(null);
    try {
      const devId = getOrCreateDeviceId();
      const res = await api.post('/table-sessions/validate-access-code', {
        restaurantSlug: slug,
        tableNumber: effectiveTableForCheck,
        accessCode: tableAccessCodeInput.trim(),
        deviceReference: devId,
      }, {
        headers: {
          'x-device-id': devId,
        },
      });

      if (res.data?.success) {
        setIsJoinedViaCode(true);
        setTableLockedState(null);
        setTableAccessCodeInput('');

        if (res.data?.data?.activeOrderId) {
          const actId = res.data.data.activeOrderId;
          const actNum = res.data.data.activeOrder?.orderNumber || actId.slice(-8).toUpperCase();
          setAddonOrderId(actId);
          setAddonOrderNum(actNum);
          if (typeof window !== 'undefined') {
            sessionStorage.setItem('qr_restaurant_addon_order_id', actId);
            sessionStorage.setItem('qr_restaurant_addon_order_num', actNum);
            localStorage.setItem(`active_table_order_id_${slug}`, actId);
            localStorage.setItem('active_table_order_id', actId);
          }
        }

        refetchTableAccess();
      }
    } catch (err: any) {
      const errorMsg = err.response?.data?.message || 'Invalid Order Verification Code. Please check the 4-digit code shown on the screen of the person who placed the table order.';
      setAccessCodeError(errorMsg);
    } finally {
      setIsValidatingCode(false);
    }
  };

  const handleCallWaiterFromOccupied = async () => {
    setIsCallingWaiterFromOccupied(true);
    try {
      const devId = getOrCreateDeviceId();
      await api.post('/waiter-requests', {
        restaurantSlug: slug,
        tableNumber: effectiveTableForCheck,
        requestType: 'TABLE_OCCUPIED_PHYSICALLY_EMPTY',
        reason: 'Guest reported table appears empty but is digitally marked occupied.',
        deviceReference: devId,
      }, {
        headers: {
          'x-device-id': devId,
        },
      });
      setWaiterCalledSuccess(true);
      toast.success('Staff notified! A waiter will assist you shortly.');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to call waiter. Please try again.');
    } finally {
      setIsCallingWaiterFromOccupied(false);
    }
  };

  const clearWaiterTimers = useCallback(() => {
    if (waiterTimerRef.current) {
      clearInterval(waiterTimerRef.current);
      waiterTimerRef.current = null;
    }
    if (waiterComingRef.current) {
      clearInterval(waiterComingRef.current);
      waiterComingRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && slug) {
      localStorage.setItem('scanned_restaurant_slug', slug);
      if (tableNumber) {
        localStorage.setItem('scanned_table_number', tableNumber);
      }
    }
  }, [slug, tableNumber]);

  const getTableStorageKey = useCallback((tbl?: string | null) => {
    const activeTbl = tbl || tableNumber || manualTableNumber || (typeof window !== 'undefined' ? localStorage.getItem(`table_num_${slug}`) : null);
    return activeTbl ? `${slug}_t_${String(activeTbl).trim()}` : null;
  }, [slug, tableNumber, manualTableNumber]);

  const resetWaiterState = useCallback((tbl?: string | null) => {
    clearWaiterTimers();
    setWaiterStatus('IDLE');
    setWaiterCooldown(0);
    setWaiterComingTimer(0);
    setWaiterPendingTimer(0);
    if (typeof window !== 'undefined') {
      const key = getTableStorageKey(tbl);
      if (key) {
        localStorage.removeItem(`waiter_status_${key}`);
        localStorage.removeItem(`waiter_timer_until_${key}`);
      }
    }
  }, [clearWaiterTimers, getTableStorageKey]);

  const startComingTimer = useCallback((seconds: number, tbl?: string | null) => {
    clearWaiterTimers();
    setWaiterStatus('COMING');
    setWaiterComingTimer(seconds);
    setWaiterCooldown(0);

    const until = Date.now() + seconds * 1000;
    const key = getTableStorageKey(tbl);
    if (typeof window !== 'undefined' && key) {
      localStorage.setItem(`waiter_status_${key}`, 'COMING');
      localStorage.setItem(`waiter_timer_until_${key}`, String(until));
    }

    waiterComingRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setWaiterComingTimer(remaining);
      if (remaining <= 0) {
        resetWaiterState(tbl);
      }
    }, 1000);
  }, [clearWaiterTimers, getTableStorageKey, resetWaiterState]);

  const startOccupiedTimer = useCallback((seconds: number, tbl?: string | null) => {
    clearWaiterTimers();
    setWaiterStatus('OCCUPIED');
    setWaiterCooldown(seconds);
    setWaiterComingTimer(0);

    const until = Date.now() + seconds * 1000;
    const key = getTableStorageKey(tbl);
    if (typeof window !== 'undefined' && key) {
      localStorage.setItem(`waiter_status_${key}`, 'OCCUPIED');
      localStorage.setItem(`waiter_timer_until_${key}`, String(until));
    }

    waiterTimerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setWaiterCooldown(remaining);
      if (remaining <= 0) {
        resetWaiterState(tbl);
      }
    }, 1000);
  }, [clearWaiterTimers, getTableStorageKey, resetWaiterState]);

  const startPendingState = useCallback((tbl?: string | null, seconds: number = 30) => {
    clearWaiterTimers();
    setWaiterStatus('PENDING');
    setWaiterPendingTimer(seconds);
    setWaiterCooldown(0);
    setWaiterComingTimer(0);

    const until = Date.now() + seconds * 1000;
    const key = getTableStorageKey(tbl);
    if (typeof window !== 'undefined' && key) {
      localStorage.setItem(`waiter_status_${key}`, 'PENDING');
      localStorage.setItem(`waiter_timer_until_${key}`, String(until));
    }

    waiterTimerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setWaiterPendingTimer(remaining);
      if (remaining <= 0) {
        resetWaiterState(tbl);
      }
    }, 1000);
  }, [clearWaiterTimers, getTableStorageKey, resetWaiterState]);

  // Restore running timer state ONLY for the specific table
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = getTableStorageKey();
    if (!key) {
      setWaiterStatus('IDLE');
      setWaiterCooldown(0);
      setWaiterComingTimer(0);
      return;
    }

    const storedStatus = localStorage.getItem(`waiter_status_${key}`) as WaiterStatus | null;
    const storedUntil = Number(localStorage.getItem(`waiter_timer_until_${key}`) || 0);

    if (storedStatus && storedUntil > Date.now()) {
      const remaining = Math.ceil((storedUntil - Date.now()) / 1000);
      if (storedStatus === 'COMING') {
        startComingTimer(remaining, tableNumber || manualTableNumber);
      } else if (storedStatus === 'OCCUPIED') {
        startOccupiedTimer(remaining, tableNumber || manualTableNumber);
      } else if (storedStatus === 'PENDING') {
        startPendingState(tableNumber || manualTableNumber, remaining);
      }
    } else {
      localStorage.removeItem(`waiter_status_${key}`);
      localStorage.removeItem(`waiter_timer_until_${key}`);
      setWaiterStatus('IDLE');
    }
  }, [getTableStorageKey, startComingTimer, startOccupiedTimer, startPendingState, tableNumber, manualTableNumber]);

  const { items: cartItems, itemCount, setRestaurant, total: getCartTotal } = useCartStore();
  const { user: rawUser, accessToken, logout } = useAuthStore();
  const [showNotifModal, setShowNotifModal] = useState(false);
  const [customerAlert, setCustomerAlert] = useState<CustomerAlertData | null>(null);

  // Fetch unread notifications count for customer
  const { data: customerNotifData } = useQuery({
    queryKey: ['customer-notifications-count'],
    queryFn: async () => {
      const res = await api.get('/profile/notifications');
      return res.data.data as { unreadCount: number };
    },
    enabled: !!rawUser?.id && !!accessToken,
    staleTime: 60000,
    retry: false,
    refetchInterval: 60000,
  });

  const unreadNotifCount = customerNotifData?.unreadCount ?? 0;

  const activeUser = useMemo(() => {
    if (!rawUser) return null;
    return rawUser;
  }, [rawUser]);

  const [showHours, setShowHours] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

  const isAnyModalOpen = showTableInput || showHours || showNotifModal || showServiceModal;

  useEffect(() => {
    if (isAnyModalOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isAnyModalOpen]);

  const [addonOrderId, setAddonOrderId] = useState<string | null>(null);
  const [addonOrderNum, setAddonOrderNum] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedId = sessionStorage.getItem('qr_restaurant_addon_order_id');
      const storedNum = sessionStorage.getItem('qr_restaurant_addon_order_num');
      if (storedId) {
        setAddonOrderId(storedId);
        setAddonOrderNum(storedNum);
      }
    }
  }, []);

  // Sync addon order ID with active session; clear stale IDs when no active order for the current table
  useEffect(() => {
    if (tableAccessData?.data?.activeOrderId) {
      const actId = tableAccessData.data.activeOrderId;
      const actNum = tableAccessData.data.activeOrder?.orderNumber || actId.slice(-8).toUpperCase();
      setAddonOrderId(actId);
      setAddonOrderNum(actNum);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('qr_restaurant_addon_order_id', actId);
        sessionStorage.setItem('qr_restaurant_addon_order_num', actNum);
        localStorage.setItem(`active_table_order_id_${slug}`, actId);
        localStorage.setItem('active_table_order_id', actId);
      }
    } else {
      // No active order for this table – clear any stale addon IDs to avoid cross‑table add‑ons
      setAddonOrderId(null);
      setAddonOrderNum(null);
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('qr_restaurant_addon_order_id');
        sessionStorage.removeItem('qr_restaurant_addon_order_num');
        localStorage.removeItem(`active_table_order_id_${slug}`);
        localStorage.removeItem('active_table_order_id');
      }
    }
  }, [tableAccessData?.data?.activeOrderId, tableAccessData?.data?.activeOrder, slug]);

  const [recentOrders, setRecentOrders] = useState<Array<{ orderId: string; restaurantSlug: string; createdAt: number }>>([]);

  const [savedTable, setSavedTable] = useState<string | null>(null);
  const [savedToken, setSavedToken] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || isPreview) return;
    const tokenInQuery = searchParams?.token;

    if (tableNumber && tokenInQuery) {
      localStorage.setItem(`table_num_${slug}`, tableNumber);
      localStorage.setItem(`table_token_${slug}`, tokenInQuery);
      setSavedTable(tableNumber);
      setSavedToken(tokenInQuery);
    } else if (tableNumber && !tokenInQuery) {
      localStorage.setItem(`table_num_${slug}`, tableNumber);
      setSavedTable(tableNumber);
      if (searchParams?.table) {
        localStorage.removeItem(`table_token_${slug}`);
        setSavedToken(null);
      } else {
        setSavedToken(localStorage.getItem(`table_token_${slug}`));
      }
    } else {
      // Recover from localStorage on page refresh/reload without query params
      const storedNum = localStorage.getItem(`table_num_${slug}`);
      const storedTok = localStorage.getItem(`table_token_${slug}`);
      if (storedNum) setSavedTable(storedNum);
      if (storedTok) setSavedToken(storedTok);
    }
  }, [tableNumber, searchParams, slug, isPreview]);

  const displayTableNumber = isPreview ? (searchParams?.table || undefined) : (tableNumber || savedTable || manualTableNumber || undefined);
  const displayTableToken = isPreview ? (searchParams?.token || undefined) : (searchParams?.token || savedToken || undefined);




  useEffect(() => {
    const orders = localStorage.getItem('qr_restaurant_recent_orders');
    if (orders) {
      try {
        const parsed = JSON.parse(orders);
        if (Array.isArray(parsed)) {
          const now = Date.now();
          const filtered = parsed.filter(
            (o: any) =>
              o.restaurantSlug === slug &&
              o.orderId &&
              now - o.createdAt < 24 * 60 * 60 * 1000 // 24 hours
          );

          // Deduplicate by orderId
          const uniqueMap = new Map<string, any>();
          filtered.forEach((o: any) => {
            if (!uniqueMap.has(o.orderId)) {
              uniqueMap.set(o.orderId, o);
            }
          });
          const uniqueFiltered = Array.from(uniqueMap.values());
          setRecentOrders(uniqueFiltered);
        }
      } catch (e) {
        console.error('Failed to parse recent orders', e);
      }
    }
  }, [slug]);

  const { data: activeOrdersDetails } = useQuery({
    queryKey: ['active-orders', slug, recentOrders.map(o => o.orderId).join(',')],
    queryFn: async () => {
      if (recentOrders.length === 0) return [];
      const promises = recentOrders.map(async (o) => {
        try {
          const res = await api.get(`/orders/${o.orderId}`, { skipToast: true });
          return res.data.data.order;
        } catch (err: any) {
          const status = err?.response?.status;
          // If the order is forbidden (403) or not found (404), remove it from localStorage
          if (status === 404 || status === 403) {
            try {
              const orders = localStorage.getItem('qr_restaurant_recent_orders');
              if (orders) {
                let parsed = JSON.parse(orders);
                if (Array.isArray(parsed)) {
                  parsed = parsed.filter((item: any) => item.orderId !== o.orderId);
                  localStorage.setItem('qr_restaurant_recent_orders', JSON.stringify(parsed));
                  setRecentOrders((prev) => prev.filter((item) => item.orderId !== o.orderId));
                }
              }
            } catch (e) {
              console.error(e);
            }
          } else {
            console.warn(`Order ${o.orderId} fetch failed:`, err?.message ?? err);
          }
          return null;
        }
      });
      const results = await Promise.all(promises);
      const validOrders = results.filter(Boolean);

      // Deduplicate valid orders just in case
      const uniqueMap = new Map<string, any>();
      validOrders.forEach((order: any) => {
        if (!uniqueMap.has(order.id)) {
          uniqueMap.set(order.id, order);
        }
      });
      return Array.from(uniqueMap.values());
    },
    enabled: recentOrders.length > 0,
    refetchInterval: 60000,
  });

  // Previous Orders for logged-in users
  const { data: previousOrders } = useQuery({
    queryKey: ['previous-orders', slug],
    queryFn: async () => {
      const res = await api.get('/orders');
      const allOrders = res.data.data.orders as any[];
      return allOrders.filter((o: any) => o.restaurant.slug === slug);
    },
    enabled: !!activeUser,
    refetchInterval: 30000,
  });

  // Default tab selection on load
  useEffect(() => {
    if (activeOrdersDetails && activeOrdersDetails.length > 0) {
      setActiveTab('active');
    } else if (activeUser && previousOrders && previousOrders.length > 0) {
      setActiveTab('history');
    }
  }, [activeOrdersDetails, previousOrders, activeUser]);

  const handleDismissOrder = (orderId: string) => {
    try {
      const orders = localStorage.getItem('qr_restaurant_recent_orders');
      if (orders) {
        let parsed = JSON.parse(orders);
        if (Array.isArray(parsed)) {
          parsed = parsed.filter((o: any) => o.orderId !== orderId);
          localStorage.setItem('qr_restaurant_recent_orders', JSON.stringify(parsed));
          setRecentOrders(parsed.filter((o: any) => o.restaurantSlug === slug));
        }
      }
    } catch (e) {
      console.error('Failed to dismiss order', e);
    }
  };

  const getOrderStatusDetails = (status: string) => {
    switch (status) {
      case 'PENDING':
        return { label: 'Order Placed', color: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', progress: 20 };
      case 'CONFIRMED':
        return { label: 'Confirmed', color: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20', progress: 40 };
      case 'PREPARING':
      case 'BAKING':
        return { label: 'Preparing', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', progress: 60 };
      case 'READY':
        return { label: 'Ready', color: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20', progress: 80 };
      case 'ON_THE_WAY':
        return { label: 'Out for Delivery', color: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', progress: 90 };
      case 'DELIVERED':
        return { label: 'Served & Completed', color: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20', progress: 100 };
      case 'CANCELLED':
        return { label: 'Cancelled', color: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20', progress: 100 };
      default:
        return { label: 'Pending', color: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20', progress: 10 };
    }
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['menu', slug],
    queryFn: async () => {
      const response = await api.get(`/menu/${slug}`);
      return response.data.data as {
        restaurant: {
          id: string;
          name: string;
          slug: string;
          logo: string | null;
          banner: string | null;
          description: string | null;
          cuisineType: string | null;
          isOpen: boolean;
          operatingHours: Record<string, { open: string; close: string; closed: boolean }> | null;
          minOrderValue: number;
          themeColor: string | null;
          menuTemplate?: string | null;
          customFields?: Array<{ id: string; key: string; value: string; icon: string }> | null;
          featureFlags?: Record<string, boolean> | null;
        };
        categories: Array<{
          id: string;
          name: string;
          items: Array<{
            id: string;
            name: string;
            description: string | null;
            price: number;
            image: string | null;
            isVeg: boolean;
            isVegan: boolean;
            isAvailable: boolean;
            badges: string[];
            variants: Array<{ id: string; name: string; price: number }>;
            addOns: Array<{ id: string; name: string; price: number }>;
          }>;
        }>;
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  const restaurantPlatformType = (data?.restaurant as any)?.platformType || 'RESTAURANT';
  const isHotelPlatform = restaurantPlatformType === 'HOTEL';
  const isRestaurantPlatform = restaurantPlatformType === 'RESTAURANT';

  const isExplicitRoom = Boolean(
    (displayTableNumber &&
      (displayTableNumber.toLowerCase().includes('room') ||
        displayTableNumber.toLowerCase().includes('suite') ||
        displayTableNumber.toLowerCase().startsWith('rm') ||
        displayTableNumber.toLowerCase().includes('hotel'))) ||
    (manualTableNumber &&
      (manualTableNumber.toLowerCase().includes('room') ||
        manualTableNumber.toLowerCase().includes('suite'))) ||
    searchParams?.table?.toLowerCase().includes('room')
  );

  const isHotelRoom = isHotelPlatform ? true : isRestaurantPlatform ? false : isExplicitRoom;

  const currentThemeColor = searchParams?.themeColor || data?.restaurant?.themeColor;

  useEffect(() => {
    if (currentThemeColor) {
      applyThemeColor(currentThemeColor);
      if (typeof window !== 'undefined' && slug) {
        localStorage.setItem(`restaurant_theme_${slug}`, currentThemeColor);
      }
    } else if (typeof window !== 'undefined' && slug) {
      const cached = localStorage.getItem(`restaurant_theme_${slug}`);
      if (cached) {
        applyThemeColor(cached);
      }
    }
  }, [currentThemeColor, slug]);

  useEffect(() => {
    if (isHotelRoom) {
      setSelectedPurpose((prev) => (prev === 'Food & Cutlery' ? 'Room Cleaning' : prev));
    } else {
      setSelectedPurpose((prev) => (prev === 'Room Cleaning' ? 'Food & Cutlery' : prev));
    }
  }, [isHotelRoom]);

  const statusInfo = useMemo(() => {
    if (!data?.restaurant) return { status: 'CLOSED' as const, badgeText: 'Closed', detailText: 'Closed' };
    return getDetailedStatus(data.restaurant.operatingHours as any, data.restaurant.isOpen);
  }, [data]);

  const rawQrSettings = (data?.restaurant as any)?.qrSettings;
  const parsedQrSettings = useMemo(() => {
    if (!rawQrSettings) return null;
    if (typeof rawQrSettings === 'string') {
      try {
        return JSON.parse(rawQrSettings);
      } catch {
        return null;
      }
    }
    return rawQrSettings;
  }, [rawQrSettings]);

  const isQrDisabledGlobally = isMaintenanceFromApi || parsedQrSettings?.enabled === false;
  const disabledLocations: string[] = Array.isArray(parsedQrSettings?.disabledLocations)
    ? parsedQrSettings.disabledLocations
    : [];

  const activeLocation = displayTableNumber || tableNumber || savedTable;

  const isTableQrDisabledByAdmin =
    (data?.restaurant as any)?.platformType === 'HOTEL' ||
    (data?.restaurant as any)?.featureFlags?.callWaiterEnabled === false ||
    (data?.restaurant as any)?.featureFlags?.tableQrEnabled === false;

  const isRoomQrDisabledByAdmin =
    (data?.restaurant as any)?.platformType === 'RESTAURANT' ||
    (data?.restaurant as any)?.featureFlags?.roomServiceEnabled === false ||
    (data?.restaurant as any)?.featureFlags?.roomQrEnabled === false;

  const locationDisableReason = useMemo(() => {
    if (isQrDisabledGlobally) {
      return 'Digital QR Ordering is currently disabled for this restaurant by administration.';
    }
    if (activeLocation) {
      const cleanLoc = String(activeLocation).trim().toLowerCase();
      if (isHotelRoom) {
        if (isRoomQrDisabledByAdmin) {
          const roomLabel = cleanLoc.startsWith('room') ? activeLocation : `Room ${activeLocation}`;
          return `Hotel Room QR Service (${roomLabel}) is disabled by administration.`;
        }
      } else {
        if (isTableQrDisabledByAdmin) {
          const tableLabel = cleanLoc.startsWith('table') ? activeLocation : `Table ${activeLocation}`;
          return `Dine-In Table QR Ordering (${tableLabel}) is disabled by administration.`;
        }
      }
      if (disabledLocations.some((d) => String(d).trim().toLowerCase() === cleanLoc)) {
        const locLabel = isHotelRoom
          ? (cleanLoc.startsWith('room') ? activeLocation : `Room ${activeLocation}`)
          : (cleanLoc.startsWith('table') ? activeLocation : `Table ${activeLocation}`);
        return `Ordering for ${locLabel} is temporarily disabled by restaurant management.`;
      }
    }
    return null;
  }, [isQrDisabledGlobally, activeLocation, isHotelRoom, isRoomQrDisabledByAdmin, isTableQrDisabledByAdmin, disabledLocations]);

  const isLocationDisabled = !!locationDisableReason;

  useEffect(() => {
    if (data?.restaurant) {
      setRestaurant(slug, data.restaurant.id);
    }
  }, [data, slug, setRestaurant]);

  // Ordering location is already shown clearly in the header pill; no toast popup on every request/mount.

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 500);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Clean up cooldown timer on unmount
  useEffect(() => {
    return () => {
      clearWaiterTimers();
    };
  }, [clearWaiterTimers]);

  const handleCallWaiter = useCallback(async (
    tableNum?: string,
    purpose?: string,
    customNote?: string
  ) => {
    const storedTable = typeof window !== 'undefined' ? localStorage.getItem(`table_num_${slug}`) : null;
    const effectiveTable = tableNum || tableNumber || manualTableNumber || storedTable;

    if (!effectiveTable || !String(effectiveTable).trim()) {
      setShowTableInput(true);
      return;
    }

    const cleanTable = String(effectiveTable).trim();
    const isRoom = isHotelPlatform ? true : isRestaurantPlatform ? false : (cleanTable.toLowerCase().includes('room') || cleanTable.toLowerCase().includes('suite'));
    const label = isRoom ? (cleanTable.toLowerCase().startsWith('room') ? cleanTable : `Room ${cleanTable}`) : `Table ${cleanTable}`;

    const flags = (data?.restaurant as any)?.featureFlags || {};
    if (isRoom && flags.roomServiceEnabled === false) {
      toast.error('Hotel room service is currently disabled for this restaurant by administration.');
      return;
    }
    if (!isRoom && flags.callWaiterEnabled === false) {
      toast.error('Waiter call service is currently disabled for this restaurant by administration.');
      return;
    }

    if (waiterLoading) return;

    setWaiterLoading(true);
    try {
      let token = tableToken || searchParams?.t || searchParams?.token || (typeof window !== 'undefined' ? localStorage.getItem(`table_token_${slug}`) : '') || '';
      if (!token) {
        try {
          token = generateTableToken(slug, cleanTable);
        } catch {
          token = '';
        }
      }

      const chosenPurpose = purpose || (isRoom ? 'Room Cleaning' : 'General Assistance');
      await api.post(`/menu/${slug}/call-waiter`, {
        tableNumber: cleanTable,
        tableToken: token,
        purpose: chosenPurpose,
        customNote: customNote?.trim() || undefined,
      });

      if (typeof window !== 'undefined') {
        localStorage.setItem(`table_num_${slug}`, cleanTable);
        if (token) {
          localStorage.setItem(`table_token_${slug}`, token);
        }
      }
      setManualTableNumber(cleanTable);

      if (socketRef.current && data?.restaurant?.id) {
        socketRef.current.emit('join:table', { restaurantId: data.restaurant.id, tableNumber: cleanTable });
      }

      toast.success(
        isRoom
          ? `🛎️ Room service requested for ${label}!`
          : `🙋 Waiter called for ${label}!`,
        {
          description: customNote?.trim()
            ? `${chosenPurpose} — "${customNote.trim()}"`
            : `${chosenPurpose}. Staff will arrive shortly.`,
          duration: 5000,
        }
      );

      setShowServiceModal(false);
      setShowTableInput(false);
      setCustomServiceNote('');
      setIsEditingLocation(false);
      startPendingState(cleanTable, 30);
    } catch (err: any) {
      const isServerDown = err.code === 'ERR_NETWORK' || !err.response || err.response?.status >= 500;
      if (!isServerDown) {
        const errMsg = err.response?.data?.error || err.response?.data?.message || 'Could not send request. Please try again.';
        toast.error(errMsg);
      }
    } finally {
      setWaiterLoading(false);
    }
  }, [slug, tableNumber, manualTableNumber, tableToken, waiterStatus, waiterLoading, searchParams, startPendingState, isHotelPlatform, isRestaurantPlatform, data]);

  useEffect(() => {
    if (!data?.restaurant?.id) return;
    const socket = io(getSocketUrl(), {
      transports: ['polling', 'websocket'],
      withCredentials: true,
    });
    socketRef.current = socket;

    const joinCustomerRooms = () => {
      if (activeUser?.id) {
        socket.emit('join:user', activeUser.id);
      }
      if (data?.restaurant?.id) {
        socket.emit('join:restaurant', data.restaurant.id);
      }
      const storedTable = typeof window !== 'undefined' ? localStorage.getItem(`table_num_${slug}`) : null;
      const activeTable = tableNumber || manualTableNumber || storedTable;
      if (activeTable) {
        socket.emit('join:table', { restaurantId: data.restaurant.id, tableNumber: String(activeTable).trim() });
      }
      recentOrders.forEach((o) => {
        if (o.orderId) {
          socket.emit('join:order', o.orderId);
        }
      });
    };

    socket.on('connect', joinCustomerRooms);
    socket.on('connect_error', (err) => {
      console.warn('Real-time socket notice:', err.message);
    });
    joinCustomerRooms();

    const handleWaiterResponded = (resData: { tableNumber?: string; message?: string }) => {
      const currentTable = tableNumber || manualTableNumber || (typeof window !== 'undefined' ? localStorage.getItem(`table_num_${slug}`) : null);
      if (!currentTable || !resData?.tableNumber) return;
      if (String(currentTable).trim() === String(resData.tableNumber).trim()) {
        processRealTimeEvent('waiter_called', () => {
          startComingTimer(60, resData.tableNumber);
          setCustomerAlert({
            isOpen: true,
            type: 'WAITER_COMING',
            title: '👨‍🍳 Waiter Is Coming!',
            message: resData.message || `Waiter is coming in a few minutes to ${formatTableLabel(resData.tableNumber)}!`,
            tableNumber: resData.tableNumber,
            timerSeconds: 60,
          });
        });
      }
    };

    socket.on('waiter:responded', handleWaiterResponded);
    socket.on('waiter_responded', handleWaiterResponded);

    const handleWaiterDismissed = (resData: { tableNumber?: string; message?: string }) => {
      const currentTable = tableNumber || manualTableNumber || (typeof window !== 'undefined' ? localStorage.getItem(`table_num_${slug}`) : null);
      if (!currentTable || !resData?.tableNumber) return;
      if (String(currentTable).trim() === String(resData.tableNumber).trim()) {
        processRealTimeEvent('order_cancelled', () => {
          startOccupiedTimer(50, resData.tableNumber);
          setCustomerAlert({
            isOpen: true,
            type: 'WAITER_OCCUPIED',
            title: '⏳ Waiter Is Busy Right Now',
            message: resData.message || `Waiter is busy right now. You can call again after 50 seconds.`,
            tableNumber: resData.tableNumber,
            timerSeconds: 50,
          });
        });
      }
    };

    socket.on('waiter:dismissed', handleWaiterDismissed);
    socket.on('waiter_dismissed', handleWaiterDismissed);

    socket.on('notification:new', () => {
      queryClient.invalidateQueries({ queryKey: ['customer-notifications-count'] });
    });

    const handleOrderStatusUpdated = (payload: { orderId?: string; status?: string; paymentStatus?: string; reason?: string; userId?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['active-orders'] });
      queryClient.invalidateQueries({ queryKey: ['previous-orders'] });

      const isMyOrder = !payload?.orderId || recentOrders.some((o) => o.orderId === payload.orderId) || (activeUser?.id && payload?.userId === activeUser.id);
      if (!isMyOrder) return;

      if (payload?.paymentStatus === 'PAID') {
        processRealTimeEvent('order_status_changed', () => {
          playNewOrderSound();
          setCustomerAlert({
            isOpen: true,
            type: 'PAYMENT_CONFIRMED',
            title: '🎉 Payment Confirmed!',
            message: 'Your bill payment has been successfully completed. How was your food and service today? Please share a quick review!',
            orderId: payload?.orderId,
            actionUrl: payload?.orderId ? `/r/${slug}/order/${payload.orderId}` : undefined,
            actionLabel: '⭐ Rate & Review Order',
          });
        });
        return;
      }

      const isCancelled = payload?.status === 'CANCELLED';
      const eventType = isCancelled ? 'order_cancelled' : 'order_status_changed';

      const statusMap: Record<string, { label: string; text: string; icon: string }> = {
        CONFIRMED: { label: 'Order Confirmed', text: 'The restaurant has confirmed your order!', icon: '✅' },
        PREPARING: { label: 'Preparing Order', text: 'The kitchen has started preparing your delicious food!', icon: '👨‍🍳' },
        BAKING: { label: 'Cooking & Baking', text: 'Your food is in the kitchen oven/stove!', icon: '🔥' },
        READY: { label: 'Order Ready!', text: 'Your order is ready to be served!', icon: '🍽️' },
        ON_THE_WAY: { label: 'Out for Delivery', text: 'Your order is on the way!', icon: '🚴' },
        DELIVERED: { label: 'Served & Completed', text: 'Your order has been served. Enjoy your meal!', icon: '🎉' },
        CANCELLED: { label: 'Order Cancelled', text: payload?.reason ? `Order cancelled: ${payload.reason}` : 'Your order was cancelled by the restaurant.', icon: '❌' },
      };

      const info = payload?.status && statusMap[payload.status] ? statusMap[payload.status] : {
        label: `Order ${payload?.status ? payload.status.replace(/_/g, ' ') : 'Updated'}`,
        text: `Your order status was updated to ${payload?.status || 'UPDATED'}.`,
        icon: '🔔',
      };

      processRealTimeEvent(
        eventType,
        () => {
          if (isCancelled) {
            setCustomerAlert({
              isOpen: true,
              type: 'ORDER_UPDATE',
              title: `${info.icon} ${info.label}`,
              message: info.text,
              orderId: payload?.orderId,
              orderStatus: payload?.status,
            });
          }
        },
        {
          title: `${info.icon} ${info.label}`,
          body: info.text,
          tag: `customer-order-${payload?.orderId || Date.now()}`,
        }
      );
    };

    socket.on('order:status_updated', handleOrderStatusUpdated);
    socket.on('order_status_changed', handleOrderStatusUpdated);

    socket.on('order_cancelled', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['active-orders'] });
      queryClient.invalidateQueries({ queryKey: ['previous-orders'] });
      const isMyOrder = !payload?.orderId || recentOrders.some((o) => o.orderId === payload.orderId) || (activeUser?.id && payload?.userId === activeUser.id);
      if (!isMyOrder) return;

      processRealTimeEvent(
        'order_cancelled',
        () => {
          setCustomerAlert({
            isOpen: true,
            type: 'ORDER_UPDATE',
            title: '⚠️ Order Cancelled',
            message: payload?.reason ? `Order cancelled: ${payload.reason}` : 'Your order was cancelled.',
            orderId: payload?.orderId,
            orderStatus: 'CANCELLED',
          });
        },
        {
          title: '⚠️ Order Cancelled',
          body: payload?.reason ? `Order cancelled: ${payload.reason}` : 'Your order was cancelled.',
          tag: `customer-cancel-${payload?.orderId || Date.now()}`,
        }
      );
    });

    socket.on('driver_assigned', (payload: any) => {
      queryClient.invalidateQueries({ queryKey: ['active-orders'] });
      const isMyOrder = !payload?.orderId || recentOrders.some((o) => o.orderId === payload.orderId) || (activeUser?.id && payload?.userId === activeUser.id);
      if (!isMyOrder) return;

      processRealTimeEvent(
        'driver_assigned',
        () => {
          setCustomerAlert({
            isOpen: true,
            type: 'ORDER_UPDATE',
            title: '🚗 Driver Assigned',
            message: 'A driver has been assigned to your order!',
            orderId: payload?.orderId,
            orderStatus: payload?.status || 'ON_THE_WAY',
          });
        },
        {
          title: '🚗 Driver Assigned',
          body: 'A driver has been assigned to your order!',
          tag: `customer-driver-${payload?.orderId || Date.now()}`,
        }
      );
    });

    // Add-on order socket listeners — update queries silently without blocking popup
    const handleTableSessionAddon = (payload: any) => {
      const session = payload?.session;
      if (session?.event === 'ITEMS_ADDED') {
        // Invalidate table access and order queries so UI reflects new items
        queryClient.invalidateQueries({ queryKey: ['table-access'] });
        queryClient.invalidateQueries({ queryKey: ['active-orders'] });
        queryClient.invalidateQueries({ queryKey: ['table-session-status'] });
      }
    };

    socket.on('table-session:updated', handleTableSessionAddon);

    const handleQrServiceToggled = (payload: any) => {
      // Guard: strictly ignore events intended for other restaurants
      if (payload?.restaurantId && data?.restaurant?.id && payload.restaurantId !== data.restaurant.id) {
        return;
      }
      if (payload?.restaurantSlug && slug && payload.restaurantSlug.toLowerCase() !== slug.toLowerCase()) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['menu', slug] });
      if (payload?.enabled === false) {
        setIsMaintenanceFromApi(true);
      } else if (payload?.enabled === true) {
        setIsMaintenanceFromApi(false);
      }
    };
    socket.on('restaurant:qr_service_toggled', handleQrServiceToggled);

    const handleCouponsUpdated = (payload?: any) => {
      // Guard: strictly ignore coupon updates intended for other restaurants
      if (payload?.restaurantId && data?.restaurant?.id && payload.restaurantId !== data.restaurant.id) {
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['coupon-suggestion'] });
      queryClient.invalidateQueries({ queryKey: ['public-coupons'] });
    };
    socket.on('coupons:updated', handleCouponsUpdated);
    socket.on('coupon:updated', handleCouponsUpdated);

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [data?.restaurant?.id, tableNumber, manualTableNumber, activeUser?.id, queryClient, recentOrders, slug, startComingTimer, startOccupiedTimer]);

  const filteredCategories = useMemo(() => {
    if (!data) return [];
    return data.categories
      .map((cat) => ({
        ...cat,
        items: cat.items
          .filter((item) => {
            const matchesSearch =
              !searchQuery ||
              item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
              item.description?.toLowerCase().includes(searchQuery.toLowerCase());

            const matchesFilter =
              activeFilter === 'ALL' ||
              (activeFilter === 'VEG' && item.isVeg && !item.isVegan) ||
              (activeFilter === 'NON_VEG' && !item.isVeg) ||
              (activeFilter === 'VEGAN' && item.isVegan);

            const matchesMaxPrice = maxPrice === null || item.price <= maxPrice;

            return matchesSearch && matchesFilter && matchesMaxPrice;
          })
          .sort((a, b) => {
            if (priceSort === 'LOW_TO_HIGH') return a.price - b.price;
            if (priceSort === 'HIGH_TO_LOW') return b.price - a.price;
            return 0;
          }),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [data, searchQuery, activeFilter, maxPrice, priceSort]);

  const suggestedAddons = useMemo(() => {
    if (!data?.categories || data.categories.length === 0) return [];
    const allItems = data.categories.flatMap((cat) =>
      (cat.items || []).filter((item) => item.isAvailable).map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        image: item.image,
        isVeg: item.isVeg,
        categoryName: cat.name,
        description: item.description,
      }))
    );

    const priorityRegex = /(beverage|drink|shake|dessert|sweet|ice cream|side|snack|starter|appetizer|cooler|juice|chai|coffee)/i;
    const prioritized = allItems.filter(
      (item) => priorityRegex.test(item.categoryName || '') || priorityRegex.test(item.name)
    );
    return prioritized.length > 0 ? prioritized : allItems.slice(0, 8);
  }, [data]);

  const cartCount = itemCount();

  if (isLoading) {
    return <MenuSkeleton />;
  }

  const isSuspended =
    ((error as any)?.response?.status === 403 &&
      ((error as any)?.response?.data?.code === 'RESTAURANT_SUSPENDED' ||
        (error as any)?.response?.data?.error === 'RESTAURANT_SUSPENDED')) ||
    Boolean((data?.restaurant as any)?.isSuspended);

  if (isSuspended) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full bg-card border border-rose-500/20 rounded-3xl p-8 shadow-2xl space-y-5 text-center my-auto"
        >
          <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mx-auto text-rose-500">
            <Ban className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/25 inline-block">
              Service Unavailable
            </span>
            <h2 className="text-xl sm:text-2xl font-display font-black text-foreground">
              Restaurant Suspended
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {(error as any)?.response?.data?.message || 'This restaurant has been temporarily suspended by administration. Digital ordering and menu browsing are currently offline.'}
            </p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (error || !data || !data.restaurant) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8 text-center">
        <div className="text-6xl mb-4">🔍</div>
        <h2 className="text-2xl font-display font-bold mb-2">Restaurant Not Found</h2>
        <p className="text-muted-foreground">This restaurant may have moved or is temporarily unavailable.</p>
      </div>
    );
  }

  if (isQrDisabledGlobally && !isPreview) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6 text-center">
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md w-full bg-card border border-amber-500/20 rounded-3xl p-8 shadow-2xl space-y-5 text-center my-auto"
        >
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-amber-500">
            <Wrench className="w-8 h-8 animate-pulse" />
          </div>
          <div className="space-y-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 inline-block">
              QR Service Temporarily Paused
            </span>
            <h2 className="text-xl sm:text-2xl font-display font-black text-foreground">
              Currently maintenance is going on kindly order normally!
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Digital QR ordering is temporarily paused for maintenance at {data.restaurant.name}. Please place your order directly with the waiter or staff at the counter.
            </p>
          </div>
          {(data.restaurant as any)?.phone && (
            <div className="pt-2">
              <a
                href={`tel:${(data.restaurant as any).phone}`}
                className="inline-flex items-center gap-2 text-xs font-semibold text-primary bg-primary/10 hover:bg-primary/20 px-4 py-2.5 rounded-xl transition-colors"
              >
                <span>Call Restaurant: {(data.restaurant as any).phone}</span>
              </a>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  const { restaurant, categories = [] } = data;

  const themeColor = isPreview && searchParams?.themeColor ? searchParams.themeColor : (restaurant.themeColor ?? '#E85D04');
  const restaurantName = isPreview && searchParams?.name !== undefined ? searchParams.name : restaurant.name;
  const restaurantDesc = isPreview && searchParams?.description !== undefined ? searchParams.description : restaurant.description;
  const restaurantLogo = isPreview && searchParams?.logo !== undefined ? (searchParams.logo || null) : restaurant.logo;
  const restaurantBanner = isPreview && searchParams?.banner !== undefined ? (searchParams.banner || null) : restaurant.banner;

  return (
    <div className="min-h-screen bg-background pb-28 sm:pb-32 relative w-full max-w-full overflow-x-hidden min-w-0">
      {isPreview && (
        <style>{`
          [data-sonner-toaster], .data-sonner-toaster {
            display: none !important;
          }
        `}</style>
      )}

      {/* Occupied Table Access Control Screen */}
      {tableLockedState?.locked && !isPreview && (
        <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center p-4 sm:p-6 overflow-y-auto">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="max-w-md w-full bg-card border border-border/80 rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6 text-center my-auto"
          >
            {/* Header */}
            <div className="space-y-2">
              <span className="text-[11px] font-extrabold uppercase tracking-wider px-3 py-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/25 inline-block">
                {tableLockedState.tableNumber || 'Table'}
              </span>
              <h2 className="text-xl sm:text-2xl font-display font-black text-foreground">
                TABLE ALREADY OCCUPIED
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                An active order already exists for this table.
              </p>
            </div>

            {/* SECTION A: Add items to current bill */}
            <div className="p-4 sm:p-5 rounded-2xl bg-muted/40 border border-border/60 text-left space-y-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Joining friends at this table?
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  Enter the 4-digit Order Verification Code shown on the phone of the person who started this table's order.
                </p>
              </div>

              <div className="space-y-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={tableAccessCodeInput}
                  onChange={(e) => {
                    setTableAccessCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4));
                    setAccessCodeError(null);
                  }}
                  placeholder="e.g. 4821"
                  className="w-full text-center text-xl font-mono tracking-widest py-3 px-3 rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary font-bold shadow-xs"
                />
                {accessCodeError && (
                  <p className="text-xs text-destructive font-medium text-center">
                    {accessCodeError}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={handleValidateTableAccessCode}
                disabled={isValidatingCode || tableAccessCodeInput.length !== 4}
                className="w-full py-3 px-4 rounded-xl bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 active:scale-95"
              >
                {isValidatingCode ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                <span>Join Table &amp; Add Items</span>
              </button>
            </div>

            {/* SECTION B: Is this table physically empty? */}
            <div className="p-4 sm:p-5 rounded-2xl bg-muted/40 border border-border/60 text-left space-y-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  Is this table physically empty?
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                  If the previous guests have left, you can request assistance from the restaurant staff.
                </p>
              </div>

              <button
                type="button"
                onClick={handleCallWaiterFromOccupied}
                disabled={isCallingWaiterFromOccupied || waiterCalledSuccess}
                className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border shadow-sm ${waiterCalledSuccess
                  ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                  : 'border-border text-foreground hover:bg-muted active:scale-95'
                  }`}
              >
                {isCallingWaiterFromOccupied ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : waiterCalledSuccess ? (
                  <Check className="w-4 h-4 text-emerald-600" />
                ) : (
                  <Phone className="w-4 h-4 text-muted-foreground" />
                )}
                <span>{waiterCalledSuccess ? 'Waiter Notified — Please Wait' : 'Call Waiter'}</span>
              </button>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={() => refetchTableAccess()}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh Table Status</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
      {isLocationDisabled && !isPreview && (
        <div className="bg-red-600 text-white px-4 py-2.5 text-center text-xs sm:text-sm font-bold shadow-lg flex items-center justify-center gap-2 relative z-40 border-b border-red-700">
          <Ban className="w-4 h-4 shrink-0" />
          <span>
            {isHotelRoom
              ? `Room Service Ordering for ${activeLocation ? (activeLocation.toLowerCase().startsWith('room') ? activeLocation : `Room ${activeLocation}`) : 'this room'} is currently disabled by management. Please contact reception.`
              : `Table Ordering for ${activeLocation ? (activeLocation.toLowerCase().startsWith('table') ? activeLocation : `Table ${activeLocation}`) : 'this table'} is currently disabled by management. Please speak with staff.`
            }
          </span>
        </div>
      )}
      {/* Sticky Navigation Header */}
      <div className="sticky top-0 left-0 right-0 z-30 flex items-center justify-between px-3 sm:px-4 py-3 bg-background/90 backdrop-blur-md border-b border-border/40 shadow-sm gap-2 min-w-0 max-w-full">
        <div className="flex items-center gap-1.5 text-foreground shrink-0 select-none">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center shadow-md text-white" style={{ backgroundColor: themeColor }}>
            <QrCode className="w-4 h-4 text-white" />
          </div>
          <span className="font-display font-bold text-xs sm:text-sm tracking-tight hidden sm:block truncate max-w-[120px] md:max-w-none text-foreground">{restaurantName || 'Digital Menu'}</span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2.5 overflow-x-auto no-scrollbar py-0.5 shrink min-w-0 touch-pan-x">
          {/* Notifications Bell Button */}
          {activeUser && (
            <button
              onClick={() => setShowNotifModal(true)}
              className="relative p-1.5 sm:p-2 bg-muted hover:bg-muted/80 border border-border rounded-lg text-foreground transition-all active:scale-95 flex items-center justify-center shrink-0 min-h-[36px] min-w-[36px]"
              title="Notifications"
            >
              <Bell className="w-3.5 h-3.5" />
              {unreadNotifCount > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 text-white rounded-full text-[9px] font-extrabold flex items-center justify-center animate-pulse">
                  {unreadNotifCount}
                </span>
              )}
            </button>
          )}

          {activeUser && activeUser.role !== 'CUSTOMER' && (
            <div className="flex items-center gap-1 sm:gap-2 shrink-0">
              <span className="text-xs text-muted-foreground font-semibold bg-muted px-2.5 py-1.5 rounded-lg hidden sm:inline-block">
                Hi, {activeUser.name.split(' ')[0]}
              </span>
              <Link
                href={activeUser.role === 'SUPER_ADMIN' ? '/admin/dashboard' : '/owner/dashboard'}
                className="text-[10px] sm:text-xs bg-primary hover:bg-primary/95 border border-primary/20 px-2 sm:px-2.5 py-1.5 rounded-lg text-white font-semibold shadow-sm transition-all whitespace-nowrap shrink-0"
              >
                Dashboard
              </Link>
              <button
                onClick={() => {
                  logout();
                  toast.success('Logged out successfully');
                }}
                className="text-[10px] sm:text-xs bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 px-2 sm:px-2.5 py-1.5 rounded-lg text-red-600 dark:text-red-400 font-semibold shadow-sm transition-all whitespace-nowrap shrink-0"
              >
                Logout
              </button>
            </div>
          )}
          <ThemeToggle size="sm" className="shrink-0" />
        </div>
      </div>
      {!isJoinedViaCode && tableAccessData?.data?.role !== 'SECONDARY' && addonOrderId && (
        <div className="bg-amber-500 text-white text-xs font-semibold px-4 py-3 flex items-center justify-between shadow-md">
          <div className="flex items-center gap-2">
            <span>📝</span>
            <span>You are adding items to your active Order #{addonOrderNum}. Added items will show at checkout.</span>
          </div>
          <button
            onClick={() => {
              sessionStorage.removeItem('qr_restaurant_addon_order_id');
              sessionStorage.removeItem('qr_restaurant_addon_order_num');
              setAddonOrderId(null);
              setAddonOrderNum(null);
              toast.info('Cancelled adding items to order.');
            }}
            className="bg-white/20 hover:bg-white/30 text-white px-2 py-1 rounded-md transition-colors"
          >
            Cancel Add-on
          </button>
        </div>
      )}
      {locationDisableReason && !isPreview && (
        <div className="bg-red-600 text-white text-xs font-semibold px-4 py-3 flex items-center justify-between shadow-md border-b border-red-700">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 shrink-0" />
            <span>{locationDisableReason} Menu browsing is available, but ordering and staff calls are locked.</span>
          </div>
        </div>
      )}
      {/* Banner */}
      <div className="relative h-48 md:h-64 w-full overflow-hidden">
        {restaurantBanner ? (
          <img src={restaurantBanner} alt={restaurantName || 'Banner'} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full" style={{ backgroundColor: themeColor }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/20 to-transparent" />
      </div>

      {/* Restaurant Header Info */}
      <div className="px-4 md:px-8 -mt-16 relative z-10 mb-6 min-w-0 max-w-full">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4 min-w-0">
          {/* Identity row: logo + name + status */}
          <div className="flex items-end gap-3.5 min-w-0 flex-1">
            {restaurantLogo ? (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden border-4 border-background shadow-xl shrink-0">
                <img src={restaurantLogo} alt={restaurantName || 'Logo'} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl border-4 border-background shadow-xl shrink-0 flex items-center justify-center text-2xl sm:text-3xl text-white font-bold"
                style={{ backgroundColor: themeColor }}>
                {restaurantName?.[0] ?? '🍽️'}
              </div>
            )}
            <div className="flex-1 min-w-0 pb-1">
              <div className="flex items-center gap-2 flex-wrap relative min-w-0">
                <h1 className="font-display text-lg sm:text-2xl md:text-3xl font-bold text-foreground truncate max-w-[170px] min-[400px]:max-w-[240px] sm:max-w-none">
                  {restaurantName}
                </h1>

                {/* Interactive Status Badge & Weekly Hours Dropdown */}
                <div className="relative shrink-0">
                  <button
                    onClick={() => setShowHours(!showHours)}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-full text-[10px] sm:text-xs font-semibold shadow-sm transition-all whitespace-nowrap hover:scale-105 active:scale-95 ${statusInfo.status === 'OPEN'
                      ? 'bg-green-500/10 text-green-600 border border-green-500/20 dark:bg-green-500/20 dark:text-green-400'
                      : statusInfo.status === 'TEMPORARILY_CLOSED'
                        ? 'bg-amber-500/10 text-amber-600 border border-amber-500/20 dark:bg-amber-500/20 dark:text-amber-400'
                        : 'bg-red-500/10 text-red-600 border border-red-500/20 dark:bg-red-500/20 dark:text-red-400'
                      }`}
                  >
                    <span className={`w-2 h-2 rounded-full animate-pulse shrink-0 ${statusInfo.status === 'OPEN'
                      ? 'bg-green-500'
                      : statusInfo.status === 'TEMPORARILY_CLOSED'
                        ? 'bg-amber-500'
                        : 'bg-red-500'
                      }`} />
                    <span className="whitespace-nowrap">{statusInfo.badgeText}</span>
                    <span className="text-[10px] opacity-75 font-normal whitespace-nowrap">({statusInfo.detailText})</span>
                    <Clock className="w-3 h-3 ml-0.5 opacity-60 shrink-0" />
                  </button>

                  {/* Dropdown Weekly Hours */}
                  <AnimatePresence>
                    {showHours && restaurant.operatingHours && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowHours(false)} />
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="absolute left-0 mt-2 z-50 w-72 bg-card/95 backdrop-blur-md border border-border shadow-2xl rounded-2xl p-4 text-card-foreground"
                        >
                          <div className="flex items-center justify-between mb-3 pb-2 border-b border-border">
                            <h4 className="font-semibold text-sm flex items-center gap-1.5">
                              <Clock className="w-4 h-4 text-primary" /> Weekly Hours
                            </h4>
                            <button onClick={() => setShowHours(false)} className="text-muted-foreground hover:text-foreground">
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="space-y-2">
                            {['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((day) => {
                              const dayHours = (restaurant.operatingHours as any)?.[day];
                              const isToday = new Date().getDay() === ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf(day);
                              return (
                                <div
                                  key={day}
                                  className={`flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg transition-colors ${isToday
                                    ? 'bg-primary/10 text-primary border border-primary/20 font-semibold shadow-sm'
                                    : 'text-muted-foreground'
                                    }`}
                                >
                                  <span className="capitalize">{day}</span>
                                  <span>
                                    {dayHours?.closed || !dayHours?.open
                                      ? 'Closed'
                                      : `${formatTime12h(dayHours.open)} - ${formatTime12h(dayHours.close)}`}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              {restaurant.cuisineType && (
                <p className="text-muted-foreground text-xs sm:text-sm mt-0.5 truncate">{restaurant.cuisineType}</p>
              )}
              {displayTableNumber && (
                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-bold mt-1" style={{ color: themeColor }}>
                  {isHotelRoom ? (
                    <>
                      <Bed className="w-3.5 h-3.5 shrink-0" />
                      {displayTableNumber.toLowerCase().startsWith('room') || displayTableNumber.toLowerCase().startsWith('suite')
                        ? displayTableNumber
                        : `Room ${displayTableNumber}`}
                    </>
                  ) : (
                    <>
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      Table {displayTableNumber}
                    </>
                  )}
                </div>
              )}

              {/* Joined to Table Code Badge — shown when joined via table code / secondary device */}
              {(tableAccessData?.data?.role === 'SECONDARY' || isJoinedViaCode) && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 rounded-full text-xs font-bold shadow-xs">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>Joined to Table Code</span>
                </div>
              )}

              {/* Ongoing Table Order Tracking Banner */}
              {tableAccessData?.data?.activeOrderId && tableAccessData?.data?.role !== 'SECONDARY' && !addonOrderNum && (
                tableAccessData.data.activeOrder?.status === 'DELIVERED' ? (
                  <div className="mt-2.5 w-full p-2.5 bg-emerald-500/10 border border-emerald-500/25 rounded-xl flex items-center justify-between gap-2 shadow-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">✅</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-foreground truncate">
                          Order #{tableAccessData.data.activeOrder?.orderNumber || tableAccessData.data.activeOrderId.slice(-6).toUpperCase()} Served
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          Need more? Add items from the menu anytime
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/r/${slug}/order/${tableAccessData.data.activeOrderId}`}
                      className="px-3 py-1.5 text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition shrink-0 flex items-center gap-1"
                    >
                      <span>{(data?.restaurant as any)?.featureFlags?.kotMode === 'PRINT_KOT' ? 'View Bill' : 'View Order'}</span>
                      <ChevronRight className="w-3 h-3" />
                    </Link>
                  </div>
                ) : (
                  <div className="mt-3 w-full p-3.5 bg-gradient-to-r from-emerald-500/15 via-emerald-500/10 to-transparent border border-emerald-500/35 rounded-2xl flex flex-col gap-2.5 shadow-sm overflow-hidden">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold text-sm shrink-0">
                        🍽️
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                            Table Order in Progress #{tableAccessData.data.activeOrder?.orderNumber || tableAccessData.data.activeOrderId.slice(-6).toUpperCase()}
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {(data?.restaurant as any)?.featureFlags?.kotMode === 'PRINT_KOT'
                              ? (tableAccessData.data.activeOrder?.status === 'CONFIRMED' ? 'In Kitchen' : (tableAccessData.data.activeOrder?.status || 'In Kitchen'))
                              : (tableAccessData.data.activeOrder?.status || 'In Kitchen')}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
                          {(data?.restaurant as any)?.featureFlags?.kotMode === 'PRINT_KOT'
                            ? 'Any items you add will be printed and sent to the kitchen.'
                            : 'Any items you add will be appended to this ongoing order. Live tracking shared across table.'}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/r/${slug}/order/${tableAccessData.data.activeOrderId}`}
                      className="w-full text-center px-3.5 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm transition active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      <span>{(data?.restaurant as any)?.featureFlags?.kotMode === 'PRINT_KOT' ? 'View Order & Bill' : 'Track Order Live'}</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                )
              )}
            </div>
          </div>

          {/* Upper Section Responsive Call Waiter / Room Service Button */}
          {(() => {
            const isServiceDisabled =
              (isHotelRoom && isRoomQrDisabledByAdmin) ||
              (!isHotelRoom && isTableQrDisabledByAdmin);
            const isTimerActive = waiterStatus !== 'IDLE';
            const isButtonDisabled = waiterLoading || isServiceDisabled || isTimerActive;

            return (
              <div className="shrink-0 w-full sm:w-auto flex flex-col gap-2">
                <motion.button
                  type="button"
                  whileHover={{ scale: isButtonDisabled ? 1 : 1.02 }}
                  whileTap={{ scale: isButtonDisabled ? 1 : 0.98 }}
                  onClick={(e) => {
                    e.preventDefault();
                    if (isServiceDisabled) {
                      toast.error(isHotelRoom ? 'Hotel room service is currently disabled by administration.' : 'Waiter calling is currently disabled by administration.');
                      return;
                    }
                    if (isTimerActive) {
                      return; // Completely non-clickable while countdown / active timer is running
                    }
                    if (!displayTableNumber && !manualTableNumber) {
                      setShowTableInput(true);
                      return;
                    }
                    handleCallWaiter(displayTableNumber || manualTableNumber, undefined, customServiceNote);
                  }}
                  disabled={isButtonDisabled}
                  style={{
                    backgroundColor:
                      isServiceDisabled
                        ? '#64748b'
                        : waiterStatus === 'COMING'
                          ? '#059669'
                          : waiterStatus === 'OCCUPIED'
                            ? '#475569'
                            : waiterStatus === 'PENDING'
                              ? '#f59e0b'
                              : themeColor,
                    borderColor:
                      isServiceDisabled
                        ? '#475569'
                        : waiterStatus === 'COMING'
                          ? '#047857'
                          : waiterStatus === 'OCCUPIED'
                            ? '#334155'
                            : waiterStatus === 'PENDING'
                              ? '#d97706'
                              : 'transparent',
                    opacity: isServiceDisabled ? 0.65 : 1,
                  }}
                  className={`w-full sm:w-auto px-5 py-3 rounded-2xl sm:rounded-full text-white font-extrabold text-sm sm:text-base shadow-xl flex items-center justify-center gap-2 transition-all border whitespace-nowrap ${isButtonDisabled ? 'cursor-not-allowed opacity-90 select-none' : 'cursor-pointer hover:opacity-95'}`}
                >
                  <BellRing className={`w-4 h-4 sm:w-5 sm:h-5 shrink-0 ${!isServiceDisabled && (waiterStatus === 'COMING' || waiterStatus === 'PENDING') ? 'animate-pulse' : waiterStatus === 'OCCUPIED' || isServiceDisabled ? '' : 'animate-bounce'}`} />
                  <span className="tracking-wide font-bold whitespace-nowrap">
                    {waiterLoading
                      ? 'Sending Request...'
                      : isServiceDisabled
                        ? (isHotelRoom ? 'Room Service Disabled' : 'Waiter Call Disabled')
                        : waiterStatus === 'PENDING'
                          ? `${isHotelRoom ? 'Request Sent' : 'Waiter Call Sent'} (${waiterPendingTimer}s)`
                          : waiterStatus === 'COMING'
                            ? `${isHotelRoom ? 'Staff Coming' : 'Waiter Coming'} (${waiterComingTimer}s)`
                            : waiterStatus === 'OCCUPIED'
                              ? `Staff Busy (retry in ${waiterCooldown}s)`
                              : isHotelRoom
                                ? 'Call Room Service'
                                : 'Call Waiter'}
                  </span>
                </motion.button>

                {/* Extra notes input directly below button */}
                {!isServiceDisabled && waiterStatus === 'IDLE' && (
                  <div className="relative w-full sm:min-w-[260px]">
                    <input
                      type="text"
                      value={customServiceNote}
                      onChange={(e) => setCustomServiceNote(e.target.value)}
                      placeholder={isHotelRoom ? "Add extra note (e.g. water, towels)..." : "Add extra note (e.g. water, bill, napkins)..."}
                      maxLength={120}
                      className="w-full text-xs px-3.5 py-2 rounded-xl bg-card border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 shadow-xs"
                    />
                    {customServiceNote && (
                      <button
                        type="button"
                        onClick={() => setCustomServiceNote('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground text-xs"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Minimum order info */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> 25–35 min</span>
          <span>Min order: ₹{restaurant.minOrderValue}</span>
          <span className="flex items-center gap-1"><Star className="w-3 h-3 fill-yellow-400 text-yellow-400" /> 4.5</span>
        </div>
      </div>

      {/* Active/Recent Orders & History Section */}
      {((activeOrdersDetails && activeOrdersDetails.length > 0) || activeUser || (previousOrders && previousOrders.length > 0)) && (
        <div id="orders-section" className="px-4 md:px-8 mb-6 space-y-3">
          {/* Header & Tabs */}
          {!activeUser ? (
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm tracking-tight text-foreground flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                Active Orders ({activeOrdersDetails?.length ?? 0})
              </h3>
              <span className="text-[10px] text-muted-foreground animate-pulse">Auto-updating...</span>
            </div>
          ) : (
            <div className="flex items-center justify-between border-b border-border">
              <div className="flex gap-4">
                <button
                  onClick={() => setActiveTab('active')}
                  style={activeTab === 'active' ? { borderColor: themeColor, color: themeColor } : {}}
                  className={`pb-2 font-display font-bold text-sm tracking-tight transition-all border-b-2 ${activeTab === 'active'
                    ? 'font-bold'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  Active Orders ({activeOrdersDetails?.length ?? 0})
                </button>
                <button
                  onClick={() => setActiveTab('history')}
                  style={activeTab === 'history' ? { borderColor: themeColor, color: themeColor } : {}}
                  className={`pb-2 font-display font-bold text-sm tracking-tight transition-all border-b-2 ${activeTab === 'history'
                    ? 'font-bold'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                >
                  Past Orders ({previousOrders?.length ?? 0})
                </button>
              </div>
              {activeTab === 'active' && (
                <span className="text-[10px] text-muted-foreground animate-pulse mb-2">Auto-updating...</span>
              )}
            </div>
          )}
          {/* Tab Content: Active Orders */}
          {(activeTab === 'active' || !activeUser) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full min-w-0">
              {!activeOrdersDetails || activeOrdersDetails.length === 0 ? (
                <div className="sm:col-span-2 py-8 text-center text-muted-foreground text-sm border border-dashed border-border rounded-2xl bg-card">
                  No active orders right now
                </div>
              ) : (
                activeOrdersDetails.map((order: any) => {
                  if (!order) return null;
                  const statusDetails = getOrderStatusDetails(order.status);

                  return (
                    <div
                      key={order.id}
                      className="relative group bg-card hover:bg-card/85 border border-border rounded-2xl p-4 shadow-sm transition-all duration-200 overflow-hidden min-w-0 w-full"
                    >
                      {['DELIVERED', 'CANCELLED'].includes(order.status) && (
                        <button
                          onClick={() => handleDismissOrder(order.id)}
                          className="absolute top-3 right-3 p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          title="Dismiss"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}

                      <Link href={`/r/${slug}/order/${order.id}`} className="block space-y-3 min-w-0 w-full overflow-hidden">
                        <div className="flex items-center justify-between gap-2 pr-7 min-w-0 w-full">
                          <div className="space-y-0.5 min-w-0 shrink">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
                              Order #{order.id.slice(-8).toUpperCase()}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 whitespace-nowrap ${statusDetails.color}`}>
                            {statusDetails.label}
                          </span>
                        </div>

                        <div className="space-y-1 min-w-0 w-full">
                          <p className="text-xs font-semibold text-foreground truncate w-full min-w-0">
                            {order.items?.map((item: any) => {
                              const addOnsLabel = item.addOns && item.addOns.length > 0 ? ` (+ ${item.addOns.map((ao: any) => ao.name).join(', ')})` : '';
                              return `${item.menuItem.name}${addOnsLabel} × ${item.quantity}`;
                            }).join(', ')}
                          </p>
                          <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] text-muted-foreground flex-wrap min-w-0 w-full">
                            <span>₹{Number(order.total).toFixed(2)}</span>
                            <span>•</span>
                            <span>
                              {order.paymentStatus === 'PAID' ? (
                                <span className="font-extrabold text-emerald-600 dark:text-emerald-400">
                                  ✅ Paid ({order.paymentMethod === 'RAZORPAY' ? 'Online' : order.paymentMethod === 'COD' ? 'Counter' : 'Waiter'})
                                </span>
                              ) : (
                                <span className="font-extrabold text-amber-600 dark:text-amber-400 animate-pulse">
                                  ⏳ Payment Pending ({order.paymentMethod === 'RAZORPAY' ? 'Online' : order.paymentMethod === 'COD' ? 'Pay on Counter' : 'Pay to Waiter'})
                                </span>
                              )}
                            </span>
                            {order.tableNumber ? (
                              <>
                                <span>•</span>
                                <span className="font-semibold text-primary">
                                  {formatTableLabel(order.tableNumber)}
                                </span>
                              </>
                            ) : (
                              <>
                                <span>•</span>
                                <span>Delivery</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="space-y-1 min-w-0 w-full">
                          <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-500 ease-out"
                              style={{
                                width: `${statusDetails.progress}%`,
                                backgroundColor: order.status === 'CANCELLED' ? '#ef4444' : themeColor,
                              }}
                            />
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 text-[11px] font-bold text-primary group-hover:translate-x-0.5 transition-transform min-w-0 w-full">
                          <span>Track Live Status</span>
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: themeColor }} />
                        </div>
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Tab Content: Order History */}
          {activeTab === 'history' && activeUser && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full min-w-0">
              {!previousOrders || previousOrders.length === 0 ? (
                <div className="sm:col-span-2 py-8 text-center text-muted-foreground text-sm border border-dashed border-border rounded-2xl bg-card">
                  No previous orders found at this restaurant
                </div>
              ) : (
                previousOrders.map((order: any) => {
                  if (!order) return null;
                  const statusDetails = getOrderStatusDetails(order.status);

                  return (
                    <div
                      key={order.id}
                      className="group bg-card hover:bg-card/85 border border-border rounded-2xl p-4 shadow-sm transition-all duration-200 overflow-hidden min-w-0 w-full"
                    >
                      <Link href={`/r/${slug}/order/${order.id}`} className="block space-y-3 min-w-0 w-full overflow-hidden">
                        <div className="flex items-center justify-between gap-2 min-w-0 w-full">
                          <div className="space-y-0.5 min-w-0 shrink">
                            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
                              Order #{order.id.slice(-8).toUpperCase()}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(order.createdAt).toLocaleDateString()} at{' '}
                              {new Date(order.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border shrink-0 whitespace-nowrap ${statusDetails.color}`}>
                            {statusDetails.label}
                          </span>
                        </div>

                        <div className="space-y-1 min-w-0 w-full">
                          <p className="text-xs font-semibold text-foreground truncate w-full min-w-0">
                            {order.items?.map((item: any) => {
                              const addOnsLabel = item.addOns && item.addOns.length > 0 ? ` (+ ${item.addOns.map((ao: any) => ao.name).join(', ')})` : '';
                              return `${item.menuItem.name}${addOnsLabel} × ${item.quantity}`;
                            }).join(', ')}
                          </p>
                          <div className="flex items-center gap-1.5 sm:gap-2 text-[11px] text-muted-foreground flex-wrap min-w-0 w-full">
                            <span>₹{Number(order.total).toFixed(2)}</span>
                            <span>•</span>
                            <span>
                              {order.paymentMethod === 'RAZORPAY' ? 'Paid Online' : order.paymentMethod === 'COD' ? 'Pay on Counter' : order.paymentMethod === 'PAY_TO_WAITER' ? 'Pay to Waiter' : 'Wallet'}
                            </span>
                            {order.tableNumber ? (
                              <>
                                <span>•</span>
                                <span className="font-semibold text-primary">
                                  {formatTableLabel(order.tableNumber)}
                                </span>
                              </>
                            ) : (
                              <>
                                <span>•</span>
                                <span>Delivery</span>
                              </>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-1 text-[11px] font-bold text-primary group-hover:translate-x-0.5 transition-transform min-w-0 w-full">
                          <span>
                            {order.review
                              ? `⭐ ${order.review.rating} Reviewed · View Order`
                              : order.paymentStatus === 'PAID'
                              ? '⭐ Payment Done · Leave Review'
                              : 'View Order Details'}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: themeColor }} />
                        </div>
                      </Link>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* AI Recommendations (logged-in only) */}
      {activeUser && activeUser.role === 'CUSTOMER' && (
        <div className="px-4 md:px-8 mb-4">
          <AIRecommendations restaurantId={restaurant.id} themeColor={themeColor} />
        </div>
      )}

      {/* Search and Filters */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border px-4 md:px-8 py-3">
        <div className="flex gap-3 mb-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search dishes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 bg-muted rounded-xl text-sm border-0 focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
          {/* Interactive Filter Button */}
          <button
            onClick={() => setShowFilterDrawer((prev) => !prev)}
            className={`relative p-2.5 rounded-xl border transition-all active:scale-95 flex items-center justify-center shrink-0 ${hasActiveFilters
              ? 'text-white shadow-md'
              : 'bg-muted text-muted-foreground hover:text-foreground border-transparent'
              }`}
            style={hasActiveFilters ? { backgroundColor: themeColor } : {}}
            title="Filter & Sort Menu"
          >
            <Filter className="w-4 h-4" />
            {hasActiveFilters && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping border border-background" />
            )}
          </button>
        </div>

        {/* Filter Popup Panel */}
        <AnimatePresence>
          {showFilterDrawer && (
            <motion.div
              initial={{ opacity: 0, height: 0, y: -10 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="mb-3 bg-card border border-border rounded-2xl p-4 shadow-xl space-y-4 text-card-foreground overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-border pb-2.5">
                <h4 className="font-display font-bold text-sm flex items-center gap-2">
                  <Filter className="w-4 h-4 text-primary" style={{ color: themeColor }} /> Menu Filters & Sorting
                </h4>
                {hasActiveFilters && (
                  <button
                    onClick={() => {
                      setActiveFilter('ALL');
                      setMaxPrice(null);
                      setPriceSort('DEFAULT');
                      setSearchQuery('');
                    }}
                    className="text-xs font-semibold text-red-500 hover:underline"
                  >
                    Reset All Filters
                  </button>
                )}
              </div>

              {/* Dietary Filter */}
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-muted-foreground">Dietary Type</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { key: 'ALL', label: 'All Items' },
                    { key: 'VEG', label: '🟢 Veg Only' },
                    { key: 'NON_VEG', label: '🔴 Non-Veg' },
                    { key: 'VEGAN', label: '🌿 Vegan' },
                  ].map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setActiveFilter(f.key as any)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${activeFilter === f.key
                        ? 'text-white border-transparent shadow-sm'
                        : 'bg-muted border-border text-muted-foreground hover:text-foreground'
                        }`}
                      style={activeFilter === f.key ? { backgroundColor: themeColor } : {}}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Price Filter */}
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-muted-foreground">Max Budget Price</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: 'Any Price', val: null },
                    { label: 'Under ₹150', val: 150 },
                    { label: 'Under ₹250', val: 250 },
                    { label: 'Under ₹500', val: 500 },
                  ].map((p) => (
                    <button
                      key={p.label}
                      onClick={() => setMaxPrice(p.val)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${maxPrice === p.val
                        ? 'text-white border-transparent shadow-sm'
                        : 'bg-muted border-border text-muted-foreground hover:text-foreground'
                        }`}
                      style={maxPrice === p.val ? { backgroundColor: themeColor } : {}}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sorting Options */}
              <div className="space-y-1.5">
                <p className="text-xs font-bold text-muted-foreground">Sort By Price</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'DEFAULT', label: 'Default Order' },
                    { key: 'LOW_TO_HIGH', label: 'Price: Low to High 📈' },
                    { key: 'HIGH_TO_LOW', label: 'Price: High to Low 📉' },
                  ].map((s) => (
                    <button
                      key={s.key}
                      onClick={() => setPriceSort(s.key as any)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${priceSort === s.key
                        ? 'text-white border-transparent shadow-sm'
                        : 'bg-muted border-border text-muted-foreground hover:text-foreground'
                        }`}
                      style={priceSort === s.key ? { backgroundColor: themeColor } : {}}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Close Button */}
              <div className="pt-1 flex justify-end">
                <button
                  onClick={() => setShowFilterDrawer(false)}
                  className="px-4 py-2 bg-muted hover:bg-muted/80 rounded-xl text-xs font-extrabold text-foreground transition-all"
                >
                  Done
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Veg/Non-veg filters */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar scrollbar-hide pb-1 pr-6 whitespace-nowrap flex-nowrap min-w-0 max-w-full">
          {(['ALL', 'VEG', 'NON_VEG', 'VEGAN'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setActiveFilter(filter)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${activeFilter === filter
                ? 'text-white shadow-sm'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              style={activeFilter === filter ? { backgroundColor: themeColor } : {}}
            >
              {filter === 'ALL' ? 'All Items' : filter === 'VEG' ? '🟢 Veg' : filter === 'NON_VEG' ? '🔴 Non-Veg' : '🌿 Vegan'}
            </button>
          ))}

          <div className="w-px bg-border mx-1 flex-shrink-0" />

          {/* Category quick jump */}
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => {
                setActiveCategory(cat.id);
                document.getElementById(`cat-${cat.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${activeCategory === cat.id
                ? 'text-white'
                : 'bg-muted text-muted-foreground'
                }`}
              style={activeCategory === cat.id ? { backgroundColor: themeColor } : {}}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Menu Categories */}
      <div className="px-4 md:px-8 pt-4 space-y-8">
        {filteredCategories.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-5xl mb-4">🔍</div>
            <h3 className="font-display font-semibold text-lg mb-2">No items found</h3>
            <p className="text-muted-foreground text-sm">Try adjusting your search or filters</p>
          </div>
        ) : (
          filteredCategories.map((category) => (
            <div key={category.id} id={`cat-${category.id}`}>
              <h2 className="font-display text-xl font-bold mb-4">{category.name}</h2>
              <div className="grid gap-4">
                {category.items.map((item) => (
                  <MenuItemCard
                    key={item.id}
                    item={item}
                    themeColor={themeColor}
                    restaurantId={restaurant.id}
                    restaurantSlug={slug}
                    layoutStyle={(searchParams?.layout as any) || (restaurant.menuTemplate as any) || 'modern'}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Cart Button */}
      <AnimatePresence>
        {cartCount > 0 && !cartOpen && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-3 left-3 right-3 sm:bottom-4 sm:left-6 sm:right-6 z-40"
          >
            <button
              onClick={() => {
                if (isLocationDisabled) {
                  toast.error(`QR ordering for ${activeLocation || 'this restaurant'} is currently disabled by management.`);
                  return;
                }
                setCartOpen(true);
              }}
              className="w-full flex items-center justify-between px-5 py-3.5 sm:px-6 sm:py-4 rounded-2xl text-white shadow-[0_10px_30px_rgba(0,0,0,0.4)] hover:brightness-105 active:scale-[0.99] transition-all cursor-pointer border-2 border-white/30 backdrop-blur-md"
              style={{ backgroundColor: themeColor }}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-white/25 flex items-center justify-center text-sm font-bold shadow-inner">
                  {cartCount}
                </div>
                <span className="font-semibold text-base sm:text-lg tracking-wide">View Cart</span>
              </div>
              <div className="flex items-center gap-2.5">
                <ShoppingCart className="w-5 h-5" />
                <span className="font-bold text-base sm:text-lg">₹{getCartTotal().toFixed(2)}</span>
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cart Drawer */}
      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        restaurantSlug={slug}
        tableNumber={displayTableNumber}
        tableToken={tableToken}
        isTableVerified={isTableVerified}
        themeColor={themeColor}
        suggestedItems={suggestedAddons}
      />

      {/* AI Chatbot */}
      <AnimatePresence>
        {chatOpen && (
          <AIChatbot
            restaurantId={restaurant.id}
            restaurantName={restaurantName}
            themeColor={themeColor}
            onClose={() => setChatOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Simple Table / Room Number Input Modal ONLY when QR was not scanned and no table is known */}
      {mounted && typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {showTableInput && (
            <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm pointer-events-auto">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-card border border-border rounded-3xl p-5 sm:p-6 max-w-sm w-full shadow-2xl space-y-4 text-foreground"
              >
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center text-white font-bold shrink-0"
                      style={{ backgroundColor: themeColor }}
                    >
                      <BellRing className="w-4 h-4" />
                    </div>
                    <h3 className="font-display font-bold text-sm text-foreground">
                      {isHotelRoom ? 'Enter Hotel Room Number' : 'Enter Table Number'}
                    </h3>
                  </div>
                  <button
                    onClick={() => setShowTableInput(false)}
                    className="p-1.5 rounded-full bg-muted hover:bg-muted-foreground/20 text-muted-foreground transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-muted-foreground block">
                    {isHotelRoom ? 'Hotel Room Number / Suite' : 'Table Number'}
                  </label>
                  <input
                    type="text"
                    placeholder={isHotelRoom ? 'e.g. 101, 204, Suite 3' : 'e.g. 5, 12, A2'}
                    value={manualTableNumber}
                    onChange={(e) => setManualTableNumber(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground font-semibold"
                    autoFocus
                  />
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowTableInput(false)}
                    className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground text-xs font-bold transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!manualTableNumber.trim()) {
                        toast.error(isHotelRoom ? 'Please enter your room number' : 'Please enter your table number');
                        return;
                      }
                      setShowTableInput(false);
                      handleCallWaiter(manualTableNumber.trim(), undefined, customServiceNote);
                    }}
                    style={{ backgroundColor: themeColor }}
                    className="flex-1 py-2.5 rounded-xl text-white font-bold text-xs shadow-md transition-all hover:opacity-95 cursor-pointer"
                  >
                    {isHotelRoom ? 'Call Room Service' : 'Call Waiter'}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Floating Action Buttons — right column */}
      <div className={`fixed ${cartCount > 0 && !cartOpen ? 'bottom-20 sm:bottom-24' : 'bottom-4 sm:bottom-6'} right-3 sm:right-6 z-40 flex flex-col gap-2.5 items-end transition-all duration-300 pointer-events-auto`}>
        {showScrollTop && (
          <button
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-background/95 backdrop-blur-md border border-border/80 shadow-xl flex items-center justify-center hover:bg-muted transition-all active:scale-95 text-foreground cursor-pointer"
          >
            <ChevronUp className="w-5 h-5" />
          </button>
        )}


        {!chatOpen && (
          <button
            onClick={() => setChatOpen(true)}
            className="w-11 h-11 sm:w-12 sm:h-12 rounded-full text-white shadow-2xl flex items-center justify-center transition-transform hover:scale-110 active:scale-95 border-2 border-white/30 backdrop-blur-md cursor-pointer"
            style={{ backgroundColor: themeColor }}
            title="Ask AI Assistant"
          >
            <Bot className="w-5 h-5 sm:w-6 sm:h-6" />
          </button>
        )}
      </div>

      {/* AI Assistant Chatbot Window */}
      <AnimatePresence>
        {chatOpen && (
          <AIChatbot
            restaurantId={restaurant?.id || ''}
            restaurantName={restaurant?.name || searchParams?.name || 'Restaurant'}
            themeColor={themeColor}
            onClose={() => setChatOpen(false)}
            onSearchDish={(dishName) => {
              setSearchQuery(dishName);
              setChatOpen(false);
              const searchInput = document.querySelector('input[type="text"]') as HTMLInputElement;
              if (searchInput) {
                searchInput.focus();
              }
            }}
            onSelectCategory={(catName) => {
              setActiveCategory(catName);
              setChatOpen(false);
            }}
          />
        )}
      </AnimatePresence>



      {/* Customer Notification Modal */}
      <CustomerNotificationModal
        isOpen={showNotifModal}
        onClose={() => setShowNotifModal(false)}
      />

      {/* Customer Real-Time Alert Modal */}
      <CustomerAlertModal
        data={customerAlert}
        onClose={() => setCustomerAlert(null)}
      />
    </div>
  );
}

function MenuSkeleton() {
  return (
    <div className="min-h-screen bg-background">
      <div className="h-48 skeleton" />
      <div className="px-4 pt-4 space-y-4">
        <div className="flex gap-4">
          <div className="w-20 h-20 skeleton rounded-2xl" />
          <div className="flex-1 space-y-2">
            <div className="h-7 skeleton rounded-lg w-2/3" />
            <div className="h-4 skeleton rounded-lg w-1/2" />
          </div>
        </div>
        <div className="h-12 skeleton rounded-xl" />
        <div className="h-10 skeleton rounded-xl" />
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-28 skeleton rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
