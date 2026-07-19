'use client';

import { useState } from 'react';
import { useWaiterStore } from '@/store/waiter.store';
import { Bell, BellRing, DollarSign, X, Banknote, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export function WaiterBell() {
  const { waiterCalls, removeWaiterCall, clearAll } = useWaiterStore();
  const [showWaiterPanel, setShowWaiterPanel] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setShowWaiterPanel((v) => !v)}
        className="relative p-2 rounded-xl hover:bg-muted transition-colors"
        title="Waiter call notifications"
      >
        {waiterCalls.length > 0 ? (
          <BellRing className="w-5 h-5 text-orange-500 animate-[ring_1s_ease-in-out_3]" />
        ) : (
          <Bell className="w-5 h-5" />
        )}
        {waiterCalls.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-orange-500 text-white rounded-full text-[10px] font-bold flex items-center justify-center animate-bounce">
            {waiterCalls.length}
          </span>
        )}
      </button>

      {/* Waiter Call Panel */}
      <AnimatePresence>
        {showWaiterPanel && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setShowWaiterPanel(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 mt-2 z-50 w-80 bg-card border border-border shadow-2xl rounded-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-orange-50 dark:bg-orange-900/20">
                <div className="flex items-center gap-2">
                  <BellRing className="w-4 h-4 text-orange-500" />
                  <span className="font-semibold text-sm text-orange-700 dark:text-orange-400">
                    Waiter Calls {waiterCalls.length > 0 && `(${waiterCalls.length})`}
                  </span>
                </div>
                {waiterCalls.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Clear all
                  </button>
                )}
              </div>

              <div className="max-h-72 overflow-y-auto">
                {waiterCalls.length === 0 ? (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    <Bell className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No waiter calls right now
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
                          <button
                            onClick={() => removeWaiterCall(call.id)}
                            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 ml-1"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
