/**
 * Pure TypeScript GST Tax Invoice PDF Generator
 * Generates standards-compliant PDF 1.4 documents directly in the browser or Node.js.
 * Zero external runtime dependencies.
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
 * Builds standard PDF 1.4 document string containing a full GST Tax Invoice.
 */
export function buildInvoicePdfBinary(order: InvoiceOrderData, restaurantInput?: InvoiceRestaurantInfo | null): string {
  const restaurant = restaurantInput || order.restaurant || { name: 'Restaurant' };

  const width = 595.28; // Standard A4 width in pt
  const height = 841.89; // Standard A4 height in pt
  const margin = 36;
  const contentWidth = width - margin * 2;

  let stream = '';

  const esc = (s: string | number | null | undefined) =>
    String(s ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');

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
    ? String(order.tableNumber).toLowerCase().includes('room')
      ? String(order.tableNumber).toUpperCase()
      : `Table ${String(order.tableNumber).toUpperCase()}`
    : 'Dine-In';

  const verCodeStr = order.verificationCode ? `  (Verification #${order.verificationCode})` : '';
  text(`Dining Mode: ${cleanTable}${verCodeStr}`, col2X, metaBoxY + 23, '/F2', 9, 'left', 0.1, 0.1, 0.1);

  const isPaid = order.paymentStatus === 'PAID';
  const payMethod = (order.paymentMethod || 'COUNTER_CASH').replace('COUNTER_', '');
  const payStatusDesc = `${isPaid ? 'PAID' : 'PAYMENT PENDING'} via ${payMethod}`;
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
  const streamLen = Buffer.byteLength(stream, 'utf-8');
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
    offset += Buffer.byteLength(body[i], 'utf-8');
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
 * Returns a Blob with MIME type 'application/pdf'.
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
 * Opens the GST Tax Invoice PDF in a new browser tab for direct viewing or printing.
 */
export function openInvoicePdf(order: InvoiceOrderData, restaurant?: InvoiceRestaurantInfo | null): void {
  if (typeof window === 'undefined') return;

  const blob = generateInvoicePdfBlob(order, restaurant);
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}
