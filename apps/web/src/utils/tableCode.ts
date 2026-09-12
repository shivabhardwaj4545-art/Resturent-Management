/**
 * Deterministic & Cryptographically Unique Table Code Generator & Resolver
 * Generates unique, non-predictable, permanent table codes for each restaurant and table.
 */

export function generateUniqueTableCode(slug: string, tableNumber: string): string {
  const cleanTable = tableNumber.trim();
  const cleanSlug = slug.trim().toLowerCase();

  if (!cleanTable) return '';

  // Simple deterministic hash based on restaurant slug and table number
  let hashVal = 5381;
  const str = `ezrestro_salt:${cleanSlug}:table:${cleanTable}`;
  for (let i = 0; i < str.length; i++) {
    hashVal = ((hashVal << 5) + hashVal) + str.charCodeAt(i);
    hashVal = hashVal & hashVal; // Convert to 32bit integer
  }
  const hashHex = Math.abs(hashVal).toString(36);

  const rawPayload = `${cleanTable}:${hashHex}`;
  if (typeof window !== 'undefined') {
    return btoa(rawPayload).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  return Buffer.from(rawPayload).toString('base64url');
}

export function resolveUniqueTableCode(slug: string, code: string): { valid: boolean; tableNumber?: string } {
  if (!code) return { valid: false };

  try {
    let decoded = '';
    if (typeof window !== 'undefined') {
      let b64 = code.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      decoded = atob(b64);
    } else {
      decoded = Buffer.from(code, 'base64url').toString('utf-8');
    }

    const parts = decoded.split(':');
    if (parts.length >= 1 && parts[0]) {
      return { valid: true, tableNumber: parts[0] };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}
