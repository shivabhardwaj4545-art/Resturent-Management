'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search, CheckCircle2, AlertCircle, Clock, Banknote, User, Phone,
  Receipt, ArrowRight, Loader2, Sparkles, RefreshCw, X, ShieldCheck,
  CreditCard, Smartphone, Check, AlertTriangle, Hash
} from 'lucide-react';
import api from '@/services/api';
import { toast } from 'sonner';

interface CounterOrder {
  id: string;
  orderNumber: string;
  verificationCode: string;
  restaurantId: string;
  restaurantName: string;
  customerName: string;
  customerPhone: string | null;
  tableNumber: string | null;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  counterPaymentMethod: string | null;
  paymentConfirmedBy: string | null;
  paymentConfirmedAt: string | null;
  subtotal: number;
  gstAmount: number;
  deliveryFee: number;
  packagingFee: number;
  discount: number;
  total: number;
  createdAt: string;
  items: Array<{
    id: string;
    name: string;
    image: string | null;
    variantName: string | null;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    addOns?: any;
  }>;
}

export function CounterOrderVerification() {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [searchedCode, setSearchedCode] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<CounterOrder | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<'CASH' | 'COUNTER_UPI' | 'CARD'>('CASH');
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Pending Counter Orders list for quick selection
  const { data: pendingData, isLoading: isLoadingPending, refetch: refetchPending } = useQuery({
    queryKey: ['counter-pending-orders'],
    queryFn: async () => {
      const res = await api.get('/owner/counter/pending');
      return res.data?.data?.orders || [];
    },
    refetchInterval: 10000,
  });

  // Lookup Order Mutation
  const lookupMutation = useMutation({
    mutationFn: async (lookupCode: string) => {
      const res = await api.post('/owner/counter/lookup', { code: lookupCode });
      return res.data?.data?.order as CounterOrder;
    },
    onSuccess: (order) => {
      setSelectedOrder(order);
      setSearchedCode(order.verificationCode);
      toast.success(`Found order #${order.orderNumber} for ${order.customerName}`);
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error || 'No matching order found for this 4-digit code.';
      toast.error(msg);
      setSelectedOrder(null);
    },
  });

  // Confirm Payment Mutation
  const confirmPaymentMutation = useMutation({
    mutationFn: async ({ orderId, instrument }: { orderId: string; instrument: string }) => {
      const res = await api.post('/owner/counter/confirm-payment', { orderId, instrument });
      return res.data;
    },
    onSuccess: (data) => {
      setShowConfirmModal(false);
      toast.success('✅ Payment Confirmed! Order marked as PAID.');
      if (selectedOrder) {
        setSelectedOrder({
          ...selectedOrder,
          paymentStatus: 'PAID',
          counterPaymentMethod: selectedInstrument,
          paymentConfirmedAt: new Date().toISOString(),
        });
      }
      refetchPending();
      qc.invalidateQueries({ queryKey: ['owner-orders'] });
      qc.invalidateQueries({ queryKey: ['owner-dashboard'] });
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error || 'Failed to confirm payment.';
      toast.error(msg);
    },
  });

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanCode = code.trim();
    if (!cleanCode || cleanCode.length !== 4 || !/^\d{4}$/.test(cleanCode)) {
      toast.error('Please enter a valid 4-digit verification code.');
      return;
    }
    lookupMutation.mutate(cleanCode);
  };

  const handleKeypadPress = (val: string) => {
    if (val === 'C') {
      setCode('');
      return;
    }
    if (val === 'BS') {
      setCode((prev) => prev.slice(0, -1));
      return;
    }
    if (code.length < 4) {
      const nextCode = code + val;
      setCode(nextCode);
      if (nextCode.length === 4) {
        lookupMutation.mutate(nextCode);
      }
    }
  };

  const formatAmount = (val: number) => {
    return (Number(val) || 0).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-emerald-500/10 via-primary/10 to-amber-500/10 border border-emerald-500/20 rounded-3xl p-5 md:p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-2 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 rounded-xl">
                <Receipt className="w-5 h-5" />
              </span>
              <h2 className="text-lg md:text-xl font-display font-bold text-foreground">
                Counter Order Verification
              </h2>
            </div>
            <p className="text-xs md:text-sm text-muted-foreground">
              Enter the customer&apos;s 4-digit order code to verify details and manually confirm payment received at the counter.
            </p>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto">
            <button
              onClick={() => {
                refetchPending();
                if (searchedCode) lookupMutation.mutate(searchedCode);
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-card border border-border hover:bg-muted text-foreground flex items-center gap-1.5 transition-colors shadow-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoadingPending ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: 4-Digit Search Keypad & Input */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-card border border-border rounded-3xl p-5 md:p-6 shadow-sm space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-extrabold tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Hash className="w-4 h-4 text-primary" /> Enter 4-Digit Code
              </span>
              {code.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCode('')}
                  className="text-xs text-muted-foreground hover:text-foreground font-semibold"
                >
                  Clear
                </button>
              )}
            </div>

            {/* Large 4-Digit Code Input Box */}
            <form onSubmit={handleSearch} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  value={code}
                  onChange={(e) => {
                    const cleaned = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setCode(cleaned);
                    if (cleaned.length === 4) {
                      lookupMutation.mutate(cleaned);
                    }
                  }}
                  placeholder="• • • •"
                  className="w-full h-16 text-3xl md:text-4xl font-mono font-black tracking-[0.4em] text-center bg-muted/40 border-2 border-border focus:border-primary rounded-2xl outline-none transition-all text-foreground"
                />
              </div>

              <button
                type="submit"
                disabled={lookupMutation.isPending || code.length !== 4}
                className="w-full py-3.5 px-4 rounded-xl font-bold text-sm text-white bg-primary hover:bg-primary/95 disabled:opacity-50 transition-all flex items-center justify-center gap-2 shadow-md shadow-primary/20"
              >
                {lookupMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Verifying Code...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" /> Verify Order Code
                  </>
                )}
              </button>
            </form>

            {/* Quick Touch Numeric Keypad */}
            <div className="pt-2 border-t border-border/60">
              <p className="text-[11px] font-semibold text-muted-foreground mb-3 text-center">
                Counter Touch Keypad
              </p>
              <div className="grid grid-cols-3 gap-2.5">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'BS'].map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKeypadPress(k)}
                    className={`h-12 rounded-xl text-base font-bold transition-all flex items-center justify-center active:scale-95 ${
                      k === 'C'
                        ? 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20'
                        : k === 'BS'
                        ? 'bg-muted hover:bg-muted/80 text-muted-foreground'
                        : 'bg-muted/60 hover:bg-muted text-foreground border border-border/50'
                    }`}
                  >
                    {k === 'BS' ? '⌫' : k}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Pending Counter Orders List */}
          <div className="bg-card border border-border rounded-3xl p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase font-extrabold tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-500" /> Awaiting Payment ({pendingData?.length || 0})
              </span>
            </div>

            {isLoadingPending ? (
              <div className="py-6 flex justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            ) : !pendingData || pendingData.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground bg-muted/20 rounded-2xl">
                No orders currently waiting for counter payment.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {pendingData.map((po: any) => (
                  <button
                    key={po.id}
                    onClick={() => {
                      if (po.verificationCode) {
                        setCode(po.verificationCode);
                        lookupMutation.mutate(po.verificationCode);
                      }
                    }}
                    className={`w-full text-left p-3 rounded-2xl border transition-all flex items-center justify-between ${
                      selectedOrder?.id === po.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border/60 hover:bg-muted/40'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold text-primary">
                          #{po.verificationCode || po.orderNumber}
                        </span>
                        <span className="text-xs font-medium text-foreground">
                          {po.customerName}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {po.tableNumber ? `Table ${po.tableNumber}` : 'Dine-In'} · {new Date(po.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-foreground block">
                        ₹{formatAmount(po.total)}
                      </span>
                      <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                        Pending
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Order Verification Details & Payment Confirmation */}
        <div className="lg:col-span-7">
          {lookupMutation.isPending ? (
            <div className="bg-card border border-border rounded-3xl p-12 text-center space-y-4">
              <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
              <p className="text-sm text-muted-foreground font-medium">Looking up order details...</p>
            </div>
          ) : !selectedOrder ? (
            <div className="bg-card border border-dashed border-border rounded-3xl p-12 text-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-muted/60 flex items-center justify-center mx-auto text-muted-foreground text-2xl">
                🔢
              </div>
              <h3 className="font-display font-bold text-base text-foreground">No Order Selected</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Enter the customer&apos;s 4-digit verification code on the left or select an active order from the awaiting payment list.
              </p>
            </div>
          ) : (
            <div className="bg-card border border-border rounded-3xl p-6 shadow-sm space-y-6">
              {/* Header: Code & Status */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-border/80 gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-3 py-1 rounded-full text-xs font-mono font-black bg-primary/10 text-primary border border-primary/20 text-sm">
                      CODE #{selectedOrder.verificationCode}
                    </span>
                    <span className="text-xs text-muted-foreground font-medium">
                      Order #{selectedOrder.orderNumber}
                    </span>
                  </div>
                  <h3 className="text-lg font-display font-bold text-foreground">
                    {selectedOrder.customerName}
                  </h3>
                  {selectedOrder.customerPhone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Phone className="w-3 h-3" /> {selectedOrder.customerPhone}
                    </p>
                  )}
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1">
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold border ${
                      selectedOrder.paymentStatus === 'PAID'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                    }`}
                  >
                    {selectedOrder.paymentStatus === 'PAID' ? '✅ PAID' : '⏳ PAYMENT PENDING'}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    Status: {selectedOrder.status}
                  </span>
                </div>
              </div>

              {/* Order Meta Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-muted/30 border border-border/60 rounded-xl p-3">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">Location</span>
                  <span className="font-semibold text-foreground">
                    {selectedOrder.tableNumber ? `Table ${selectedOrder.tableNumber}` : 'Counter / Takeaway'}
                  </span>
                </div>
                <div className="bg-muted/30 border border-border/60 rounded-xl p-3">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">Placed At</span>
                  <span className="font-semibold text-foreground">
                    {new Date(selectedOrder.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="bg-muted/30 border border-border/60 rounded-xl p-3">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">Order Method</span>
                  <span className="font-semibold text-foreground">Pay at Counter</span>
                </div>
                <div className="bg-muted/30 border border-border/60 rounded-xl p-3">
                  <span className="text-muted-foreground block text-[10px] uppercase font-bold">Amount Due</span>
                  <span className="font-bold text-primary text-sm">₹{formatAmount(selectedOrder.total)}</span>
                </div>
              </div>

              {/* Order Items Table */}
              <div className="space-y-3">
                <span className="text-xs uppercase font-extrabold tracking-wider text-muted-foreground block">
                  Order Items ({selectedOrder.items.length})
                </span>
                <div className="bg-muted/20 border border-border/60 rounded-2xl overflow-hidden divide-y divide-border/50">
                  {selectedOrder.items.map((item) => (
                    <div key={item.id} className="p-3 flex items-center justify-between text-xs">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-foreground">
                            {item.quantity}× {item.name}
                          </span>
                          {item.variantName && (
                            <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.2 rounded">
                              {item.variantName}
                            </span>
                          )}
                        </div>
                        {Array.isArray(item.addOns) && item.addOns.length > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            + {item.addOns.map((a: any) => a.name).join(', ')}
                          </p>
                        )}
                      </div>
                      <span className="font-semibold text-foreground font-mono">
                        ₹{formatAmount(item.subtotal)}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Bill Breakdown */}
                <div className="bg-muted/30 border border-border/60 rounded-2xl p-4 space-y-1.5 text-xs">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal:</span>
                    <span>₹{formatAmount(selectedOrder.subtotal)}</span>
                  </div>
                  {selectedOrder.gstAmount > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>GST (18%):</span>
                      <span>₹{formatAmount(selectedOrder.gstAmount)}</span>
                    </div>
                  )}
                  {selectedOrder.discount > 0 && (
                    <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                      <span>Discount:</span>
                      <span>-₹{formatAmount(selectedOrder.discount)}</span>
                    </div>
                  )}
                  <div className="pt-2 border-t border-border/60 flex justify-between font-bold text-sm text-foreground">
                    <span>Total Bill:</span>
                    <span className="text-base text-primary font-mono">₹{formatAmount(selectedOrder.total)}</span>
                  </div>
                </div>
              </div>

              {/* Payment Action Section */}
              {selectedOrder.paymentStatus !== 'PAID' ? (
                <div className="bg-gradient-to-br from-card to-muted/20 border-2 border-emerald-500/30 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                    <h4 className="font-display font-bold text-sm text-foreground">
                      Confirm Counter Payment
                    </h4>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Select the payment method the customer paid with, then click <strong>Confirm Payment Received</strong> below.
                  </p>

                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'CASH', label: 'Cash', icon: Banknote },
                      { value: 'COUNTER_UPI', label: 'UPI QR', icon: Smartphone },
                      { value: 'CARD', label: 'POS Card', icon: CreditCard },
                    ].map((m) => {
                      const Icon = m.icon;
                      const active = selectedInstrument === m.value;
                      return (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => setSelectedInstrument(m.value as any)}
                          className={`p-3 rounded-xl border text-xs font-bold transition-all flex flex-col items-center gap-1 ${
                            active
                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shadow-xs'
                              : 'border-border/70 bg-card hover:bg-muted text-muted-foreground'
                          }`}
                        >
                          <Icon className="w-4 h-4" />
                          <span>{m.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(true)}
                    className="w-full py-4 px-4 rounded-xl font-bold text-sm text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] transition-all shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-5 h-5" />
                    Confirm Payment Received · ₹{formatAmount(selectedOrder.total)}
                  </button>
                </div>
              ) : (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 flex items-center justify-between text-xs">
                  <div className="space-y-0.5">
                    <span className="font-bold text-emerald-700 dark:text-emerald-300 block">
                      ✅ Payment Already Confirmed
                    </span>
                    <span className="text-muted-foreground">
                      Method: {selectedOrder.counterPaymentMethod || 'Counter Payment'}
                      {selectedOrder.paymentConfirmedAt && ` · ${new Date(selectedOrder.paymentConfirmedAt).toLocaleTimeString()}`}
                    </span>
                  </div>
                  <span className="px-2.5 py-1 rounded-full font-bold bg-emerald-500 text-white text-[10px]">
                    PAID
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmModal && selectedOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="bg-card border border-border w-full max-w-md rounded-3xl p-6 shadow-2xl relative z-10 space-y-4"
            >
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto text-xl">
                <Banknote className="w-6 h-6" />
              </div>

              <div className="text-center space-y-1">
                <h3 className="font-display font-bold text-base text-foreground">
                  Confirm Payment Received?
                </h3>
                <p className="text-xs text-muted-foreground">
                  Have you received the payment from this customer?
                </p>
              </div>

              <div className="bg-muted/40 border border-border/60 rounded-2xl p-4 text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verification Code:</span>
                  <span className="font-mono font-bold text-primary">#{selectedOrder.verificationCode}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-semibold text-foreground">{selectedOrder.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Payment Method:</span>
                  <span className="font-semibold text-foreground">{selectedInstrument}</span>
                </div>
                <div className="border-t border-border/50 pt-2 flex justify-between font-bold text-sm">
                  <span>Amount to Confirm:</span>
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono">₹{formatAmount(selectedOrder.total)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="py-3 px-4 rounded-xl border border-border font-semibold text-xs hover:bg-muted text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={confirmPaymentMutation.isPending}
                  onClick={() => {
                    confirmPaymentMutation.mutate({
                      orderId: selectedOrder.id,
                      instrument: selectedInstrument,
                    });
                  }}
                  className="py-3 px-4 rounded-xl font-bold text-xs text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20"
                >
                  {confirmPaymentMutation.isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Confirming...
                    </>
                  ) : (
                    'Confirm Payment'
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
