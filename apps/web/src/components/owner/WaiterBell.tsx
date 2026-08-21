'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { useWaiterStore } from '@/store/waiter.store';
import { Bell, BellRing, DollarSign, X, Check, Banknote, Sparkles, Megaphone, CheckCheck, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export function WaiterBell() {
  const { waiterCalls, removeWaiterCall, clearAll } = useWaiterStore();
  const [showWaiterPanel, setShowWaiterPanel] = useState(false);
  const [activeTab, setActiveTab] = useState<'calls' | 'notifications'>('calls');
  const queryClient = useQueryClient();

  const { data: notifData, isLoading: isLoadingNotifs } = useQuery({
    queryKey: ['owner-notifications'],
    queryFn: async () => {
      const res = await api.get('/profile/notifications');
      return res.data.data as { notifications: NotificationItem[]; unreadCount: number };
    },
    enabled: showWaiterPanel,
    refetchInterval: 10000,
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      await api.patch('/profile/notifications/read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-notifications'] });
    },
  });

  const notifications = notifData?.notifications ?? [];
  const unreadNotifCount = notifData?.unreadCount ?? 0;
  const totalUnreadCount = waiterCalls.length + unreadNotifCount;

  return (
    <div className="relative">
      <button
        onClick={() => setShowWaiterPanel((v) => !v)}
        className="relative p-2 rounded-xl hover:bg-muted transition-colors"
        title="Notifications & Waiter Calls"
      >
        {totalUnreadCount > 0 ? (
          <BellRing className="w-5 h-5 text-primary animate-[ring_1s_ease-in-out_3]" />
        ) : (
          <Bell className="w-5 h-5 text-foreground" />
        )}
        {totalUnreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-primary-foreground rounded-full text-[10px] font-bold flex items-center justify-center animate-bounce">
            {totalUnreadCount}
          </span>
        )}
      </button>

      {/* Notifications Panel */}
      <AnimatePresence>
        {showWaiterPanel && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowWaiterPanel(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 mt-2 z-50 w-84 bg-card border border-border shadow-2xl rounded-2xl overflow-hidden"
            >
              {/* Tab Selector Header */}
              <div className="flex border-b border-border bg-muted/40 p-1">
                <button
                  onClick={() => setActiveTab('calls')}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === 'calls'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <BellRing className="w-3.5 h-3.5 text-primary" />
                  <span>Waiter Calls</span>
                  {waiterCalls.length > 0 && (
                    <span className="px-1.5 py-0.2 bg-primary text-primary-foreground rounded-full text-[10px]">
                      {waiterCalls.length}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setActiveTab('notifications')}
                  className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                    activeTab === 'notifications'
                      ? 'bg-card text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Megaphone className="w-3.5 h-3.5 text-blue-500" />
                  <span>Activity</span>
                  {unreadNotifCount > 0 && (
                    <span className="px-1.5 py-0.2 bg-blue-500 text-white rounded-full text-[10px]">
                      {unreadNotifCount}
                    </span>
                  )}
                </button>
              </div>

              {/* Tab 1: Waiter Calls */}
              {activeTab === 'calls' && (
                <>
                  <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-orange-50/50 dark:bg-orange-950/20">
                    <span className="text-[11px] font-bold text-orange-700 dark:text-orange-400">
                      Live Table & Payment Calls
                    </span>
                    {waiterCalls.length > 0 && (
                      <button
                        onClick={() => {
                          const socket = useWaiterStore.getState().socket;
                          waiterCalls.forEach((call) => {
                            if (socket && call.restaurantId) {
                              socket.emit('waiter:dismiss', {
                                restaurantId: call.restaurantId,
                                tableNumber: call.tableNumber,
                              });
                            }
                          });
                          clearAll();
                        }}
                        className="text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Clear all
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto">
                    {waiterCalls.length === 0 ? (
                      <div className="py-8 text-center text-muted-foreground text-sm">
                        <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No active waiter calls
                      </div>
                    ) : (
                      <div className="p-2 space-y-1.5">
                        {waiterCalls.map((call) => {
                          const isPayOnCounter = call.paymentMethod === 'COD';
                          const isPayToWaiter = call.paymentMethod === 'PAY_TO_WAITER';
                          const isAddon = call.type === 'addons';
                          const isPayment = call.type === 'payment';
                          
                          let containerClass = "bg-orange-50 dark:bg-orange-900/20 border-orange-200/50 dark:border-orange-500/20";
                          let iconClass = "bg-orange-500/10 text-orange-500";
                          let IconComponent = BellRing;
                          
                          if (isAddon) {
                            containerClass = "bg-blue-50 dark:bg-blue-900/20 border-blue-200/50 dark:border-blue-500/20";
                            iconClass = "bg-blue-500/10 text-blue-500";
                            IconComponent = isPayOnCounter ? Banknote : isPayToWaiter ? DollarSign : Sparkles;
                          } else if (isPayment) {
                            containerClass = "bg-amber-50 dark:bg-amber-900/20 border-amber-200/50 dark:border-amber-500/20";
                            iconClass = "bg-amber-500/10 text-amber-500";
                            IconComponent = isPayOnCounter ? Banknote : DollarSign;
                          }

                          return (
                            <motion.div
                              key={call.id}
                              initial={{ opacity: 0, x: -10 }}
                              animate={{ opacity: 1, x: 0 }}
                              className={`flex items-center justify-between border rounded-xl px-3 py-2.5 ${containerClass}`}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconClass}`}>
                                  <IconComponent className="w-4 h-4" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-bold text-foreground flex items-center gap-1.5 flex-wrap">
                                    Table {call.tableNumber}
                                    {isPayment && (
                                      <span className="text-[9px] bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 px-1.5 py-0.5 rounded-full font-semibold border border-amber-200/30">
                                        Pay
                                      </span>
                                    )}
                                    {isAddon && (
                                      <span className="text-[9px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded-full font-semibold border border-blue-200/30">
                                        Add-on
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-[11px] text-muted-foreground leading-normal">
                                    {isPayment ? (
                                      <span className="font-semibold text-amber-700 dark:text-amber-400">
                                        {isPayOnCounter ? 'Pay on Counter' : 'Pay to Waiter'} {call.amount ? `(₹${call.amount.toFixed(0)})` : ''}
                                      </span>
                                    ) : isAddon ? (
                                      <span className="font-semibold text-blue-700 dark:text-blue-400">
                                        {isPayOnCounter ? 'Add-on Counter Pay' : isPayToWaiter ? 'Add-on Waiter Pay' : 'Add-on Added'} {call.amount ? `(₹${call.amount.toFixed(0)})` : ''}
                                      </span>
                                    ) : (
                                      <span>Called for assistance</span>
                                    )}
                                    {' • '}
                                    {new Date(call.calledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                  {call.itemsSummary && (
                                    <p 
                                      className="text-[10px] text-muted-foreground mt-0.5 italic truncate" 
                                      title={call.itemsSummary}
                                    >
                                      {call.itemsSummary}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-1 flex-shrink-0 ml-1">
                                <button
                                  onClick={() => {
                                    const socket = useWaiterStore.getState().socket;
                                    if (socket && call.restaurantId) {
                                      socket.emit('waiter:respond', {
                                        restaurantId: call.restaurantId,
                                        tableNumber: call.tableNumber,
                                      });
                                    }
                                    removeWaiterCall(call.id);
                                  }}
                                  className="p-1 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400 hover:bg-green-500/20 transition-colors"
                                  title="Send Waiter"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    const socket = useWaiterStore.getState().socket;
                                    if (socket && call.restaurantId) {
                                      socket.emit('waiter:dismiss', {
                                        restaurantId: call.restaurantId,
                                        tableNumber: call.tableNumber,
                                      });
                                    }
                                    removeWaiterCall(call.id);
                                  }}
                                  className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                  title="Dismiss Call"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </motion.div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Tab 2: Activity Notifications */}
              {activeTab === 'notifications' && (
                <>
                  <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-blue-50/50 dark:bg-blue-950/20">
                    <span className="text-[11px] font-bold text-blue-700 dark:text-blue-400">
                      System & Activity Notifications
                    </span>
                    {unreadNotifCount > 0 && (
                      <button
                        onClick={() => markReadMutation.mutate()}
                        disabled={markReadMutation.isPending}
                        className="text-[10px] font-semibold text-primary hover:underline flex items-center gap-0.5"
                      >
                        <CheckCheck className="w-3 h-3" /> Read All
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto p-2 space-y-1.5">
                    {isLoadingNotifs ? (
                      <div className="py-8 flex justify-center items-center text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                      </div>
                    ) : notifications.length === 0 ? (
                      <div className="py-8 text-center text-muted-foreground text-sm">
                        <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No activity notifications yet
                      </div>
                    ) : (
                      notifications.map((notif) => (
                        <div
                          key={notif.id}
                          className={`p-2.5 rounded-xl border text-xs space-y-1 transition-all ${
                            !notif.isRead
                              ? 'bg-blue-50/60 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900/50 font-medium'
                              : 'bg-card border-border/60'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-foreground truncate">{notif.title}</span>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground leading-normal">{notif.message}</p>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
