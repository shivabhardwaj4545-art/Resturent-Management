'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Smartphone, QrCode, Copy, Check, AlertCircle, Loader2,
  ArrowLeft, RefreshCw, XCircle, CheckCircle2, ShieldCheck,
  Building2, Receipt, ArrowRight, ExternalLink
} from 'lucide-react';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import api from '@/services/api';
import { saveOrderToRecent } from '@/utils/recentOrders';
import { buildAppUpiUrl, triggerUpiLaunch } from '@/utils/upiIntent';

interface OrderPaymentPageProps {
  restaurantSlug: string;
  orderId: string;
}

interface PaymentDetailsResponse {
  orderId: string;
  restaurantId: string;
  restaurantSlug: string;
  restaurantName: string;
  merchantName: string;
  merchantVpa: string | null;
  orderStatus: string;
  paymentStatus: string;
  total: number;
  amountPaise: number;
  payment: {
    id: string;
    method: string;
    status: string;
    amount: number;
    amountPaise: number;
    merchantRef: string;
    txnRef: string;
    providerTxnId: string | null;
    utr: string | null;
    utrStatus: string;
    paidAt: string | null;
  } | null;
  activeAttempt: {
    id: string;
    merchantRef: string;
    amount: number;
    amountPaise: number;
    currency: string;
    status: string;
    intentUrl: string | null;
    qrPayload: string | null;
    expiresAt: string;
    isExpired: boolean;
  } | null;
}

type PaymentFlowState =
  | 'CREATED'
  | 'WAITING_FOR_PAYMENT'
  | 'PROCESSING'
  | 'SUCCESS'
  | 'FAILED'
  | 'EXPIRED';

