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
export function newestTimestamp(timestamps: Array<string | null | undefined>): string | null {
  let bestMs: number | null = null;
  let bestRaw: string | null = null;
  for (const timestamp of timestamps) {
    const ms = timestampMillis(timestamp);
    if (ms === null || !timestamp) continue;
    if (bestMs === null || ms > bestMs) {
      bestMs = ms;
      bestRaw = timestamp;
    }
  }
  return bestRaw;
}

export function oldestTimestamp(timestamps: Array<string | null | undefined>): string | null {
  let bestMs: number | null = null;
  let bestRaw: string | null = null;
  for (const timestamp of timestamps) {
    const ms = timestampMillis(timestamp);
    if (ms === null || !timestamp) continue;
    if (bestMs === null || ms < bestMs) {
      bestMs = ms;
      bestRaw = timestamp;
    }
  }
  return bestRaw;
}

/**
 * A resumed page restarted at the head when its newest post is strictly newer
 * than the oldest post already processed, or when the anchor id appears again.
 * Equal timestamps are a continuation, not a restart.
 */
export function continuationLooksRestarted(
  posts: ReadonlyArray<{ id: string; timestamp?: string | null }>,
  anchor: { id: string | null; timestamp: string | null }
): boolean {
  if (posts.length === 0) return false;
  if (anchor.id && posts.some((post) => post.id === anchor.id)) return true;
  const newest = newestTimestamp(posts.map((post) => post.timestamp));
  const newestMs = timestampMillis(newest);
  const anchorMs = timestampMillis(anchor.timestamp);
  if (newestMs === null || anchorMs === null) return false;
  return newestMs > anchorMs;
}

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
