/**
 * Customer Bill & GST Tax Invoice Printing Utility
 * Formatted for standard 80mm / 58mm POS receipt printers & standard A4 / PDF print.
 * Complies with standard Indian restaurant GST tax invoice specifications:
 * - Restaurant details & GSTIN
 * - Tax Invoice Number & Date/Time
 * - Itemized dishes, rates, quantities & amounts
 * - CGST (2.5%) & SGST (2.5%) breakdown
 * - Net total & Payment method
 */

import { formatTableLabel } from './tableCode';

export interface BillItem {
  id?: string;
  quantity: number;
  name?: string;
  menuItem?: { name?: string };
  variant?: { name?: string } | null;
  unitPrice?: number;
  subtotal?: number;
  isAddon?: boolean;
  addOns?: any;
}

export interface BillRestaurantInfo {
  name: string;
  legalBusinessName?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  gstin?: string | null;
  fssaiNumber?: string | null;
  themeColor?: string | null;
}

export interface BillPrintOptions {
  order: {
    id: string;
    tableNumber?: string | number | null;
    guestName?: string | null;
    guestPhone?: string | null;
    createdAt?: string;
    paymentMethod?: string;
    paymentStatus?: string;
    subtotal: number;
    gstAmount: number;
    deliveryFee?: number;
    packagingFee?: number;
    discount?: number;
    total: number;
    verificationCode?: string | null;
    items?: BillItem[];
  };
  restaurant: BillRestaurantInfo;
  paperWidth?: '80mm' | '58mm' | 'A4';
}

