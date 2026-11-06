'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import { QrCode, Copy, ExternalLink, Download, Printer, Search, CheckCircle2 } from 'lucide-react';
import { downloadPlacardImage, printPlacard } from '@/utils/qrPlacard';
import { generateUniqueTableCode } from '@/utils/tableCode';

interface TableQrCardProps {
  loc: string;
  restaurantName: string;
  restaurantSlug: string;
  themeColor: string;
  isCurrent: boolean;
  isDisabled: boolean;
  isAdminLocked: boolean;
  onSelect: () => void;
  onToggleStatus: () => void;
}

export function TableQrCard({
  loc,
  restaurantName,
  restaurantSlug,
  themeColor,
  isCurrent,
  isDisabled,
  isAdminLocked,
  onSelect,
  onToggleStatus,
}: TableQrCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const cleanNumber = loc.replace(/^(Table|Room)\s+/i, '').trim();
  const token = generateUniqueTableCode(restaurantSlug, cleanNumber);
  const targetUrl = typeof window !== 'undefined'
    ? (token ? `${window.location.origin}/t/${encodeURIComponent(token)}` : `${window.location.origin}/r/${restaurantSlug}`)
    : '';

  useEffect(() => {
    if (targetUrl) {
      QRCode.toDataURL(targetUrl, {
        width: 320,
        margin: 1,
        color: { dark: '#000000', light: '#FFFFFF' },
      })
        .then(setQrDataUrl)
        .catch(() => {});
    }
  }, [targetUrl]);

  const handleCopy = () => {
    if (targetUrl) {
      navigator.clipboard.writeText(targetUrl);
      toast.success(`Copied link for ${loc}! 📋`);
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    downloadPlacardImage({
      restaurantName,
      tableNumber: cleanNumber,
      qrCodeDataUrl: qrDataUrl,
      themeColor,
      locationType: loc.toLowerCase().includes('room') ? 'ROOM' : 'TABLE',
    });
    toast.success(`Placard for ${loc} downloaded!`);
  };

  const handlePrint = () => {
    if (!qrDataUrl) return;
    printPlacard({
      restaurantName,
      tableNumber: cleanNumber,
      qrCodeDataUrl: qrDataUrl,
      themeColor,
      locationType: loc.toLowerCase().includes('room') ? 'ROOM' : 'TABLE',
    });
  };

  return (
    <div
      className={`rounded-2xl border p-4 transition-all flex flex-col justify-between bg-card relative ${
        isCurrent
          ? 'border-primary ring-2 ring-primary/40 shadow-lg bg-primary/[0.04]'
          : 'border-border hover:border-primary/40 shadow-xs'
      }`}
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-display font-bold text-sm text-foreground truncate">
              {loc}
            </span>
            {isCurrent && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary text-white shrink-0 animate-pulse">
                LATEST
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onToggleStatus}
            disabled={isAdminLocked}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors shrink-0 ${
              isAdminLocked
                ? 'bg-red-500/10 border-red-500/20 text-red-400 opacity-60 cursor-not-allowed'
                : isDisabled
                ? 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20'
            }`}
            title="Click to toggle Active/Disabled status"
          >
            {isAdminLocked ? 'LOCKED' : isDisabled ? 'DISABLED' : 'ACTIVE'}
          </button>
        </div>

        {/* QR Code Preview Thumbnail */}
        <div
          onClick={onSelect}
          className="bg-white rounded-xl p-2.5 flex items-center justify-center border border-border/80 mx-auto w-32 h-32 shadow-inner cursor-pointer hover:scale-105 transition-transform group relative"
          title="Click to load into Placard Mockup above"
        >
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR Code for ${loc}`} className="w-full h-full object-contain" />
          ) : (
            <div className="text-muted-foreground text-xs">Generating...</div>
          )}
        </div>

        {/* Target URL */}
        <div className="mt-3 bg-muted/50 border border-border/60 rounded-xl p-1.5 flex items-center gap-1 text-[11px] font-mono">
          <span className="truncate flex-1 text-muted-foreground select-all px-1.5">
            {targetUrl}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Copy URL"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-4 pt-3 border-t border-border/60 grid grid-cols-3 gap-1.5">
        <Link
          href={targetUrl || '#'}
          target="_blank"
          className="px-2 py-1.5 bg-muted hover:bg-muted/80 rounded-xl text-xs font-semibold text-foreground text-center flex items-center justify-center gap-1 transition-colors"
          title="Preview Menu"
        >
          <ExternalLink className="w-3 h-3" /> Preview
        </Link>
        <button
          type="button"
          onClick={handleDownload}
          className="px-2 py-1.5 bg-primary/10 hover:bg-primary/20 text-primary rounded-xl text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
          title="Download PNG Placard"
        >
          <Download className="w-3 h-3" /> Placard
        </button>
        <button
          type="button"
          onClick={handlePrint}
          className="px-2 py-1.5 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-xs font-medium flex items-center justify-center gap-1 transition-colors"
          title="Print Placard"
        >
          <Printer className="w-3 h-3" /> Print
        </button>
      </div>
    </div>
  );
}

interface TableQrGalleryProps {
  locations: string[];
  restaurantName: string;
  restaurantSlug: string;
  themeColor: string;
  activeLocation: string;
  disabledLocations: string[];
  isTableQrAllowed: boolean;
  isRoomQrAllowed: boolean;
  onSelectLocation: (loc: string) => void;
  onToggleStatus: (loc: string) => void;
}

export function TableQrGallery({
  locations,
  restaurantName,
  restaurantSlug,
  themeColor,
  activeLocation,
  disabledLocations,
  isTableQrAllowed,
  isRoomQrAllowed,
  onSelectLocation,
  onToggleStatus,
}: TableQrGalleryProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredLocations = locations.filter((loc) =>
    loc.toLowerCase().includes(searchTerm.trim().toLowerCase())
  );

  return (
    <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-2 text-lg">
            <QrCode className="w-5 h-5 text-primary" />
            All Generated QR Codes &amp; Placards ({locations.length})
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Every table and room has its own tamper-proof QR code. Preview, download placards, or copy links below.
          </p>
        </div>

        {/* Filter input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search table or room..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-muted/40 border border-border rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {filteredLocations.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No tables or rooms found matching &quot;{searchTerm}&quot;
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredLocations.map((loc) => {
            const isRoomLoc = loc.toLowerCase().includes('room') || loc.toLowerCase().includes('suite');
            const isAdminLocked = isRoomLoc ? !isRoomQrAllowed : !isTableQrAllowed;
            const isDisabled = isAdminLocked || disabledLocations.some(
              (d) => d.trim().toLowerCase() === loc.trim().toLowerCase()
            );

            const cleanActive = activeLocation.replace(/^(Table|Room)\s+/i, '').trim().toLowerCase();
            const cleanThis = loc.replace(/^(Table|Room)\s+/i, '').trim().toLowerCase();
            const isCurrent = cleanActive !== '' && cleanActive === cleanThis;

            return (
              <TableQrCard
                key={loc}
                loc={loc}
                restaurantName={restaurantName}
                restaurantSlug={restaurantSlug}
                themeColor={themeColor}
                isCurrent={isCurrent}
                isDisabled={isDisabled}
                isAdminLocked={isAdminLocked}
                onSelect={() => onSelectLocation(loc)}
                onToggleStatus={() => onToggleStatus(loc)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
