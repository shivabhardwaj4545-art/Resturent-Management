/**
 * Thermal Kitchen Order Ticket (KOT) Printing Utility
 * Formatted for standard 80mm / 58mm POS receipt printers.
 */

export interface KotItem {
  id?: string;
  quantity: number;
  name?: string;
  menuItem?: { name?: string; image?: string | null };
  variant?: { name?: string } | null;
  unitPrice?: number;
  subtotal?: number;
  addOns?: any;
  notes?: string;
  isAddon?: boolean;
}

export interface KotPrintOptions {
  order: {
    id: string;
    tableNumber?: string | number | null;
    guestName?: string | null;
    guestPhone?: string | null;
    createdAt?: string;
    verificationCode?: string | null;
    paymentMethod?: string;
    paymentStatus?: string;
    notes?: string | null;
    specialInstructions?: string | null;
    isAddon?: boolean;
    isNewAddon?: boolean;
    addOnStatus?: string | null;
    batchNumber?: number | null;
    orderSource?: 'QR' | 'MANUAL';
    kotNumber?: string | number | null;
    isReprint?: boolean;
    items?: KotItem[];
  };
  restaurantName?: string;
  isAddonOnly?: boolean;
  isReprint?: boolean;
  orderSource?: 'QR' | 'MANUAL';
  paperWidth?: '80mm' | '58mm';
}

export function parseKotAddOns(addOns: any): Array<{ name: string; price?: number }> {
  if (!addOns) return [];
  if (Array.isArray(addOns)) {
    return addOns.map((ao) => {
      if (typeof ao === 'string') return { name: ao };
      return { name: ao.name || 'Customization', price: ao.price };
    });
  }
  if (typeof addOns === 'string') {
    try {
      const parsed = JSON.parse(addOns);
      if (Array.isArray(parsed)) return parseKotAddOns(parsed);
      return [{ name: String(parsed) }];
    } catch {
      return [{ name: addOns }];
    }
  }
  return [];
}