export function generateBillHtml(options: BillPrintOptions): string {
  const { order, restaurant, paperWidth = '80mm' } = options;

  const invoiceNumber = `INV-${order.id.slice(-8).toUpperCase()}`;
  const orderDate = order.createdAt ? new Date(order.createdAt) : new Date();
  const formattedDate = orderDate.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const printTimestamp = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  const subtotal = Number(order.subtotal || 0);
  const gstTotal = Number(order.gstAmount || 0);
  const cgst = gstTotal > 0 ? gstTotal / 2 : 0;
  const sgst = gstTotal > 0 ? gstTotal / 2 : 0;
  const discount = Number(order.discount || 0);
  const deliveryFee = Number(order.deliveryFee || 0);
  const packagingFee = Number(order.packagingFee || 0);
  const grandTotal = Number(order.total || 0);

  const cleanTable = order.tableNumber
    ? formatTableLabel(order.tableNumber)
    : 'Dine-In';

  const paymentMethodLabel =
    order.paymentMethod === 'RAZORPAY'
      ? 'Online / UPI'
      : order.paymentMethod === 'WALLET'
      ? 'Wallet'
      : order.paymentMethod === 'PAY_TO_WAITER'
      ? 'Cash / UPI to Waiter'
      : order.paymentMethod === 'CASH'
      ? 'Cash on Counter'
      : 'Counter Settle';

  const isPaid = order.paymentStatus === 'PAID';

  const widthStyle =
    paperWidth === '58mm'
      ? 'width: 48mm; max-width: 48mm; font-size: 11px;'
      : paperWidth === 'A4'
      ? 'width: 100%; max-width: 720px; font-size: 13px; padding: 24px;'
      : 'width: 72mm; max-width: 72mm; font-size: 12px;';

  const itemsHtml = (order.items || [])
    .map((item, idx) => {
      const name = item.menuItem?.name || item.name || 'Dish Item';
      const variant = item.variant?.name ? ` (${item.variant.name})` : '';
      const qty = item.quantity || 1;
      const rate = item.unitPrice || (item.subtotal ? item.subtotal / qty : 0);
      const itemSubtotal = item.subtotal || rate * qty;

      return `
        <tr>
          <td class="col-sno">${idx + 1}</td>
          <td class="col-item">
            <span class="item-name">${name}${variant}</span>
            ${item.isAddon ? '<span class="item-tag">[Add-on]</span>' : ''}
          </td>
          <td class="col-qty">${qty}</td>
          <td class="col-rate">&#8377;${rate.toFixed(2)}</td>
          <td class="col-amt">&#8377;${itemSubtotal.toFixed(2)}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Bill Invoice - ${invoiceNumber}</title>
      <style>
        @page {
          size: auto;
          margin: 0;
        }
        @media print {
          body {
            margin: 0;
            padding: 4px 6px;
          }
          .no-print {
            display: none !important;
          }
        }
        * {
          box-sizing: border-box;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        body {
          font-family: 'Courier New', Courier, monospace, system-ui;
          line-height: 1.25;
          color: #000;
          background: #fff;
          margin: 0 auto;
          padding: 8px;
          ${widthStyle}
        }
        .header {
          text-align: center;
          margin-bottom: 6px;
        }
        .rest-name {
          font-size: 16px;
          font-weight: 900;
          text-transform: uppercase;
          margin: 0 0 2px 0;
          letter-spacing: 0.5px;
        }
        .legal-name {
          font-size: 10px;
          font-weight: 600;
          color: #444;
          margin-bottom: 2px;
        }
        .rest-info {
          font-size: 10px;
          color: #333;
          margin: 1px 0;
        }
        .tax-title {
          font-size: 13px;
          font-weight: 800;
          margin: 6px 0 2px 0;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .double-line {
          border-top: 1.5px dashed #000;
          border-bottom: 1.5px dashed #000;
          height: 3px;
          margin: 4px 0;
        }
        .single-line {
          border-top: 1px dashed #000;
          margin: 4px 0;
        }
        .solid-line {
          border-top: 1px solid #000;
          margin: 4px 0;
        }
        .meta-row {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          margin: 1.5px 0;
        }
        .meta-row .label {
          font-weight: 600;
          color: #333;
        }
        .meta-row .val {
          font-weight: 800;
          text-align: right;
        }
        table.bill-table {
          width: 100%;
          border-collapse: collapse;
          margin: 4px 0;
          font-size: 10.5px;
        }
        table.bill-table th {
          border-top: 1px dashed #000;
          border-bottom: 1px dashed #000;
          padding: 3px 0;
          font-weight: 800;
          text-transform: uppercase;
        }
        table.bill-table td {
          padding: 2.5px 0;
          vertical-align: top;
        }
        .col-sno {
          width: 8%;
          text-align: left;
        }
        .col-item {
          width: 44%;
          text-align: left;
        }
        .col-qty {
          width: 12%;
          text-align: center;
          font-weight: 700;
        }
        .col-rate {
          width: 16%;
          text-align: right;
        }
        .col-amt {
          width: 20%;
          text-align: right;
          font-weight: 800;
        }
        .item-name {
          font-weight: 700;
          word-break: break-word;
        }
        .item-tag {
          font-size: 8.5px;
          display: block;
          color: #555;
        }
        .totals-section {
          margin-top: 4px;
          font-size: 11px;
        }
        .total-row {
          display: flex;
          justify-content: space-between;
          margin: 2px 0;
        }
        .grand-total-row {
          display: flex;
          justify-content: space-between;
          font-size: 14px;
          font-weight: 900;
          padding: 4px 0;
        }
        .gst-breakdown {
          font-size: 9.5px;
          color: #333;
          margin: 3px 0;
          padding: 3px 0;
          border-top: 1px dotted #888;
          border-bottom: 1px dotted #888;
        }
        .payment-box {
          margin-top: 6px;
          padding: 4px;
          border: 1px solid #000;
          text-align: center;
          font-weight: 800;
          font-size: 11px;
          text-transform: uppercase;
        }
        .footer {
          text-align: center;
          font-size: 9.5px;
          margin-top: 8px;
          color: #444;
          line-height: 1.35;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="rest-name">${restaurant.name}</div>
        ${restaurant.legalBusinessName && restaurant.legalBusinessName !== restaurant.name ? `<div class="legal-name">(${restaurant.legalBusinessName})</div>` : ''}
        ${restaurant.address ? `<div class="rest-info">${restaurant.address}${restaurant.city ? `, ${restaurant.city}` : ''}</div>` : ''}
        ${restaurant.phone ? `<div class="rest-info">Ph: ${restaurant.phone}</div>` : ''}
        ${restaurant.gstin ? `<div class="rest-info" style="font-weight:bold; letter-spacing: 0.5px;">GSTIN: ${restaurant.gstin}</div>` : ''}
        ${restaurant.fssaiNumber ? `<div class="rest-info">FSSAI Lic: ${restaurant.fssaiNumber}</div>` : ''}
        <div class="tax-title">*** TAX INVOICE ***</div>
      </div>

      <div class="double-line"></div>

      <div class="meta-row">
        <span class="label">Invoice No:</span>
        <span class="val">${invoiceNumber}</span>
      </div>
      <div class="meta-row">
        <span class="label">Date & Time:</span>
        <span class="val">${formattedDate}</span>
      </div>
      <div class="meta-row">
        <span class="label">Dining / Table:</span>
        <span class="val">${cleanTable}</span>
      </div>
      ${order.guestName ? `
      <div class="meta-row">
        <span class="label">Customer:</span>
        <span class="val">${order.guestName}${order.guestPhone ? ` (${order.guestPhone})` : ''}</span>
      </div>` : ''}

      <table class="bill-table">
        <thead>
          <tr>
            <th class="col-sno">#</th>
            <th class="col-item">Item</th>
            <th class="col-qty">Qty</th>
            <th class="col-rate">Rate</th>
            <th class="col-amt">Amt</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="single-line"></div>

      <div class="totals-section">
        <div class="total-row">
          <span>Items Subtotal:</span>
          <span>&#8377;${subtotal.toFixed(2)}</span>
        </div>
        ${discount > 0 ? `
        <div class="total-row" style="font-weight: 700;">
          <span>Discount Applied:</span>
          <span>-&#8377;${discount.toFixed(2)}</span>
        </div>` : ''}
        ${deliveryFee > 0 ? `
        <div class="total-row">
          <span>Delivery Charges:</span>
          <span>&#8377;${deliveryFee.toFixed(2)}</span>
        </div>` : ''}
        ${packagingFee > 0 ? `
        <div class="total-row">
          <span>Packaging Fee:</span>
          <span>&#8377;${packagingFee.toFixed(2)}</span>
        </div>` : ''}

        <!-- GST Tax Breakdown -->
        <div class="gst-breakdown">
          <div class="total-row">
            <span>Net Taxable Value:</span>
            <span>&#8377;${Math.max(0, subtotal - discount).toFixed(2)}</span>
          </div>
          <div class="total-row">
            <span>CGST (2.5%):</span>
            <span>&#8377;${cgst.toFixed(2)}</span>
          </div>
          <div class="total-row">
            <span>SGST (2.5%):</span>
            <span>&#8377;${sgst.toFixed(2)}</span>
          </div>
          <div class="total-row" style="font-weight: 700;">
            <span>Total GST Tax:</span>
            <span>&#8377;${gstTotal.toFixed(2)}</span>
          </div>
        </div>

        <div class="double-line"></div>

        <div class="grand-total-row">
          <span>GRAND TOTAL:</span>
          <span>&#8377;${grandTotal.toFixed(2)}</span>
        </div>

        <div class="double-line"></div>
      </div>

      <!-- Payment Status Box -->
      <div class="payment-box">
        ${isPaid ? `PAYMENT COMPLETED (${paymentMethodLabel})` : `PAYMENT PENDING &#8212; PLEASE SETTLE`}
      </div>

      <div class="footer">
        <div>Thank you for dining with us!</div>
        <div>Please visit again.</div>
        <div style="font-size: 8px; margin-top: 4px; color: #777;">
          Printed: ${printTimestamp} &#8226; Valid GST Retail Tax Invoice
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Directly prints the customer GST tax invoice via hidden iframe.
 */
export function printCustomerBill(options: BillPrintOptions): void {
  if (typeof window === 'undefined') return;

  const html = generateBillHtml(options);

  const fallbackWindowPrint = () => {
    try {
      const win = window.open('', '_blank', 'width=450,height=650');
      if (win) {
        win.document.open();
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => {
          try {
            win.print();
          } catch (e) {
            console.error('Bill window print execution error:', e);
          }
        }, 300);
      }
    } catch (e) {
      console.error('Bill window print fallback failed:', e);
    }
  };

  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.border = '0';
    iframe.style.opacity = '0.01';
    iframe.style.pointerEvents = 'none';
    iframe.style.zIndex = '-9999';
    document.body.appendChild(iframe);

    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.warn('Bill iframe print error, falling back to window.open:', err);
        fallbackWindowPrint();
      }
    };

    iframe.onload = () => {
      setTimeout(triggerPrint, 100);
    };

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();

      setTimeout(triggerPrint, 350);

      setTimeout(() => {
        if (iframe.parentNode) {
          document.body.removeChild(iframe);
        }
      }, 60000);
      return;
    }
  } catch (err) {
    console.error('Iframe bill print error, falling back to window.open:', err);
  }

  fallbackWindowPrint();
}