export function OrderPaymentPage({ restaurantSlug, orderId }: OrderPaymentPageProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PaymentDetailsResponse | null>(null);
  const [flowState, setFlowState] = useState<PaymentFlowState>('WAITING_FOR_PAYMENT');
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [copiedUpi, setCopiedUpi] = useState(false);

  // Polling control
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const isPollingBusyRef = useRef<boolean>(false);

  // Load payment and active attempt details
  const fetchPaymentDetails = useCallback(async (isSilent = false) => {
    if (!isSilent) setIsRefreshing(true);
    try {
      const res = await api.get(`/payments/orders/${orderId}`);
      const payload: PaymentDetailsResponse = res.data?.data;
      if (payload) {
        setData(payload);

        // Update flow state based on authoritative database status
        if (payload.paymentStatus === 'PAID' || payload.payment?.status === 'PAID') {
          setFlowState('SUCCESS');
          saveOrderToRecent(payload.orderId, restaurantSlug);
        } else if (payload.orderStatus === 'CANCELLED') {
          setFlowState('FAILED');
        } else if (payload.activeAttempt?.isExpired) {
          setFlowState('EXPIRED');
        } else {
          setFlowState('WAITING_FOR_PAYMENT');
        }

        // Generate QR code for payment
        const intentOrQr = payload.activeAttempt?.qrPayload || payload.activeAttempt?.intentUrl;
        if (intentOrQr) {
          try {
            const url = await QRCode.toDataURL(intentOrQr, { width: 320, margin: 1 });
            setQrDataUrl(url);
          } catch (qrErr) {
            console.error('Failed to generate dynamic QR:', qrErr);
          }
        }
      }
    } catch (err: any) {
      if (!isSilent) {
        toast.error(err.response?.data?.error || 'Could not load order payment details.');
      }
    } finally {
      if (!isSilent) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [orderId, restaurantSlug]);

  // Initial load or create attempt if none active
  useEffect(() => {
    let isMounted = true;

    async function init() {
      setLoading(true);
      try {
        const res = await api.get(`/payments/orders/${orderId}`);
        const existingData: PaymentDetailsResponse = res.data?.data;

        if (existingData?.paymentStatus === 'PAID') {
          if (isMounted) {
            setData(existingData);
            setFlowState('SUCCESS');
            setLoading(false);
          }
          return;
        }

        // If no active attempt or active attempt is expired, create/reuse via create-upi-intent
        if (!existingData?.activeAttempt || existingData.activeAttempt.isExpired) {
          await api.post('/payments/create-upi-intent', { orderId });
        }

        if (isMounted) {
          await fetchPaymentDetails(false);
        }
      } catch (err) {
        // Fallback to fetch directly
        if (isMounted) {
          await fetchPaymentDetails(false);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    init();

    return () => {
      isMounted = false;
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [orderId, fetchPaymentDetails]);

  // Polling payment status every 3 seconds while WAITING_FOR_PAYMENT
  useEffect(() => {
    if (flowState === 'SUCCESS' || flowState === 'FAILED' || flowState === 'EXPIRED') {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      return;
    }

    const checkStatus = async () => {
      if (isPollingBusyRef.current) return;
      isPollingBusyRef.current = true;
      try {
        const paymentId = data?.payment?.id || orderId;
        const res = await api.get(`/payments/${paymentId}/status`, { skipToast: true } as any);
        const statusData = res.data?.data;
        if (statusData?.status === 'PAID' || statusData?.orderPaymentStatus === 'PAID') {
          setFlowState('SUCCESS');
          saveOrderToRecent(orderId, restaurantSlug);
          toast.success('Payment Verified & Order Confirmed! 🎉');
          await fetchPaymentDetails(true);
        }
      } catch {
        // Safe polling ignore
      } finally {
        isPollingBusyRef.current = false;
      }
    };

    pollingRef.current = setInterval(checkStatus, 3000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [flowState, data?.payment?.id, orderId, restaurantSlug, fetchPaymentDetails]);

  // Safe retry handler
  const handleRetryPayment = async () => {
    setIsRetrying(true);
    try {
      await api.post('/payments/create-upi-intent', { orderId, forceNew: true });
      await fetchPaymentDetails(false);
      toast.success('Generated new payment attempt reference.');
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not retry payment.');
    } finally {
      setIsRetrying(false);
    }
  };

  // Safe order cancellation with explicit confirmation
  const handleConfirmCancelOrder = async () => {
    if (data?.paymentStatus === 'PAID') {
      toast.error('Cannot cancel an already paid order.');
      setShowCancelModal(false);
      return;
    }

    setIsCancelling(true);
    try {
      await api.post(`/payments/orders/${orderId}/cancel`);
      setShowCancelModal(false);
      setFlowState('FAILED');
      toast.info('Order payment attempt has been cancelled.');
      await fetchPaymentDetails(false);
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Could not cancel order.');
    } finally {
      setIsCancelling(false);
    }
  };

  const getDeepLink = (app: 'gpay' | 'phonepe' | 'paytm' | 'bhim' | 'all', url?: string | null) => {
    if (!url) return '';
    return buildAppUpiUrl(app === 'all' ? 'generic' : app, url);
  };

  const totalAmount = data?.total ? data.total.toFixed(2) : '0.00';
  const merchantRef = data?.payment?.merchantRef || data?.activeAttempt?.merchantRef || 'ORD-PENDING';
  const intentUrl = data?.activeAttempt?.intentUrl || '';
  const merchantVpa = data?.merchantVpa || data?.restaurantName || 'ezrestro@upi';
  const utrNumber = data?.payment?.utr || data?.payment?.providerTxnId;

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Loader2 className="w-10 h-10 animate-spin text-primary mb-3" />
        <p className="text-sm font-semibold text-muted-foreground">Loading authoritative payment details...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-12">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-card/80 backdrop-blur-md border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => router.push(`/r/${restaurantSlug}/order/${orderId}`)}
            className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Order #{orderId.slice(-6).toUpperCase()}</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-foreground">{data?.restaurantName || 'Restaurant'}</span>
            <button
              onClick={() => fetchPaymentDetails(false)}
              disabled={isRefreshing}
              className="p-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-all cursor-pointer"
              title="Refresh Payment Status"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-lg mx-auto px-4 pt-6 space-y-4">
        {/* PAYMENT SUCCESS STATE */}
        {flowState === 'SUCCESS' ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-emerald-500/30 rounded-3xl p-6 sm:p-8 text-center shadow-xl space-y-5"
          >
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center border border-emerald-500/20">
              <CheckCircle2 className="w-9 h-9" />
            </div>

            <div>
              <span className="text-[10px] font-extrabold uppercase px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                Payment Verified & Confirmed
              </span>
              <h1 className="text-2xl font-display font-extrabold text-foreground mt-2">
                ₹{totalAmount}
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                Your payment to <strong className="text-foreground">{data?.restaurantName}</strong> was received successfully.
              </p>
            </div>

            {/* Authoritative Transaction Proof */}
            <div className="p-4 bg-muted/40 border border-border/80 rounded-2xl text-left space-y-2.5 text-xs font-mono">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Order Number:</span>
                <span className="font-bold text-foreground">#{orderId.slice(-6).toUpperCase()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Merchant Reference:</span>
                <span className="font-bold text-foreground">{merchantRef}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Bank Reference / UTR:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  {utrNumber || 'Verified by Acquiring Gateway'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Total Paid:</span>
                <span className="font-bold text-foreground">₹{totalAmount}</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => router.push(`/r/${restaurantSlug}/order/${orderId}`)}
                className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-sm shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
              >
                <span>Track Live Order & Kitchen Status</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        ) : flowState === 'FAILED' || flowState === 'EXPIRED' ? (
          /* PAYMENT FAILED / EXPIRED STATE */
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-card border border-rose-500/30 rounded-3xl p-6 sm:p-8 text-center shadow-xl space-y-5"
          >
            <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-500 mx-auto flex items-center justify-center border border-rose-500/20">
              <XCircle className="w-9 h-9" />
            </div>

            <div>
              <span className="text-[10px] font-extrabold uppercase px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                {flowState === 'EXPIRED' ? 'Payment Session Expired' : 'Order Payment Cancelled'}
              </span>
              <h1 className="text-2xl font-display font-extrabold text-foreground mt-2">
                ₹{totalAmount}
              </h1>
              <p className="text-xs text-muted-foreground mt-1">
                {flowState === 'EXPIRED'
                  ? 'The 15-minute payment session has expired. You can start a new payment attempt below.'
                  : 'This order payment attempt was cancelled or failed.'}
              </p>
            </div>

            <div className="p-4 bg-muted/40 border border-border/80 rounded-2xl text-left space-y-2 text-xs font-mono">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Order ID:</span>
                <span className="font-bold text-foreground">#{orderId.slice(-6).toUpperCase()}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Merchant Reference:</span>
                <span className="font-bold text-foreground">{merchantRef}</span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => router.push(`/r/${restaurantSlug}/order/${orderId}`)}
                className="flex-1 py-3 px-4 rounded-xl border border-border text-foreground font-semibold text-xs hover:bg-muted transition-colors cursor-pointer"
              >
                Back to Order
              </button>
              <button
                type="button"
                onClick={handleRetryPayment}
                disabled={isRetrying}
                className="flex-1 py-3 px-4 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:opacity-90 transition-all flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isRetrying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>Retry Payment</span>
              </button>
            </div>
          </motion.div>
        ) : (
          /* ACTIVE PENDING PAYMENT FLOW */
          <div className="space-y-4">
            {/* Payment Header Card */}
            <div className="bg-gradient-to-r from-orange-500 to-amber-500 text-white rounded-3xl p-5 shadow-lg relative overflow-hidden">
              <div className="flex items-center gap-2 mb-2">
                <div className="bg-white/20 p-1.5 rounded-lg">
                  <Smartphone className="w-4 h-4 text-white" />
                </div>
                <span className="text-[11px] font-bold tracking-wider uppercase opacity-90">UPI Deep Link Payment</span>
              </div>
              <p className="text-xs opacity-85">Pay with any installed UPI App or scan dynamic QR</p>

              <div className="mt-4 pt-3 border-t border-white/20 flex items-end justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold tracking-wider opacity-80 block">Exact Payable Amount</span>
                  <p className="text-3xl font-display font-black tracking-tight">₹{totalAmount}</p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] bg-white/20 px-2.5 py-1 rounded-full font-bold font-mono">
                    Ref: {merchantRef}
                  </span>
                  <p className="text-[11px] opacity-85 mt-1">To: <span className="font-semibold">{data?.merchantName}</span></p>
                </div>
              </div>
            </div>

            {/* Dynamic QR Code Card */}
            <div className="bg-card border border-border rounded-3xl p-5 text-center shadow-sm space-y-4">
              <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <QrCode className="w-4 h-4 text-primary" />
                <span>Scan with Google Pay, PhonePe, Paytm, or BHIM</span>
              </div>

              {qrDataUrl ? (
                <div className="bg-white p-3 rounded-2xl border border-border/80 shadow-xs max-w-[220px] mx-auto">
                  <img src={qrDataUrl} alt="Authoritative Dynamic UPI QR" className="w-full h-auto object-contain" />
                  <p className="text-[10px] text-gray-500 font-bold mt-1.5">Exact ₹{totalAmount}</p>
                </div>
              ) : (
                <div className="w-44 h-44 rounded-2xl bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              )}

              {/* Mobile UPI Deep Link Launch Buttons */}
              <div className="space-y-2 pt-1">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <a
                    href={buildAppUpiUrl('gpay', intentUrl)}
                    onClick={(e) => {
                      e.preventDefault();
                      triggerUpiLaunch('gpay', intentUrl);
                    }}
                    className="py-2.5 px-3 rounded-xl bg-muted/60 hover:bg-muted border border-border/80 text-foreground font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <span>Google Pay</span>
                  </a>
                  <a
                    href={buildAppUpiUrl('phonepe', intentUrl)}
                    onClick={(e) => {
                      e.preventDefault();
                      triggerUpiLaunch('phonepe', intentUrl);
                    }}
                    className="py-2.5 px-3 rounded-xl bg-muted/60 hover:bg-muted border border-border/80 text-foreground font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <span>PhonePe</span>
                  </a>
                  <a
                    href={buildAppUpiUrl('paytm', intentUrl)}
                    onClick={(e) => {
                      e.preventDefault();
                      triggerUpiLaunch('paytm', intentUrl);
                    }}
                    className="py-2.5 px-3 rounded-xl bg-muted/60 hover:bg-muted border border-border/80 text-foreground font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <span>Paytm</span>
                  </a>
                  <a
                    href={buildAppUpiUrl('bhim', intentUrl)}
                    onClick={(e) => {
                      e.preventDefault();
                      triggerUpiLaunch('bhim', intentUrl);
                    }}
                    className="py-2.5 px-3 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/30 text-primary font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
                  >
                    <span>BHIM / Other</span>
                  </a>
                </div>

                <a
                  href={buildAppUpiUrl('generic', intentUrl)}
                  onClick={(e) => {
                    e.preventDefault();
                    triggerUpiLaunch('generic', intentUrl);
                  }}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600 text-white font-bold text-sm shadow-md shadow-orange-500/20 flex items-center justify-center gap-2 active:scale-98 transition-all cursor-pointer"
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Open Default UPI App to Pay ₹{totalAmount}</span>
                </a>
              </div>
            </div>

            {/* Merchant Details Bar */}
            <div className="bg-card border border-border rounded-2xl p-3.5 flex items-center justify-between text-xs">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider block">Payee VPA / UPI ID</span>
                <span className="font-mono font-medium text-foreground">{merchantVpa}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(merchantVpa);
                  setCopiedUpi(true);
                  toast.success('UPI ID copied!');
                  setTimeout(() => setCopiedUpi(false), 2000);
                }}
                className="p-2 bg-muted hover:bg-muted-foreground/10 rounded-lg text-primary transition-all flex items-center gap-1 cursor-pointer"
                title="Copy UPI ID"
              >
                {copiedUpi ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span className="text-[11px] font-semibold">{copiedUpi ? 'Copied' : 'Copy'}</span>
              </button>
            </div>

            {/* Live Status Box */}
            <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl text-left space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-xs text-foreground">Waiting for Bank Payment Confirmation...</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {isRefreshing ? 'Checking status with bank gateway...' : 'Automatically checking every 3 seconds.'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fetchPaymentDetails(false)}
                disabled={isRefreshing}
                className="w-full py-2.5 px-3 rounded-xl bg-card border border-border hover:bg-muted font-semibold text-xs transition-all flex items-center justify-center gap-2 text-foreground disabled:opacity-60 cursor-pointer"
              >
                {isRefreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 text-primary" />}
                <span>I Have Paid (Refresh Status)</span>
              </button>
            </div>

            {/* Authoritative Transaction Details Card */}
            <div className="bg-muted/30 border border-border/80 rounded-2xl p-4 text-xs font-mono space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Merchant Order Ref:</span>
                <span className="font-bold text-foreground">{merchantRef}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Bank Reference / UTR:</span>
                <span className="text-muted-foreground font-sans italic">
                  {utrNumber || 'Awaiting bank confirmation'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Payable Amount:</span>
                <span className="font-bold text-foreground">₹{totalAmount}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground font-sans">Payment Method:</span>
                <span className="font-bold text-primary">Direct UPI Intent</span>
              </div>
            </div>

            {/* Footer Navigation Actions */}
            <div className="pt-2 flex gap-3">
              <button
                type="button"
                onClick={() => setShowCancelModal(true)}
                className="py-3 px-4 rounded-xl border border-rose-500/30 text-rose-500 font-semibold text-xs hover:bg-rose-500/10 transition-colors cursor-pointer text-center"
              >
                Cancel Order
              </button>
              <button
                type="button"
                onClick={() => router.push(`/r/${restaurantSlug}/order/${orderId}`)}
                className="flex-1 py-3 rounded-xl border border-border font-semibold text-xs hover:bg-muted transition-colors text-foreground cursor-pointer text-center"
              >
                View Order Status & Tracking
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Explicit Cancel Order Confirmation Dialog */}
      <AnimatePresence>
        {showCancelModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowCancelModal(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-xs"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-card border border-border rounded-2xl p-5 max-w-sm w-full relative z-10 shadow-2xl space-y-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-500 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-foreground">Cancel Order?</h3>
                  <p className="text-xs text-muted-foreground">Are you sure you want to cancel this order attempt?</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed bg-muted/30 p-3 rounded-xl border border-border">
                Cancelling will permanently cancel order <strong>#{orderId.slice(-6).toUpperCase()}</strong> and expire your active payment session of <strong>₹{totalAmount}</strong>.
              </p>

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCancelModal(false)}
                  className="flex-1 py-2.5 px-3 rounded-xl border border-border font-semibold text-xs hover:bg-muted text-foreground transition-colors cursor-pointer"
                >
                  Keep Order
                </button>
                <button
                  type="button"
                  onClick={handleConfirmCancelOrder}
                  disabled={isCancelling}
                  className="flex-1 py-2.5 px-3 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isCancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  <span>Yes, Cancel Order</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

