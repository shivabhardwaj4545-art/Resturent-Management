'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  Droplets,
  Receipt,
  Sparkles,
  X,
  Send,
  Loader2,
  CheckCircle2,
} from 'lucide-react';
import api from '@/services/api';
import { toast } from 'sonner';

export type QuickServiceType = 'GENERAL_ASSISTANCE' | 'WATER' | 'BILL' | 'CLEANING';

interface QuickServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceType: QuickServiceType | null;
  tableNumber: string;
  restaurantSlug: string;
  restaurantId?: string;
}

const SERVICE_CONFIG: Record<
  QuickServiceType,
  {
    title: string;
    subtitle: string;
    icon: typeof Bell;
    placeholder: string;
    badgeColor: string;
  }
> = {
  GENERAL_ASSISTANCE: {
    title: 'Call Waiter',
    subtitle: 'General Assistance at your table',
    icon: Bell,
    placeholder: 'Optional: e.g. Need extra napkins, spoons, or recommendations...',
    badgeColor: 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200 dark:border-purple-800',
  },
  WATER: {
    title: 'Request Water',
    subtitle: 'Bring fresh drinking water / extra glasses',
    icon: Droplets,
    placeholder: 'Optional: e.g. 2 glasses of warm water, normal water bottle...',
    badgeColor: 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  },
  BILL: {
    title: 'Request Bill',
    subtitle: 'Ask staff to prepare your running bill',
    icon: Receipt,
    placeholder: 'Optional: e.g. Settle via UPI / Card, need printed invoice...',
    badgeColor: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  CLEANING: {
    title: 'Table Cleaning',
    subtitle: 'Request table cleaning or plate clearance',
    icon: Sparkles,
    placeholder: 'Optional: e.g. Please clear used plates, wipe table...',
    badgeColor: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
};

export function QuickServiceModal({
  isOpen,
  onClose,
  serviceType,
  tableNumber,
  restaurantSlug,
  restaurantId,
}: QuickServiceModalProps) {
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  if (!isOpen || !serviceType) return null;

  const config = SERVICE_CONFIG[serviceType];
  const Icon = config.icon;

  const handleSubmit = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      await api.post('/waiter-requests', {
        restaurantSlug,
        restaurantId,
        tableNumber: tableNumber.trim() || '1',
        requestType: serviceType,
        reason: note.trim() || undefined,
      });

      setIsSuccess(true);
      toast.success(`${config.title} sent to restaurant staff!`);

      setTimeout(() => {
        setIsSuccess(false);
        setNote('');
        setIsSubmitting(false);
        onClose();
      }, 1200);
    } catch (err: any) {
      setIsSubmitting(false);
      const msg = err?.response?.data?.message || 'Failed to send request. Please alert staff directly.';
      toast.error(msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs">
      <motion.div
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full sm:max-w-md bg-white dark:bg-neutral-900 border-t sm:border border-neutral-200 dark:border-neutral-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col space-y-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-neutral-100 dark:border-neutral-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-100 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shadow-xs">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-neutral-900 dark:text-white">
                {config.title}
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {config.subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Table Number Badge */}
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/60 dark:border-neutral-700/60 text-xs font-semibold">
          <span className="text-neutral-500 dark:text-neutral-400">Requesting for:</span>
          <span className="font-black text-neutral-900 dark:text-white bg-white dark:bg-neutral-900 px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 shadow-2xs">
            {tableNumber.toLowerCase().includes('room') ? tableNumber.toUpperCase() : `TABLE ${tableNumber.toUpperCase()}`}
          </span>
        </div>

        {/* Optional Note Textarea */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-neutral-700 dark:text-neutral-300 flex items-center justify-between">
            <span>Special Note</span>
            <span className="text-[11px] font-normal text-neutral-400">(Optional)</span>
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={config.placeholder}
            rows={3}
            maxLength={250}
            className="w-full p-3 text-xs rounded-2xl bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200 dark:border-neutral-700 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none font-medium"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 py-3 text-xs font-bold rounded-2xl border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-300 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 py-3 text-xs font-extrabold rounded-2xl bg-purple-600 hover:bg-purple-700 active:scale-98 text-white transition flex items-center justify-center gap-2 shadow-md shadow-purple-600/25 cursor-pointer disabled:opacity-60"
          >
            {isSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isSuccess ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span>
              {isSubmitting ? 'Sending...' : isSuccess ? 'Sent!' : 'Send Request'}
            </span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
