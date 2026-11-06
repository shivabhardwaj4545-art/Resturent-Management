'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { toast } from 'sonner';
import {
  QrCode,
  Copy,
  ExternalLink,
  Download,
  Printer,
  Search,
  Trash2,
  Sparkles,
} from 'lucide-react';
import { downloadPlacardImage, printPlacard } from '@/utils/qrPlacard';
import { generateUniqueTableCode } from '@/utils/tableCode';

interface TableQrCardProps {
  loc: string;
  isGeneralMenu?: boolean;
  restaurantName: string;
  restaurantSlug: string;
  themeColor: string;
  isCurrent: boolean;
  isDisabled: boolean;
  isAdminLocked: boolean;
  isCustom?: boolean;
  onSelect: () => void;
  onToggleStatus: () => void;
  onRemove?: () => void;
}

export function TableQrCard({
  loc,
  isGeneralMenu = false,
  restaurantName,
  restaurantSlug,
  themeColor,
  isCurrent,
  isDisabled,
  isAdminLocked,
  isCustom = false,
  onSelect,
  onToggleStatus,
  onRemove,
}: TableQrCardProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const cleanNumber = isGeneralMenu ? '' : loc.replace(/^(Table|Room)\s+/i, '').trim();
  const token = isGeneralMenu ? '' : generateUniqueTableCode(restaurantSlug, cleanNumber);
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
      toast.success(`Copied menu link for ${loc}! 📋`);
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) return;
    downloadPlacardImage({
      restaurantName,
      tableNumber: cleanNumber,
      qrCodeDataUrl: qrDataUrl,
      themeColor,
      locationType: isGeneralMenu ? undefined : (loc.toLowerCase().includes('room') ? 'ROOM' : 'TABLE'),
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
      locationType: isGeneralMenu ? undefined : (loc.toLowerCase().includes('room') ? 'ROOM' : 'TABLE'),
    });
  };

  return (
    <div
      className={`rounded-2xl border p-4 sm:p-5 transition-all flex flex-col justify-between bg-card relative ${
        isCurrent
          ? 'border-primary ring-2 ring-primary/40 shadow-lg bg-primary/[0.04]'
          : 'border-border hover:border-primary/40 shadow-xs'
      }`}
    >
      <div>
        {/* Card Header */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="font-display font-bold text-sm sm:text-base text-foreground truncate">
              {loc}
            </span>
            {isCurrent && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-primary text-white shrink-0 flex items-center gap-1 shadow-xs">
                <Sparkles className="w-2.5 h-2.5" /> LATEST
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isGeneralMenu && (
              <button
                type="button"
                onClick={onToggleStatus}
                disabled={isAdminLocked}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold border transition-colors ${
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
            )}

            {isCustom && onRemove && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove();
                }}
                className="p-1 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors"
                title={`Delete ${loc}`}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* QR Code Preview Thumbnail */}
        <div
          onClick={onSelect}
          className="bg-white rounded-xl p-3 flex items-center justify-center border border-border/80 mx-auto w-36 h-36 shadow-sm cursor-pointer hover:scale-105 transition-transform group relative"
          title="Click to load into Placard Mockup above"
        >
          {qrDataUrl ? (
            <img src={qrDataUrl} alt={`QR Code for ${loc}`} className="w-full h-full object-contain" />
          ) : (
            <div className="text-muted-foreground text-xs">Generating...</div>
          )}
        </div>

        {/* Target URL with Copy Button */}
        <div className="mt-3.5 bg-muted/40 border border-border/60 rounded-xl p-1.5 flex items-center gap-1 text-[11px] font-mono">
          <span className="truncate flex-1 text-muted-foreground select-all px-1.5">
            {targetUrl}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Copy URL"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Action Buttons - Clean 2-tier layout */}
      <div className="mt-4 pt-3 border-t border-border/60 space-y-2">
        <button
          type="button"
          onClick={handleDownload}
          className="w-full py-2 px-3 bg-primary text-white hover:bg-primary/90 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-xs"
          title="Download printable PNG Placard"
        >
          <Download className="w-3.5 h-3.5" /> Download Placard (PNG)
        </button>

        <div className="grid grid-cols-2 gap-2">
          <Link
            href={targetUrl || '#'}
            target="_blank"
            className="py-1.5 px-3 bg-muted hover:bg-muted/80 rounded-xl text-xs font-semibold text-foreground text-center flex items-center justify-center gap-1.5 transition-colors"
            title="Preview Menu"
          >
            <ExternalLink className="w-3 h-3 text-muted-foreground" /> Preview
          </Link>
          <button
            type="button"
            onClick={handlePrint}
            className="py-1.5 px-3 bg-muted hover:bg-muted/80 text-foreground rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
            title="Print Placard"
          >
            <Printer className="w-3 h-3 text-muted-foreground" /> Print
          </button>
        </div>
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
  customLocations?: string[];
  isTableQrAllowed: boolean;
  isRoomQrAllowed: boolean;
  onSelectLocation: (loc: string) => void;
  onToggleStatus: (loc: string) => void;
  onRemoveLocation?: (loc: string) => void;
}

