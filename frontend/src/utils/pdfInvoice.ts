/**
 * Pure TypeScript GST Tax Invoice & Sales Register PDF Generator
 * Generates standards-compliant PDF 1.4 documents directly in the browser or Node.js.
 * Zero external runtime dependencies. 100% browser-safe (no Node Buffer required).
 *
 * Mandatory GST & Restaurant details included:
 * - Restaurant Trade Name & Legal Entity Name
 * - Complete Address, City, State, Pincode
 * - GSTIN (GST Identification Number)
 * - FSSAI License Number (if configured)
 * - Phone & Contact details
 * - Tax Invoice Number (INV-XXXXXXXX) & Date/Time
 * - Dining Details (Table/Room Number, Guest Name, Contact)
 * - Itemized Dishes with Variants, Add-ons, Quantities, Unit Rates & Subtotals
 * - Net Taxable Value, CGST @ 2.5%, SGST @ 2.5%, Total GST Tax Breakdown
 * - Discounts, Delivery/Packaging charges (if any), Grand Total
 * - Payment Method, Settlement Status & Timestamps
 */

import { formatTableLabel } from './tableCode';

export interface InvoiceOrderItem {
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

export interface InvoiceRestaurantInfo {
  name: string;
  legalBusinessName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  pincode?: string | null;
  phone?: string | null;
  gstin?: string | null;
  fssaiNumber?: string | null;
  themeColor?: string | null;
}

export interface InvoiceOrderData {
  id: string;
  tableNumber?: string | number | null;
  guestName?: string | null;
  guestPhone?: string | null;
  user?: { name?: string | null; phone?: string | null; email?: string | null } | null;
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
  items?: InvoiceOrderItem[];
  restaurant?: InvoiceRestaurantInfo;
  [key: string]: any;
}

/**
 * Browser-safe UTF-8 byte length calculator. Does not depend on Node.js Buffer.
 */
function getByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.byteLength(str, 'utf-8');
  }
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code <= 0x7f) count += 1;
    else if (code <= 0x7ff) count += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      count += 4;
      i++;
    } else count += 3;
  }
  return count;
}

/**
 * Escapes characters for PDF string literals.
 */
