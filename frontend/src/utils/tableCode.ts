import {
  generateTableToken,
  resolveTableToken,
  verifyTableToken,
} from '@qr-restaurant/shared';

export { generateTableToken, resolveTableToken, verifyTableToken };

export function formatTableLabel(raw?: string | number | null): string {
  if (raw === undefined || raw === null || raw === '') return 'Table';
  const trimmed = String(raw).trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('room') || lower.startsWith('suite')) {
    const stripped = trimmed.replace(/^(room|suite)\s*(room|suite)?\s*/i, '').trim();
    return stripped ? `Room ${stripped}` : trimmed;
  }
  if (lower.startsWith('table')) {
    const strippedTable = trimmed.replace(/^(table\s*)+/i, '').trim();
    return strippedTable ? `Table ${strippedTable}` : 'Table';
  }
  if (/^\d+$/.test(trimmed)) {
    return `Table ${trimmed}`;
  }
  return trimmed;
}

export function generateUniqueTableCode(slug: string, tableNumber: string): string {
  return generateTableToken(slug, tableNumber);
}

export function resolveUniqueTableCode(
  slug: string,
  code: string
): { valid: boolean; tableNumber?: string } {
  const result = resolveTableToken(code, slug);
  return {
    valid: result.valid,
    tableNumber: result.tableNumber,
  };
}
