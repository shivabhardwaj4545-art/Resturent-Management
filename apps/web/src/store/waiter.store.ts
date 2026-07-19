import { create } from 'zustand';

export interface WaiterCall {
  id: string;
  tableNumber: string;
  calledAt: string;
  type?: 'default' | 'payment' | 'addons';
  amount?: number;
  paymentMethod?: string;
  itemsSummary?: string;
}

interface WaiterState {
  waiterCalls: WaiterCall[];
  activeWaiterAlert: WaiterCall | null;
  addWaiterCall: (call: Omit<WaiterCall, 'id'>) => void;
  removeWaiterCall: (id: string) => void;
  setActiveWaiterAlert: (alert: WaiterCall | null) => void;
  clearAll: () => void;
}

export const useWaiterStore = create<WaiterState>((set) => ({
  waiterCalls: [],
  activeWaiterAlert: null,
  addWaiterCall: (payload) => {
    const newCall: WaiterCall = {
      ...payload,
      id: `${payload.tableNumber}-${Date.now()}`,
    };
    set((state) => ({
      waiterCalls: [newCall, ...state.waiterCalls],
      activeWaiterAlert: newCall,
    }));
  },
  removeWaiterCall: (id) =>
    set((state) => ({
      waiterCalls: state.waiterCalls.filter((c) => c.id !== id),
    })),
  setActiveWaiterAlert: (activeWaiterAlert) => set({ activeWaiterAlert }),
  clearAll: () => set({ waiterCalls: [], activeWaiterAlert: null }),
}));