function esc(s: string | number | null | undefined): string {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * Builds standard PDF 1.4 document string containing a full GST Tax Invoice for a single order.
 */
export function buildInvoicePdfBinary(order: InvoiceOrderData, restaurantInput?: InvoiceRestaurantInfo | null): string {
  const restaurant = restaurantInput || order.restaurant || { name: 'Restaurant' };

  const width = 595.28; // Standard A4 width in pt
  const height = 841.89; // Standard A4 height in pt
  const margin = 36;
  const contentWidth = width - margin * 2;

  let stream = '';

  const setFont = (font: string, size: number) => {
    stream += `${font} ${size} Tf\n`;
  };

  const setColor = (r: number, g: number, b: number) => {
    stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg\n`;
  };

  const setStrokeColor = (r: number, g: number, b: number) => {
    stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG\n`;
  };

  const rect = (x: number, y: number, w: number, h: number, fill = true, stroke = false) => {
    stream += `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${
      fill && stroke ? 'B' : fill ? 'f' : 'S'
    }\n`;
  };

  const line = (x1: number, y1: number, x2: number, y2: number, lineWidth = 1) => {
    stream += `${lineWidth} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
  };

  const text = (
    str: string,
    x: number,
    y: number,
    font = '/F1',
    size = 10,
    align: 'left' | 'right' | 'center' = 'left',
    r = 0,
    g = 0,
    b = 0
  ) => {
    setColor(r, g, b);
    setFont(font, size);
    let drawX = x;
    if (align === 'right') {
      const charWidth = font === '/F2' ? size * 0.58 : size * 0.52;
      drawX = x - str.length * charWidth;
    } else if (align === 'center') {
      const charWidth = font === '/F2' ? size * 0.58 : size * 0.52;
      drawX = x - (str.length * charWidth) / 2;
    }
    stream += `BT ${drawX.toFixed(2)} ${y.toFixed(2)} Td (${esc(str)}) Tj ET\n`;
  };

  // 1. Top Decorative Brand Accent Bar
  setColor(0.91, 0.36, 0.02); // Primary Brand Color
  rect(margin, height - 32, contentWidth, 5, true, false);

  // 2. Main Restaurant Header Box
  setColor(0.975, 0.98, 0.99);
  rect(margin, height - 128, contentWidth, 90, true, false);
  setStrokeColor(0.86, 0.89, 0.93);
  rect(margin, height - 128, contentWidth, 90, false, true);

  // Restaurant details (Left Column)
  text(restaurant.name || 'Restaurant', margin + 14, height - 60, '/F2', 17, 'left', 0.08, 0.08, 0.08);

  let currentRestY = height - 74;
  if (restaurant.legalBusinessName && restaurant.legalBusinessName !== restaurant.name) {
    text(`Legal Entity: ${restaurant.legalBusinessName}`, margin + 14, currentRestY, '/F1', 8, 'left', 0.4, 0.4, 0.4);
    currentRestY -= 12;
  }

  const addrParts = [restaurant.address, restaurant.city, restaurant.state, restaurant.pincode].filter(Boolean);
  const addrStr = addrParts.join(', ');
  if (addrStr) {
    text(addrStr.slice(0, 60), margin + 14, currentRestY, '/F1', 8.5, 'left', 0.3, 0.3, 0.3);
    currentRestY -= 12;
  }

  const contactList = [];
  if (restaurant.phone) contactList.push(`Ph: ${restaurant.phone}`);
  if (restaurant.gstin) contactList.push(`GSTIN: ${restaurant.gstin}`);
  if (restaurant.fssaiNumber) contactList.push(`FSSAI: ${restaurant.fssaiNumber}`);
  const contactStr = contactList.join('   |   ');
  text(contactStr || 'Tax Invoice Copy', margin + 14, currentRestY, '/F2', 8.5, 'left', 0.15, 0.2, 0.25);

  // Invoice Title & Numbers (Right Column)
  text('TAX INVOICE', margin + contentWidth - 14, height - 58, '/F2', 16, 'right', 0.91, 0.36, 0.02);
  const invoiceNumber = `INV-${order.id ? order.id.slice(-8).toUpperCase() : '00000000'}`;
  text(invoiceNumber, margin + contentWidth - 14, height - 74, '/F2', 9.5, 'right', 0.1, 0.1, 0.1);

  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      })
    : new Date().toLocaleDateString('en-IN');
  text(`Date: ${orderDate}`, margin + contentWidth - 14, height - 88, '/F1', 8.5, 'right', 0.35, 0.4, 0.45);
  text('Original Tax Invoice for Recipient', margin + contentWidth - 14, height - 102, '/F1', 8, 'right', 0.5, 0.55, 0.6);

  // 3. Customer & Dining Details Box
  const metaBoxY = height - 190;
  setColor(0.985, 0.985, 0.985);
  rect(margin, metaBoxY, contentWidth, 54, true, false);
  setStrokeColor(0.88, 0.90, 0.93);
  rect(margin, metaBoxY, contentWidth, 54, false, true);

  // Left Section: Customer Info
  text('BILLED TO (CUSTOMER):', margin + 14, metaBoxY + 38, '/F2', 8, 'left', 0.45, 0.5, 0.55);
  const custName = order.guestName || order.user?.name || 'Walk-in Guest';
  text(custName, margin + 14, metaBoxY + 23, '/F2', 9.5, 'left', 0.1, 0.1, 0.1);
  const custPhone = order.guestPhone || order.user?.phone || 'Direct Counter Service';
  text(custPhone, margin + 14, metaBoxY + 10, '/F1', 8.5, 'left', 0.35, 0.35, 0.35);

  // Right Section: Dining & Payment Metadata
  const col2X = margin + contentWidth / 2 + 10;
  text('DINING & PAYMENT INFORMATION:', col2X, metaBoxY + 38, '/F2', 8, 'left', 0.45, 0.5, 0.55);

  const cleanTable = order.tableNumber
    ? formatTableLabel(order.tableNumber)
    : 'Dine-In';

  const verCodeStr = order.verificationCode ? `  (Verification #${order.verificationCode})` : '';
  text(`Dining Mode: ${cleanTable}${verCodeStr}`, col2X, metaBoxY + 23, '/F2', 9, 'left', 0.1, 0.1, 0.1);

  const isPaid = order.paymentStatus === 'PAID';
  const cMethod = (order.counterPaymentMethod || '').toUpperCase();
  const pMethod = (order.paymentMethod || '').toUpperCase();
  let modeName = 'CASH';
  if (cMethod === 'UPI' || cMethod === 'COUNTER_UPI' || pMethod === 'UPI_INTENT') modeName = 'UPI';
  else if (cMethod === 'CARD') modeName = 'CARD';
  else if (cMethod === 'CASH') modeName = 'CASH';
  else if (pMethod === 'RAZORPAY') modeName = 'ONLINE (RAZORPAY)';
  else if (pMethod === 'WALLET') modeName = 'WALLET';
  else if (pMethod === 'PAY_TO_WAITER') modeName = 'PAY TO WAITER';
  else modeName = cMethod || 'CASH';

  const payStatusDesc = `${isPaid ? 'PAID' : 'PAYMENT PENDING'} via ${modeName}`;
  text(payStatusDesc, col2X, metaBoxY + 10, '/F2', 8.5, 'left', isPaid ? 0.1 : 0.8, isPaid ? 0.55 : 0.2, 0.15);

  // 4. Itemized Dish Breakdown Table Header
  const tableY = metaBoxY - 22;
  setColor(0.12, 0.15, 0.20);
  rect(margin, tableY - 18, contentWidth, 20, true, false);

  text('#', margin + 10, tableY - 12, '/F2', 8.5, 'left', 1, 1, 1);
  text('ITEM DESCRIPTION', margin + 35, tableY - 12, '/F2', 8.5, 'left', 1, 1, 1);
  text('QTY', margin + contentWidth - 170, tableY - 12, '/F2', 8.5, 'center', 1, 1, 1);
  text('RATE (Rs.)', margin + contentWidth - 95, tableY - 12, '/F2', 8.5, 'right', 1, 1, 1);
  text('AMOUNT (Rs.)', margin + contentWidth - 10, tableY - 12, '/F2', 8.5, 'right', 1, 1, 1);

  // Item Rows
  let rowY = tableY - 36;
  const items = order.items || [];
  items.forEach((item, idx) => {
    const isEven = idx % 2 === 0;
    if (isEven) {
      setColor(0.98, 0.98, 0.99);
      rect(margin, rowY - 6, contentWidth, 18, true, false);
    }
    setStrokeColor(0.92, 0.93, 0.95);
    line(margin, rowY - 6, margin + contentWidth, rowY - 6, 0.5);

    text(String(idx + 1), margin + 10, rowY, '/F1', 8.5, 'left', 0.3, 0.3, 0.3);

    const itemName =
      (item.menuItem?.name || item.name || 'Dish Item') +
      (item.variant?.name ? ` (${item.variant.name})` : '') +
      (item.isAddon ? '  [Add-on]' : '');

    text(itemName.slice(0, 48), margin + 35, rowY, '/F2', 8.5, 'left', 0.12, 0.12, 0.12);

    const qty = item.quantity || 1;
    const rate = Number(item.unitPrice || (item.subtotal ? item.subtotal / qty : 0));
    const sub = Number(item.subtotal || rate * qty);

    text(String(qty), margin + contentWidth - 170, rowY, '/F2', 8.5, 'center', 0.1, 0.1, 0.1);
    text(rate.toFixed(2), margin + contentWidth - 95, rowY, '/F1', 8.5, 'right', 0.3, 0.3, 0.3);
    text(sub.toFixed(2), margin + contentWidth - 10, rowY, '/F2', 8.5, 'right', 0.1, 0.1, 0.1);

    rowY -= 18;
  });

  // Table bottom border
  setStrokeColor(0.78, 0.81, 0.85);
  line(margin, rowY - 4, margin + contentWidth, rowY - 4, 1);

  // 5. Calculations & Tax Summary Box
  const calcBoxWidth = 250;
  const calcBoxX = margin + contentWidth - calcBoxWidth;
  let calcY = rowY - 20;

  const subtotal = Number(order.subtotal || 0);
  const discount = Number(order.discount || 0);
  const gstTotal = Number(order.gstAmount || 0);
  const cgst = gstTotal > 0 ? gstTotal / 2 : 0;
  const sgst = gstTotal > 0 ? gstTotal / 2 : 0;
  const taxableVal = Math.max(0, subtotal - discount);
  const grandTotal = Number(order.total || 0);

  const drawCalcRow = (label: string, valStr: string, isBold = false, isAccent = false) => {
    text(
      label,
      calcBoxX,
      calcY,
      isBold ? '/F2' : '/F1',
      isAccent ? 10.5 : 8.5,
      'left',
      isAccent ? 0.91 : 0.25,
      isAccent ? 0.36 : 0.25,
      isAccent ? 0.02 : 0.25
    );
    text(
      `Rs. ${valStr}`,
      margin + contentWidth - 10,
      calcY,
      isBold ? '/F2' : '/F1',
      isAccent ? 12 : 8.5,
      'right',
      isAccent ? 0.91 : 0.1,
      isAccent ? 0.36 : 0.1,
      isAccent ? 0.02 : 0.1
    );
    calcY -= 14;
  };

  drawCalcRow('Items Subtotal:', subtotal.toFixed(2));
  if (discount > 0) drawCalcRow('Discount Applied:', `-${discount.toFixed(2)}`, true);
  drawCalcRow('Net Taxable Value:', taxableVal.toFixed(2));
  drawCalcRow('CGST (2.5%):', cgst.toFixed(2));
  drawCalcRow('SGST (2.5%):', sgst.toFixed(2));
  drawCalcRow('Total GST Tax:', gstTotal.toFixed(2), true);

  if (Number(order.deliveryFee || 0) > 0) {
    drawCalcRow('Delivery Fee:', Number(order.deliveryFee).toFixed(2));
  }
  if (Number(order.packagingFee || 0) > 0) {
    drawCalcRow('Packaging Fee:', Number(order.packagingFee).toFixed(2));
  }

  setStrokeColor(0.85, 0.88, 0.92);
  line(calcBoxX, calcY + 6, margin + contentWidth, calcY + 6, 1);
  calcY -= 6;

  // Grand Total Highlight Container
  setColor(0.985, 0.955, 0.93);
  rect(calcBoxX - 6, calcY - 8, calcBoxWidth + 6, 23, true, false);
  setStrokeColor(0.91, 0.36, 0.02);
  rect(calcBoxX - 6, calcY - 8, calcBoxWidth + 6, 23, false, true);

  drawCalcRow('GRAND TOTAL:', grandTotal.toFixed(2), true, true);

  // 6. Left Side: Tax Compliance & Terms
  const termsX = margin;
  let termsY = rowY - 20;
  text('TAX INVOICE NOTES & COMPLIANCE:', termsX, termsY, '/F2', 8, 'left', 0.4, 0.45, 0.5);
  termsY -= 12;
  text('1. GST is charged as per restaurant dining tax regulations (CGST 2.5% + SGST 2.5%).', termsX, termsY, '/F1', 7.5, 'left', 0.38, 0.38, 0.38);
  termsY -= 10;
  text('2. This invoice qualifies as official receipt for GST input tax credit and business records.', termsX, termsY, '/F1', 7.5, 'left', 0.38, 0.38, 0.38);
  termsY -= 10;
  text('3. In case of any billing discrepancies, please contact customer support or restaurant manager.', termsX, termsY, '/F1', 7.5, 'left', 0.38, 0.38, 0.38);

  // 7. Footer
  const footerY = 48;
  setStrokeColor(0.90, 0.92, 0.94);
  line(margin, footerY + 16, margin + contentWidth, footerY + 16, 1);
  text(
    `Thank you for dining with ${restaurant.name || 'us'}! Hope to see you again soon.`,
    margin + contentWidth / 2,
    footerY + 4,
    '/F2',
    9,
    'center',
    0.2,
    0.2,
    0.2
  );
  text(
    `Valid GST Retail Tax Invoice • Generated on ${new Date().toLocaleString('en-IN')}`,
    margin + contentWidth / 2,
    footerY - 8,
    '/F1',
    7.5,
    'center',
    0.5,
    0.5,
    0.5
  );

  // Assemble PDF Document
  const streamLen = getByteLength(stream);
  const body = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 6 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>\nendobj\n`,
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n',
    `6 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`,
  ];

  let offset = 15;
  const offsets: number[] = [];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';

  for (let i = 0; i < body.length; i++) {
    offsets.push(offset);
    offset += getByteLength(body[i]);
    pdf += body[i];
  }

  const startxref = offset;
  pdf += 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 0; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;

  return pdf;
}

/**
 * Builds standard PDF 1.4 document containing a multi-order GST Sales & Tax Invoice Register.
 * Formatted in A4 Landscape for clear tabular visibility with full GST breakdown.
 * Automatically paginates across multiple pages if order count exceeds 1 page.
 */
export function buildGstRegisterPdfBinary(orders: InvoiceOrderData[], restaurantInput?: InvoiceRestaurantInfo | null): string {
  const restaurant = restaurantInput || { name: 'Restaurant' };
  const width = 841.89; // Landscape A4 width
  const height = 595.28; // Landscape A4 height
  const margin = 36;
  const contentWidth = width - margin * 2;

  // Calculate totals
  let totalGross = 0;
  let totalTaxable = 0;
  let totalGst = 0;
  let totalCgst = 0;
  let totalSgst = 0;

  const validOrders = Array.isArray(orders) ? orders : [];
  validOrders.forEach((o) => {
    const tot = Number(o.total || 0);
    const sub = Number(o.subtotal || 0);
    const disc = Number(o.discount || 0);
    const gst = Number(o.gstAmount || 0);
    const taxVal = Math.max(0, sub - disc);

    totalGross += tot;
    totalTaxable += taxVal;
    totalGst += gst;
    totalCgst += gst / 2;
    totalSgst += gst / 2;
  });

  const pages: string[] = [];
  const rowsPerPageFirst = 15;
  const rowsPerPageSubsequent = 22;

  let currentOrderIdx = 0;
  let pageNum = 1;

  while (currentOrderIdx < validOrders.length || pageNum === 1) {
    const isFirstPage = pageNum === 1;
    const capacity = isFirstPage ? rowsPerPageFirst : rowsPerPageSubsequent;
    const pageOrders = validOrders.slice(currentOrderIdx, currentOrderIdx + capacity);
    currentOrderIdx += capacity;
    const isLastPage = currentOrderIdx >= validOrders.length;

    let stream = '';

    const setFont = (font: string, size: number) => {
      stream += `${font} ${size} Tf\n`;
    };
    const setColor = (r: number, g: number, b: number) => {
      stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} rg\n`;
    };
    const setStrokeColor = (r: number, g: number, b: number) => {
      stream += `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)} RG\n`;
    };
    const rect = (x: number, y: number, w: number, h: number, fill = true, stroke = false) => {
      stream += `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${
        fill && stroke ? 'B' : fill ? 'f' : 'S'
      }\n`;
    };
    const line = (x1: number, y1: number, x2: number, y2: number, lw = 1) => {
      stream += `${lw} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
    };
    const text = (str: string, x: number, y: number, font = '/F1', size = 9, align: 'left' | 'right' | 'center' = 'left', r = 0, g = 0, b = 0) => {
      setColor(r, g, b);
      setFont(font, size);
      let drawX = x;
      const charWidth = font === '/F2' ? size * 0.58 : size * 0.52;
      if (align === 'right') {
        drawX = x - str.length * charWidth;
      } else if (align === 'center') {
        drawX = x - (str.length * charWidth) / 2;
      }
      stream += `BT ${drawX.toFixed(2)} ${y.toFixed(2)} Td (${esc(str)}) Tj ET\n`;
    };

    // Header top brand bar
    setColor(0.91, 0.36, 0.02);
    rect(margin, height - 24, contentWidth, 4, true, false);

    let startY = height - 34;

    if (isFirstPage) {
      // Restaurant Header Box
      setColor(0.98, 0.98, 0.99);
      rect(margin, startY - 70, contentWidth, 70, true, false);
      setStrokeColor(0.88, 0.90, 0.93);
      rect(margin, startY - 70, contentWidth, 70, false, true);

      // Left Column: Restaurant Info
      text(restaurant.name || 'Restaurant', margin + 14, startY - 20, '/F2', 15, 'left', 0.1, 0.1, 0.1);
      let rY = startY - 34;
      if (restaurant.legalBusinessName && restaurant.legalBusinessName !== restaurant.name) {
        text(`Legal Name: ${restaurant.legalBusinessName}`, margin + 14, rY, '/F1', 8, 'left', 0.4, 0.4, 0.4);
        rY -= 11;
      }
      const addr = [restaurant.address, restaurant.city, restaurant.state, restaurant.pincode].filter(Boolean).join(', ');
      if (addr) {
        text(addr.slice(0, 75), margin + 14, rY, '/F1', 8, 'left', 0.35, 0.35, 0.35);
        rY -= 11;
      }
      const tags = [];
      if (restaurant.gstin) tags.push(`GSTIN: ${restaurant.gstin}`);
      if (restaurant.fssaiNumber) tags.push(`FSSAI: ${restaurant.fssaiNumber}`);
      if (restaurant.phone) tags.push(`Ph: ${restaurant.phone}`);
      text(tags.join('   |   ') || 'Official GST Sales Record', margin + 14, rY, '/F2', 8, 'left', 0.15, 0.2, 0.25);

      // Right Column: Title & Generation Date
      text('GST SALES & TAX INVOICE REGISTER', margin + contentWidth - 14, startY - 20, '/F2', 14, 'right', 0.91, 0.36, 0.02);
      text('Summary of Invoices under Section 31 of CGST Act, 2017', margin + contentWidth - 14, startY - 34, '/F1', 8, 'right', 0.45, 0.45, 0.45);
      text(`Generated: ${new Date().toLocaleString('en-IN')}`, margin + contentWidth - 14, startY - 46, '/F1', 8, 'right', 0.4, 0.4, 0.4);
      text(`Total Invoices: ${validOrders.length} Order(s)`, margin + contentWidth - 14, startY - 58, '/F2', 8.5, 'right', 0.1, 0.1, 0.1);

      // 4 Metric Highlight Cards
      const cardY = startY - 114;
      const cardWidth = (contentWidth - 30) / 4;
      const cards = [
        { label: 'TOTAL INVOICES', val: String(validOrders.length), sub: 'Recorded Orders' },
        { label: 'TAXABLE TURNOVER', val: `Rs. ${totalTaxable.toFixed(2)}`, sub: 'Net of Discounts' },
        { label: 'TOTAL GST COLLECTED', val: `Rs. ${totalGst.toFixed(2)}`, sub: `CGST ${totalCgst.toFixed(2)} + SGST ${totalSgst.toFixed(2)}` },
        { label: 'GROSS GRAND TOTAL', val: `Rs. ${totalGross.toFixed(2)}`, sub: 'Net Realized Value' },
      ];

      cards.forEach((c, idx) => {
        const cx = margin + idx * (cardWidth + 10);
        setColor(0.985, 0.985, 0.985);
        rect(cx, cardY, cardWidth, 36, true, false);
        setStrokeColor(0.88, 0.90, 0.93);
        rect(cx, cardY, cardWidth, 36, false, true);

        text(c.label, cx + 8, cardY + 24, '/F2', 7.5, 'left', 0.45, 0.5, 0.55);
        text(c.val, cx + 8, cardY + 11, '/F2', 10, 'left', idx === 3 ? 0.91 : 0.1, idx === 3 ? 0.36 : 0.1, idx === 3 ? 0.02 : 0.1);
        text(c.sub, cx + 8, cardY + 2, '/F1', 6.5, 'left', 0.5, 0.5, 0.5);
      });

      startY = cardY - 14;
    } else {
      text(`${restaurant.name || 'Restaurant'} - GST Tax Invoices Register (Page ${pageNum})`, margin, startY - 12, '/F2', 10, 'left', 0.2, 0.2, 0.2);
      text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, margin + contentWidth, startY - 12, '/F1', 8, 'right', 0.4, 0.4, 0.4);
      startY -= 24;
    }

    // Table Header
    const colDefs = [
      { id: 'num', label: '#', w: 25, align: 'left' as const },
      { id: 'date', label: 'DATE & TIME', w: 85, align: 'left' as const },
      { id: 'inv', label: 'INVOICE NO', w: 80, align: 'left' as const },
      { id: 'table', label: 'TABLE / ROOM', w: 65, align: 'left' as const },
      { id: 'cust', label: 'CUSTOMER / PHONE', w: 105, align: 'left' as const },
      { id: 'taxable', label: 'TAXABLE (Rs.)', w: 80, align: 'right' as const },
      { id: 'cgst', label: 'CGST 2.5%', w: 60, align: 'right' as const },
      { id: 'sgst', label: 'SGST 2.5%', w: 60, align: 'right' as const },
      { id: 'gst', label: 'GST (Rs.)', w: 60, align: 'right' as const },
      { id: 'total', label: 'TOTAL (Rs.)', w: 75, align: 'right' as const },
      { id: 'status', label: 'STATUS', w: 70, align: 'center' as const },
    ];

    setColor(0.12, 0.15, 0.20);
    rect(margin, startY - 16, contentWidth, 18, true, false);

    let curColX = margin + 6;
    colDefs.forEach((col) => {
      const tx = col.align === 'right' ? curColX + col.w - 10 : col.align === 'center' ? curColX + col.w / 2 : curColX;
      text(col.label, tx, startY - 12, '/F2', 7.5, col.align, 1, 1, 1);
      curColX += col.w;
    });

    let rowY = startY - 32;

    pageOrders.forEach((o, rowIdx) => {
      const isEven = rowIdx % 2 === 0;
      if (isEven) {
        setColor(0.985, 0.985, 0.99);
        rect(margin, rowY - 5, contentWidth, 16, true, false);
      }
      setStrokeColor(0.92, 0.93, 0.95);
      line(margin, rowY - 5, margin + contentWidth, rowY - 5, 0.5);

      const d = o.createdAt ? new Date(o.createdAt) : new Date();
      const dateStr =
        d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) +
        ' ' +
        d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });

      const invNo = `INV-${(o.id || '').slice(-8).toUpperCase()}`;
      const tableStr = o.tableNumber
        ? String(o.tableNumber).toLowerCase().includes('room')
          ? String(o.tableNumber)
          : `Table ${o.tableNumber}`
        : 'Dine-In';

      const custName = (o.guestName || o.user?.name || 'Guest').slice(0, 14);
      const custPhone = o.guestPhone || o.user?.phone || '';
      const custCombined = custPhone ? `${custName} (${custPhone.slice(-4)})` : custName;

      const sub = Number(o.subtotal || 0);
      const disc = Number(o.discount || 0);
      const gst = Number(o.gstAmount || 0);
      const cgst = gst / 2;
      const sgst = gst / 2;
      const taxVal = Math.max(0, sub - disc);
      const tot = Number(o.total || 0);

      const cMethod = (o.counterPaymentMethod || '').toUpperCase();
      const pMethod = (o.paymentMethod || '').toUpperCase();
      let modeTag = 'CASH';
      if (cMethod === 'UPI' || cMethod === 'COUNTER_UPI' || pMethod === 'UPI_INTENT') modeTag = 'UPI';
      else if (cMethod === 'CARD') modeTag = 'CARD';
      else if (pMethod === 'RAZORPAY') modeTag = 'ONLINE';
      else if (pMethod === 'WALLET') modeTag = 'WALLET';
      else modeTag = cMethod || 'CASH';

      const statusStr =
        (o.paymentStatus === 'PAID' ? 'PAID' : 'PENDING') +
        ' • ' +
        modeTag;

      const globalIdx = (pageNum === 1 ? 0 : rowsPerPageFirst + (pageNum - 2) * rowsPerPageSubsequent) + rowIdx + 1;

      const values = [
        { val: String(globalIdx), w: 25, align: 'left' as const, font: '/F1', bold: false },
        { val: dateStr, w: 85, align: 'left' as const, font: '/F1', bold: false },
        { val: invNo, w: 80, align: 'left' as const, font: '/F2', bold: true },
        { val: tableStr, w: 65, align: 'left' as const, font: '/F1', bold: false },
        { val: custCombined, w: 105, align: 'left' as const, font: '/F1', bold: false },
        { val: taxVal.toFixed(2), w: 80, align: 'right' as const, font: '/F1', bold: false },
        { val: cgst.toFixed(2), w: 60, align: 'right' as const, font: '/F1', bold: false },
        { val: sgst.toFixed(2), w: 60, align: 'right' as const, font: '/F1', bold: false },
        { val: gst.toFixed(2), w: 60, align: 'right' as const, font: '/F2', bold: true },
        { val: tot.toFixed(2), w: 75, align: 'right' as const, font: '/F2', bold: true, r: 0.91, g: 0.36, b: 0.02 },
        {
          val: statusStr,
          w: 70,
          align: 'center' as const,
          font: '/F1',
          bold: false,
          r: o.paymentStatus === 'PAID' ? 0.1 : 0.7,
          g: o.paymentStatus === 'PAID' ? 0.5 : 0.2,
          b: 0.1,
        },
      ];

      let cellX = margin + 6;
      values.forEach((v) => {
        const tx = v.align === 'right' ? cellX + v.w - 10 : v.align === 'center' ? cellX + v.w / 2 : cellX;
        text(v.val, tx, rowY, v.font, 7.5, v.align, v.r || 0.15, v.g || 0.15, v.b || 0.15);
        cellX += v.w;
      });

      rowY -= 16;
    });

    if (isLastPage) {
      setColor(0.94, 0.96, 0.98);
      rect(margin, rowY - 6, contentWidth, 18, true, false);
      setStrokeColor(0.75, 0.8, 0.85);
      line(margin, rowY - 6, margin + contentWidth, rowY - 6, 1);
      line(margin, rowY + 12, margin + contentWidth, rowY + 12, 1);

      text('TOTALS (ALL ORDERS):', margin + 35, rowY - 1, '/F2', 8, 'left', 0.1, 0.1, 0.1);

      text(`Rs. ${totalTaxable.toFixed(2)}`, margin + 6 + 25 + 85 + 80 + 65 + 105 + 80 - 10, rowY - 1, '/F2', 8, 'right', 0.1, 0.1, 0.1);
      text(`Rs. ${totalCgst.toFixed(2)}`, margin + 6 + 25 + 85 + 80 + 65 + 105 + 80 + 60 - 10, rowY - 1, '/F2', 8, 'right', 0.1, 0.1, 0.1);
      text(`Rs. ${totalSgst.toFixed(2)}`, margin + 6 + 25 + 85 + 80 + 65 + 105 + 80 + 60 + 60 - 10, rowY - 1, '/F2', 8, 'right', 0.1, 0.1, 0.1);
      text(`Rs. ${totalGst.toFixed(2)}`, margin + 6 + 25 + 85 + 80 + 65 + 105 + 80 + 60 + 60 + 60 - 10, rowY - 1, '/F2', 8, 'right', 0.1, 0.1, 0.1);
      text(
        `Rs. ${totalGross.toFixed(2)}`,
        margin + 6 + 25 + 85 + 80 + 65 + 105 + 80 + 60 + 60 + 60 + 75 - 10,
        rowY - 1,
        '/F2',
        8.5,
        'right',
        0.91,
        0.36,
        0.02
      );

      rowY -= 26;

      setColor(0.985, 0.985, 0.985);
      rect(margin, rowY - 26, contentWidth, 26, true, false);
      setStrokeColor(0.85, 0.88, 0.92);
      rect(margin, rowY - 26, contentWidth, 26, false, true);

      text('STATUTORY DECLARATION & GST COMPLIANCE NOTICE:', margin + 10, rowY - 8, '/F2', 7, 'left', 0.3, 0.3, 0.3);
      text('1. Invoices recorded herein are issued in accordance with Rule 46 of Central Goods and Services Tax Rules, 2017.', margin + 10, rowY - 17, '/F1', 6.5, 'left', 0.45, 0.45, 0.45);
      text('2. Restaurant services are taxed under SAC Code 9963 at composite 5% GST (CGST 2.5% + SGST 2.5%). Certified authentic sales register.', margin + 10, rowY - 24, '/F1', 6.5, 'left', 0.45, 0.45, 0.45);
    }

    const footerY = 16;
    setStrokeColor(0.9, 0.92, 0.94);
    line(margin, footerY + 12, margin + contentWidth, footerY + 12, 0.8);
    text(`GST Sales Register • Generated on ${new Date().toLocaleString('en-IN')}`, margin, footerY + 2, '/F1', 7, 'left', 0.5, 0.5, 0.5);
    text(`Page ${pageNum}`, margin + contentWidth, footerY + 2, '/F1', 7, 'right', 0.5, 0.5, 0.5);

    pages.push(stream);
    pageNum++;
  }

  const pageCount = pages.length;
  const kids: string[] = [];
  const body: string[] = [];

  body.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  for (let i = 0; i < pageCount; i++) {
    kids.push(`${5 + i * 2} 0 R`);
  }

  body.push(`2 0 obj\n<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pageCount} >>\nendobj\n`);
  body.push('3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  body.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n');

  for (let i = 0; i < pageCount; i++) {
    const pageObjId = 5 + i * 2;
    const contentObjId = 6 + i * 2;
    const stream = pages[i];
    const streamLen = getByteLength(stream);

    body.push(
      `${pageObjId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contentObjId} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>\nendobj\n`
    );
    body.push(`${contentObjId} 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}endstream\nendobj\n`);
  }

  const totalObjs = 4 + pageCount * 2;
  let offset = 15;
  const offsets: number[] = [];
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';

  for (let i = 0; i < body.length; i++) {
    offsets.push(offset);
    offset += getByteLength(body[i]);
    pdf += body[i];
  }

  const startxref = offset;
  pdf += `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 0; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;

  return pdf;
}

/**
 * Returns a Blob with MIME type 'application/pdf' for single order invoice.
 */
export function generateInvoicePdfBlob(order: InvoiceOrderData, restaurant?: InvoiceRestaurantInfo | null): Blob {
  const binaryString = buildInvoicePdfBinary(order, restaurant);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i) & 0xff;
  }
  return new Blob([bytes], { type: 'application/pdf' });
}

