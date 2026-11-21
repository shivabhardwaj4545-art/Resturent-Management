'use client';

import React from 'react';
import { FileText, Download } from 'lucide-react';
import { toast } from 'sonner';
import { downloadInvoicePdf, InvoiceOrderData, InvoiceRestaurantInfo } from '@/utils/pdfInvoice';

interface InvoiceDownloadProps {
  order: any;
  themeColor?: string;
  restaurant?: InvoiceRestaurantInfo | null;
}

export function InvoiceDownload({ order, themeColor = '#E85D04', restaurant }: InvoiceDownloadProps) {
  // Strict guard: Bill download invoice is ONLY visible once payment is marked as PAID
  if (order?.paymentStatus !== 'PAID') {
    return null;
  }

  const handleDownload = () => {
    try {
      const restInfo = restaurant || order?.restaurant || { name: 'Restaurant' };
      downloadInvoicePdf(order, restInfo);
      toast.success('Tax Invoice PDF downloaded directly!');
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      toast.error('Failed to generate invoice PDF. Please try again.');
    }
  };

  return (
    <button
      onClick={handleDownload}
      className="flex-1 py-3 px-4 rounded-xl border border-border text-center text-xs sm:text-sm font-bold hover:bg-muted transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-2xs"
      title="Download Official GST Tax Invoice PDF"
    >
      <FileText className="w-4 h-4 text-primary" />
      <span>Download PDF Invoice</span>
    </button>
  );
}
