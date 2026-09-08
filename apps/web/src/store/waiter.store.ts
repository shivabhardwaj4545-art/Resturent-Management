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
}

export interface LiveOrderAlert {
  id: string;
  guestName?: string;
  tableNumber?: string | number;
  total?: number;
  status?: string;
  createdAt?: string;
  items?: Array<{ name?: string; menuItem?: { name?: string }; quantity: number }>;
}

interface WaiterState {
  waiterCalls: WaiterCall[];
  newOrders: LiveOrderAlert[];
  activeWaiterAlert: WaiterCall | null;
  socket: Socket | null;
  soundEnabled: boolean;
  addWaiterCall: (call: Omit<WaiterCall, 'id'>) => void;
  removeWaiterCall: (id: string) => void;
  addNewOrder: (order: LiveOrderAlert) => void;
  removeNewOrder: (id: string) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setActiveWaiterAlert: (alert: WaiterCall | null) => void;
  clearAll: () => void;
  setSocket: (socket: Socket | null) => void;
}

export const useWaiterStore = create<WaiterState>((set) => ({
  waiterCalls: [],
  newOrders: [],
  activeWaiterAlert: null,
  socket: null,
  soundEnabled: true,
  addWaiterCall: (payload) => {
    const newCall: WaiterCall = {
      ...payload,
      id: `${payload.tableNumber}-${Date.now()}`,
    };
    set((state) => ({
      waiterCalls: [newCall, ...state.waiterCalls.filter((c) => c.tableNumber !== payload.tableNumber)],
      activeWaiterAlert: newCall,
    }));
  },
  removeWaiterCall: (id) =>
    set((state) => ({
      waiterCalls: state.waiterCalls.filter((c) => c.id !== id),
    })),
  addNewOrder: (order) =>
    set((state) => ({
      newOrders: [order, ...state.newOrders.filter((o) => o.id !== order.id)],
    })),
  removeNewOrder: (id) =>
    set((state) => ({
      newOrders: state.newOrders.filter((o) => o.id !== id),
    })),
  setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
  setActiveWaiterAlert: (activeWaiterAlert) => set({ activeWaiterAlert }),
  clearAll: () => set({ waiterCalls: [], newOrders: [], activeWaiterAlert: null }),
  setSocket: (socket) => set({ socket }),
}));
