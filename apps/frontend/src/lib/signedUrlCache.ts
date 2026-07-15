const TTL_MS = 2 * 60 * 1000; // 2 minutes

interface CacheEntry {
  url: string;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export function getCachedSignedUrl(documentId: string): string | null {
  const entry = cache.get(documentId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(documentId);
    return null;
  }
  return entry.url;
}

export function setCachedSignedUrl(documentId: string, url: string): void {
  cache.set(documentId, { url, expiresAt: Date.now() + TTL_MS });
}

export function clearCachedSignedUrl(documentId: string): void {
  cache.delete(documentId);
}