/**
 * Exports orders to a CSV format optimized for GST filings, accountants, and bookkeeping.
 */
export function exportGstOrdersCsv(orders: any[], restaurantName: string = 'Restaurant'): void {
  if (!orders || orders.length === 0) {
    return;
  }

  const headers = [
    'Invoice No',
    'Order ID',
    'Date',
    'Time',
    'Table / Mode',
    'Customer Name',
    'Customer Phone',
    'Payment Method',
    'Payment Status',
    'Taxable Subtotal (INR)',
    'Discount (INR)',
    'CGST 2.5% (INR)',
    'SGST 2.5% (INR)',
    'Total GST (INR)',
    'Delivery Fee (INR)',
    'Packaging Fee (INR)',
    'Grand Total (INR)',
  ];

  const escapeCsv = (str: string | number | null | undefined) => {
    if (str === null || str === undefined) return '""';
    const s = String(str).replace(/"/g, '""');
    return `"${s}"`;
  };

  const rows = orders.map((o) => {
    const d = o.createdAt ? new Date(o.createdAt) : new Date();
    const dateStr = d.toLocaleDateString('en-IN');
    const timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

    const sub = Number(o.subtotal || 0);
    const disc = Number(o.discount || 0);
    const gst = Number(o.gstAmount || 0);
    const cgst = gst > 0 ? (gst / 2).toFixed(2) : '0.00';
    const sgst = gst > 0 ? (gst / 2).toFixed(2) : '0.00';
    const delFee = Number(o.deliveryFee || 0).toFixed(2);
    const pkgFee = Number(o.packagingFee || 0).toFixed(2);
    const total = Number(o.total || 0).toFixed(2);

    return [
      escapeCsv(`INV-${o.id.slice(-8).toUpperCase()}`),
      escapeCsv(o.id),
      escapeCsv(dateStr),
      escapeCsv(timeStr),
      escapeCsv(o.tableNumber ? `Table ${o.tableNumber}` : 'Dine-In'),
      escapeCsv(o.guestName || o.user?.name || 'Walk-in Guest'),
      escapeCsv(o.guestPhone || o.user?.phone || ''),
      escapeCsv(o.paymentMethod || 'COUNTER_CASH'),
      escapeCsv(o.paymentStatus || 'PENDING'),
      escapeCsv(sub.toFixed(2)),
      escapeCsv(disc.toFixed(2)),
      escapeCsv(cgst),
      escapeCsv(sgst),
      escapeCsv(gst.toFixed(2)),
      escapeCsv(delFee),
      escapeCsv(pkgFee),
      escapeCsv(total),
    ].join(',');
  });

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const dateTag = new Date().toISOString().slice(0, 10);
  link.download = `GST_Sales_Report_${restaurantName.replace(/[^a-zA-Z0-9]/g, '_')}_${dateTag}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
