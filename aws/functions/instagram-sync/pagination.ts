export const DEFAULT_MAX_PAGES = 10;

export function timestampMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Inclusive boundary: a post at the exact stored timestamp is still imported
 * so ties are not skipped. Missing timestamps are imported rather than dropped.
 */
export function shouldImportPost(
  timestamp: string | null | undefined,
  boundaryMs: number | null
): boolean {
  if (boundaryMs === null) return true;
  const ms = timestampMillis(timestamp);
  if (ms === null) return true;
  return ms >= boundaryMs;
}

/**
 * The page is past the gallery history only when every item is strictly older
 * than the boundary. An empty page does not count.
 */
export function pageIsStrictlyOlderThanBoundary(
  timestamps: Array<string | null | undefined>,
  boundaryMs: number | null
): boolean {
  if (boundaryMs === null || timestamps.length === 0) return false;
  return timestamps.every((timestamp) => {
    const ms = timestampMillis(timestamp);
    return ms !== null && ms < boundaryMs;
  });
}