export function generateKotHtml(options: KotPrintOptions): string {
  const { order, restaurantName = 'RESTAURANT', isAddonOnly = false, paperWidth = '80mm' } = options;

  const isAddonOrder = Boolean(order.isNewAddon || order.isAddon || isAddonOnly || (order.batchNumber && order.batchNumber > 1));
  const isReprint = Boolean(options.isReprint || order.isReprint);
  const orderSource = options.orderSource || order.orderSource || (order.guestName?.toLowerCase().includes('manual') ? 'MANUAL' : 'QR');
  const orderShortId = order.id ? order.id.slice(-8).toUpperCase() : 'NEW';
  const kotNumber = order.kotNumber ? String(order.kotNumber) : (order.batchNumber ? `KOT-${order.batchNumber}` : `KOT-${orderShortId}`);

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
    second: '2-digit',
    hour12: true,
  });

  // Filter items if isAddonOnly is requested
  const itemsToPrint = (order.items || []).filter((item) => {
    if (isAddonOnly) {
      return Boolean(item.isAddon);
    }
    return true;
  });

  const totalQuantity = itemsToPrint.reduce((acc, item) => acc + (Number(item.quantity) || 1), 0);
  const totalItemsCount = itemsToPrint.length;

  // Format destination (Table / Room / Takeaway)
  let destinationText = 'COUNTER / TAKEAWAY';
  if (order.tableNumber !== undefined && order.tableNumber !== null && String(order.tableNumber).trim() !== '') {
    const rawTable = String(order.tableNumber).trim();
    if (rawTable.toLowerCase().includes('room') || rawTable.toLowerCase().includes('suite')) {
      destinationText = rawTable.toLowerCase().startsWith('room') ? rawTable.toUpperCase() : `ROOM ${rawTable.toUpperCase()}`;
    } else {
      destinationText = rawTable.toLowerCase().startsWith('table') ? rawTable.toUpperCase() : `TABLE ${rawTable.toUpperCase()}`;
    }
  }

  const is58mm = paperWidth === '58mm';
  const pageWidth = is58mm ? '54mm' : '76mm';
  const pageSize = is58mm ? '58mm auto' : '80mm auto';
  const baseFontSize = is58mm ? '11px' : '13px';

  const itemsHtml = itemsToPrint.map((item) => {
    const itemName = item.menuItem?.name || item.name || 'Item';
    const variantName = item.variant?.name ? ` (${item.variant.name})` : '';
    const addOns = parseKotAddOns(item.addOns);
    const itemNotes = item.notes ? item.notes.trim() : '';

    return `
      <tr class="item-row">
        <td class="col-qty">[ ${item.quantity} ]</td>
        <td class="col-item">
          <div class="item-name">${itemName}${variantName} ${item.isAddon ? '<span class="addon-tag">⚡ADD-ON</span>' : ''}</div>
          ${addOns.length > 0 ? `<div class="item-addons">+ ${addOns.map(ao => ao.name + (ao.price ? ` (+₹${ao.price})` : '')).join(', ')}</div>` : ''}
          ${itemNotes ? `<div class="item-notes">>> Note: ${itemNotes}</div>` : ''}
        </td>
      </tr>
    `;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>${kotNumber} - ${destinationText}</title>
      <style>
        @page {
          size: ${pageSize};
          margin: 2mm;
        }
        @media print {
          html, body {
            width: ${pageWidth};
            margin: 0;
            padding: 0;
            background: #fff;
            color: #000;
          }
          .no-print {
            display: none !important;
          }
        }
        body {
          font-family: 'Courier New', Courier, monospace, -apple-system, sans-serif;
          width: ${pageWidth};
          margin: 0 auto;
          padding: 4px;
          background: #fff;
          color: #000;
          font-size: ${baseFontSize};
          line-height: 1.25;
          box-sizing: border-box;
        }
        .text-center { text-align: center; }
        .text-right { text-align: right; }
        .font-bold { font-weight: bold; }
        .reprint-banner {
          background: #000;
          color: #fff;
          font-size: 15px;
          font-weight: 900;
          padding: 3px 6px;
          text-align: center;
          letter-spacing: 2px;
          margin-bottom: 4px;
        }
        .rest-title {
          font-size: 16px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .kot-heading {
          font-size: 13px;
          font-weight: 900;
          margin: 3px 0;
          letter-spacing: 1px;
        }
        .addon-heading {
          font-size: 12px;
          font-weight: 900;
          background: #000;
          color: #fff;
          padding: 2px 4px;
          display: inline-block;
          margin: 3px 0;
        }
        .dashed-line {
          border-top: 1px dashed #000;
          margin: 4px 0;
        }
        .solid-line {
          border-top: 2px solid #000;
          margin: 5px 0;
        }
        .meta-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 11px;
          margin: 3px 0;
        }
        .meta-table td {
          padding: 1px 0;
          vertical-align: top;
        }
        .meta-label {
          font-weight: bold;
          width: 30%;
        }
        .meta-value {
          width: 70%;
        }
        .destination-box {
          border: 2px solid #000;
          padding: 4px;
          margin: 4px 0;
          text-align: center;
          font-size: 18px;
          font-weight: 900;
          letter-spacing: 1px;
        }
        .items-table {
          width: 100%;
          border-collapse: collapse;
          margin-top: 4px;
        }
        .items-table th {
          border-bottom: 1.5px solid #000;
          padding: 3px 0;
          text-align: left;
          font-size: 11px;
          font-weight: 900;
        }
        .items-table td {
          padding: 3px 0;
          vertical-align: top;
        }
        .col-qty {
          width: 44px;
          font-size: 14px;
          font-weight: 900;
          white-space: nowrap;
        }
        .col-item {
          font-size: 12px;
        }
        .item-name {
          font-weight: 900;
          font-size: 13px;
          line-height: 1.2;
        }
        .addon-tag {
          font-size: 9px;
          font-weight: 900;
          background: #000;
          color: #fff;
          padding: 1px 3px;
          margin-left: 4px;
          vertical-align: middle;
        }
        .item-addons {
          font-size: 10px;
          color: #222;
          margin-top: 2px;
        }
        .item-notes {
          font-size: 10px;
          font-weight: bold;
          font-style: italic;
          margin-top: 2px;
        }
        .summary-box {
          margin-top: 4px;
          font-size: 11px;
          font-weight: bold;
          display: flex;
          justify-content: space-between;
        }
        .instruction-box {
          border: 1px dashed #000;
          padding: 4px;
          margin: 4px 0;
          font-size: 10px;
        }
        .footer-note {
          text-align: center;
          font-size: 9px;
          margin-top: 4px;
          color: #444;
        }
      </style>
    </head>
    <body>
      ${isReprint ? '<div class="reprint-banner">** REPRINT **</div>' : ''}

      <div class="text-center">
        <div class="rest-title">${restaurantName}</div>
        ${isAddonOrder ? '<div class="addon-heading">*** ⚡ ADD-ON KOT ⚡ ***</div>' : '<div class="kot-heading">*** PHYSICAL KOT ***</div>'}
      </div>

      <div class="destination-box">
        ${destinationText}
      </div>

      <table class="meta-table">
        <tr>
          <td class="meta-label">KOT NO:</td>
          <td class="meta-value font-bold">#${kotNumber}</td>
        </tr>
        <tr>
          <td class="meta-label">SOURCE:</td>
          <td class="meta-value font-bold">${orderSource === 'MANUAL' ? 'MANUAL COUNTER' : 'CUSTOMER QR'}</td>
        </tr>
        <tr>
          <td class="meta-label">ORDER REF:</td>
          <td class="meta-value font-bold">#${orderShortId} ${order.batchNumber ? `(Batch #${order.batchNumber})` : ''}</td>
        </tr>
        <tr>
          <td class="meta-label">DATE/TIME:</td>
          <td class="meta-value">${formattedDate}</td>
        </tr>
        ${order.verificationCode ? `
        <tr>
          <td class="meta-label">VERIF CODE:</td>
          <td class="meta-value font-bold">#${order.verificationCode}</td>
        </tr>` : ''}
        ${order.guestName ? `
        <tr>
          <td class="meta-label">GUEST:</td>
          <td class="meta-value">${order.guestName}</td>
        </tr>` : ''}
      </table>

      <div class="solid-line"></div>

      <table class="items-table">
        <thead>
          <tr>
            <th class="col-qty">QTY</th>
            <th class="col-item">ITEM DESCRIPTION</th>
          </tr>
        </thead>
        <tbody>
          ${itemsHtml}
        </tbody>
      </table>

      <div class="dashed-line"></div>

      <div class="summary-box">
        <span>Items: ${totalItemsCount}</span>
        <span>Total Qty: ${totalQuantity}</span>
      </div>

      ${(order.specialInstructions || order.notes) ? `
      <div class="instruction-box">
        <span class="font-bold">KITCHEN NOTE:</span> ${(order.specialInstructions || order.notes)}
      </div>` : ''}

      <div class="solid-line"></div>

      <div class="footer-note">
        ${isReprint ? '<div style="font-weight:900; margin-bottom:2px;">*** REPRINT COPY — DO NOT DUPLICATE PREPARATION ***</div>' : ''}
        Printed: ${printTimestamp} • Direct Kitchen Ticket
      </div>
    </body>
    </html>
  `;
}

/**
 * Triggers thermal KOT print.
 * Uses an invisible iframe to prevent popup blockers, with a window.open fallback.
 */
export function printKitchenOrderTicket(options: KotPrintOptions): void {
  if (typeof window === 'undefined') return;

  const html = generateKotHtml(options);

  try {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();

      iframe.contentWindow?.focus();
      setTimeout(() => {
        try {
          iframe.contentWindow?.print();
        } catch {
          // If iframe printing is blocked, fallback to window.open
          const win = window.open('', '_blank', 'width=400,height=600');
          if (win) {
            win.document.open();
            win.document.write(html);
            win.document.close();
          }
        }

        setTimeout(() => {
          if (iframe.parentNode) {
            document.body.removeChild(iframe);
          }
        }, 3000);
      }, 300);
      return;
    }
  } catch (err) {
    console.error('Iframe print error, falling back to window.open:', err);
  }

  // Fallback to window.open
  const win = window.open('', '_blank', 'width=400,height=600');
  if (win) {
    win.document.open();
    win.document.write(html);
    win.document.close();
  }
}
