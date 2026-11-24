import { create } from 'zustand';
import { Socket } from 'socket.io-client';

export interface WaiterCall {
  id: string;
  tableNumber: string;
  calledAt: string;
  restaurantId?: string;
  type?: 'default' | 'payment' | 'addons';
  amount?: number;
  paymentMethod?: string;
  itemsSummary?: string;
  orderId?: string;
  purpose?: string;
  customNote?: string;
}

export interface LiveOrderAlert {
  id: string;
  guestName?: string;
  tableNumber?: string | number;
  total?: number;
  status?: string;
  addOnStatus?: string | null;
  paymentMethod?: string;
  createdAt?: string;
  items?: Array<{ name?: string; menuItem?: { name?: string }; quantity: number; subtotal?: number; unitPrice?: number }>;
  user?: { name?: string };
  isNewAddon?: boolean;
  isAddon?: boolean;
}

export interface GeneralNotificationAlert {
  id: string;
  title: string;
  message?: string;
  type?: string;
  createdAt?: string;
}

interface WaiterState {
  waiterCalls: WaiterCall[];
  newOrders: LiveOrderAlert[];
  activeWaiterAlert: WaiterCall | null;
  activeNewOrderAlert: LiveOrderAlert | null;
  activeGeneralNotificationAlert: GeneralNotificationAlert | null;
  handledTables: string[];
  socket: Socket | null;
  soundEnabled: boolean;
  volume: number; // 0 to 150 (%)
  addWaiterCall: (call: Omit<WaiterCall, 'id'>, showAlert?: boolean) => void;
  removeWaiterCall: (id: string) => void;
  dismissWaiterCall: (id: string, tableNumber?: string) => void;
  addNewOrder: (order: LiveOrderAlert) => void;
  removeNewOrder: (id: string) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  setActiveWaiterAlert: (alert: WaiterCall | null) => void;
  setActiveNewOrderAlert: (alert: LiveOrderAlert | null) => void;
  setActiveGeneralNotificationAlert: (alert: GeneralNotificationAlert | null) => void;
  clearAll: () => void;
  setSocket: (socket: Socket | null) => void;
}

const getInitialSound = () => {
  if (typeof window !== 'undefined') {
    const val = localStorage.getItem('notification_sound_enabled');
    if (val !== null) return val === 'true';
  }
  return true;
};

const getInitialVolume = () => {
  if (typeof window !== 'undefined') {
    const val = localStorage.getItem('notification_volume');
    if (val !== null) {
      const n = Number(val);
      if (!isNaN(n) && n >= 0 && n <= 150) return n;
    }
  }
  return 100;
};

export const useWaiterStore = create<WaiterState>((set) => ({
  waiterCalls: [],
  newOrders: [],
  activeWaiterAlert: null,
  activeNewOrderAlert: null,
  activeGeneralNotificationAlert: null,
  handledTables: [],
  socket: null,
  soundEnabled: getInitialSound(),
  volume: getInitialVolume(),

  addWaiterCall: (payload, showAlert = false) => {
    const cleanTable = String(payload.tableNumber).trim();
    const newCall: WaiterCall = {
      ...payload,
      tableNumber: cleanTable,
      id: `${cleanTable}-${Date.now()}`,
    };
    set((state) => {
      const updatedCalls = [newCall, ...state.waiterCalls.filter((c) => c.tableNumber !== cleanTable)];
      const updatedHandled = state.handledTables.filter((t) => t !== cleanTable);
      return {
        waiterCalls: updatedCalls,
        handledTables: updatedHandled,
        activeWaiterAlert: showAlert ? newCall : state.activeWaiterAlert,
      };
    });
  },

  removeWaiterCall: (id) =>
    set((state) => ({
      waiterCalls: state.waiterCalls.filter((c) => c.id !== id),
      activeWaiterAlert: state.activeWaiterAlert?.id === id ? null : state.activeWaiterAlert,
    })),

  dismissWaiterCall: (id, tableNumber) =>
    set((state) => {
      const cleanT = tableNumber ? String(tableNumber).trim() : null;
      return {
        waiterCalls: state.waiterCalls.filter((c) => c.id !== id && (cleanT ? c.tableNumber !== cleanT : true)),
        activeWaiterAlert:
          state.activeWaiterAlert?.id === id || (cleanT && state.activeWaiterAlert?.tableNumber === cleanT)
            ? null
            : state.activeWaiterAlert,
        handledTables: cleanT && !state.handledTables.includes(cleanT) ? [...state.handledTables, cleanT] : state.handledTables,
      };
    }),

  addNewOrder: (order) =>
    set((state) => ({
      newOrders: [order, ...state.newOrders.filter((o) => o.id !== order.id)],
      activeNewOrderAlert: order,
    })),

  removeNewOrder: (id) =>
    set((state) => {
      const currentAlertId = state.activeNewOrderAlert?.id || (state.activeNewOrderAlert as any)?.orderId;
      return {
        newOrders: state.newOrders.filter((o) => o.id !== id && (o as any).orderId !== id),
        activeNewOrderAlert: currentAlertId === id ? null : state.activeNewOrderAlert,
      };
    }),

  setSoundEnabled: (soundEnabled) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('notification_sound_enabled', String(soundEnabled));
    }
    set({ soundEnabled });
  },
  setVolume: (volume) => {
    const clean = Math.max(0, Math.min(150, Math.round(volume)));
    if (typeof window !== 'undefined') {
      localStorage.setItem('notification_volume', String(clean));
    }
    set({ volume: clean });
  },
  setActiveWaiterAlert: (activeWaiterAlert) => set({ activeWaiterAlert }),
  setActiveNewOrderAlert: (activeNewOrderAlert) => set({ activeNewOrderAlert }),
  setActiveGeneralNotificationAlert: (activeGeneralNotificationAlert) => set({ activeGeneralNotificationAlert }),
  clearAll: () => set({ waiterCalls: [], newOrders: [], activeWaiterAlert: null, activeNewOrderAlert: null, activeGeneralNotificationAlert: null, handledTables: [] }),
  setSocket: (socket) => set({ socket }),
}));