/**
 * Returns a Blob with MIME type 'application/pdf' for GST register report.
 */
export function generateGstRegisterPdfBlob(orders: InvoiceOrderData[], restaurant?: InvoiceRestaurantInfo | null): Blob {
  const binaryString = buildGstRegisterPdfBinary(orders, restaurant);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i) & 0xff;
  }
  return new Blob([bytes], { type: 'application/pdf' });
}

/**
 * Directly downloads the GST Tax Invoice as a genuine .pdf file.
 */
export function downloadInvoicePdf(order: InvoiceOrderData, restaurant?: InvoiceRestaurantInfo | null): void {
  if (typeof window === 'undefined') return;

  const blob = generateInvoicePdfBlob(order, restaurant);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const shortId = order.id ? order.id.slice(-8).toUpperCase() : 'ORDER';
  link.download = `Invoice-${shortId}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Directly downloads the GST Sales Register as a genuine .pdf file.
 */
export function downloadGstRegisterPdf(orders: InvoiceOrderData[], restaurant?: InvoiceRestaurantInfo | null): void {
  if (typeof window === 'undefined') return;

  const blob = generateGstRegisterPdfBlob(orders, restaurant);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const cleanName = (restaurant?.name || 'Restaurant').replace(/[^a-zA-Z0-9]/g, '_');
  const dateStr = new Date().toISOString().split('T')[0];
  link.download = `GST_Tax_Invoices_${cleanName}_${dateStr}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Opens the GST Tax Invoice PDF in a new browser tab for direct viewing or printing.
 */
export function openInvoicePdf(order: InvoiceOrderData, restaurant?: InvoiceRestaurantInfo | null): void {
  if (typeof window === 'undefined') return;

  const blob = generateInvoicePdfBlob(order, restaurant);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}

/**
 * Opens the GST Sales Register PDF in a new browser tab.
 */
export function openGstRegisterPdf(orders: InvoiceOrderData[], restaurant?: InvoiceRestaurantInfo | null): void {
  if (typeof window === 'undefined') return;

  const blob = generateGstRegisterPdfBlob(orders, restaurant);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}