export function TableQrGallery({
  locations,
  restaurantName,
  restaurantSlug,
  themeColor,
  activeLocation,
  disabledLocations,
  customLocations = [],
  isTableQrAllowed,
  isRoomQrAllowed,
  onSelectLocation,
  onToggleStatus,
  onRemoveLocation,
}: TableQrGalleryProps) {
  const [searchTerm, setSearchTerm] = useState('');

  // Include General Menu as the first item
  const allCards = [
    { name: 'General Menu', isGeneralMenu: true },
    ...locations.map((loc) => ({ name: loc, isGeneralMenu: false })),
  ];

  const filteredCards = allCards.filter((card) =>
    card.name.toLowerCase().includes(searchTerm.trim().toLowerCase())
  );

  return (
    <div className="bg-card border border-border rounded-2xl p-5 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div>
          <h2 className="font-display font-semibold flex items-center gap-2 text-lg">
            <QrCode className="w-5 h-5 text-primary" />
            All Generated QR Codes &amp; Placards ({allCards.length})
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

      {filteredCards.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No tables or rooms found matching &quot;{searchTerm}&quot;
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-5">
          {filteredCards.map((card) => {
            const isGeneralMenu = card.isGeneralMenu;
            const loc = card.name;

            const isRoomLoc = loc.toLowerCase().includes('room') || loc.toLowerCase().includes('suite');
            const isAdminLocked = isGeneralMenu ? false : isRoomLoc ? !isRoomQrAllowed : !isTableQrAllowed;
            const isDisabled = !isGeneralMenu && (isAdminLocked || disabledLocations.some(
              (d) => d.trim().toLowerCase() === loc.trim().toLowerCase()
            ));

            const isCustom = !isGeneralMenu && customLocations.some(
              (c) => c.trim().toLowerCase() === loc.trim().toLowerCase()
            );

            const cleanActive = activeLocation.replace(/^(Table|Room)\s+/i, '').trim().toLowerCase();
            const cleanThis = loc.replace(/^(Table|Room)\s+/i, '').trim().toLowerCase();
            const isCurrent = isGeneralMenu
              ? cleanActive === ''
              : (cleanActive !== '' && cleanActive === cleanThis);

            return (
              <TableQrCard
                key={loc}
                loc={loc}
                isGeneralMenu={isGeneralMenu}
                restaurantName={restaurantName}
                restaurantSlug={restaurantSlug}
                themeColor={themeColor}
                isCurrent={isCurrent}
                isDisabled={isDisabled}
                isAdminLocked={isAdminLocked}
                isCustom={isCustom}
                onSelect={() => onSelectLocation(loc)}
                onToggleStatus={() => onToggleStatus(loc)}
                onRemove={onRemoveLocation ? () => onRemoveLocation(loc) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
