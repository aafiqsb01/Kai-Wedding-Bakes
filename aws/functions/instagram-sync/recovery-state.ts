export const DEFAULT_BACKFILL_UNTIL = "2026-09-28T00:00:00.000Z";

export type InstagramRecoveryFailure = {
  mediaId: string;
  instagramTimestamp?: string;
};

export type RecoveryPhase = "backfill" | "live";

/**
 * One watermark row. Cursor, sweep and phase are written together so a live
 * boundary cannot move past a walk that is still in progress.
 */
export type RecoveryPosition = {
  phase: RecoveryPhase;
  backfillUntil: string;
  /** Incremental stop boundary. Set only after the historical walk has finished. */
  liveWatermark: string | null;
  /** Newest head timestamp seen. Not used to skip older posts during backfill. */
  pendingHead: string | null;
  resumeCursor: string | null;
  anchorId: string | null;
  /** Oldest timestamp on the last fully processed page. */
  anchorTimestamp: string | null;
  /** The saved cursor was rejected; keep walking until anchorId is seen again. */
  seekAnchor: boolean;
  /** The historical range has been visited. A head sweep may still be open. */
  historyCovered: boolean;
  /**
   * When set, resumeCursor continues from the head until this timestamp is
   * overlapped. History is already covered.
   */
  headSweepFloor: string | null;
};

export type InstagramRecoveryState = RecoveryPosition & {
  initialised: boolean;
  failures: InstagramRecoveryFailure[];
};

export const RECOVERY_PK = "sync";
export const WATERMARK_SK = "watermark";
export const FAILURE_PREFIX = "failure#";

export function emptyBackfill(backfillUntil: string): RecoveryPosition {
  return {
    phase: "backfill",
    backfillUntil,
    liveWatermark: null,
    pendingHead: null,
    resumeCursor: null,
    anchorId: null,
    anchorTimestamp: null,
    seekAnchor: false,
    historyCovered: false,
    headSweepFloor: null,
  };
}

export function recoveryRecord(position: RecoveryPosition): Record<string, string | boolean> {
  const item: Record<string, string | boolean> = {
    pk: RECOVERY_PK,
    sk: WATERMARK_SK,
    initialised: true,
    phase: position.phase,
    backfillUntil: position.backfillUntil,
    seekAnchor: position.seekAnchor,
    historyCovered: position.historyCovered,
  };
  if (position.liveWatermark) item.liveWatermark = position.liveWatermark;
  if (position.pendingHead) item.pendingHead = position.pendingHead;
  if (position.resumeCursor) item.resumeCursor = position.resumeCursor;
  if (position.anchorId) item.anchorId = position.anchorId;
  if (position.anchorTimestamp) item.anchorTimestamp = position.anchorTimestamp;
  if (position.headSweepFloor) item.headSweepFloor = position.headSweepFloor;
  return item;
}

/** @deprecated shape kept for the parser test name; writes a live position. */
export function watermarkRecord(timestamp: string | null): Record<string, string | boolean> {
  return recoveryRecord({
    ...emptyBackfill(DEFAULT_BACKFILL_UNTIL),
    phase: "live",
    historyCovered: true,
    liveWatermark: timestamp,
    pendingHead: timestamp,
  });
}

export function failureRecord(
  mediaId: string,
  instagramTimestamp: string | undefined,
  recordedAt: string
): Record<string, string> {
  return {
    pk: RECOVERY_PK,
    sk: `${FAILURE_PREFIX}${mediaId}`,
    mediaId,
    recordedAt,
    ...(instagramTimestamp ? { instagramTimestamp } : {}),
  };
}

function validTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function optionalTime(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = validTime(value);
  if (!parsed) throw new Error("Recovery item has an unreadable timestamp");
  return parsed;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value;
}

/**
 * A live boundary with an unfinished walk, or a live boundary with no timestamp,
 * is read back as backfill so history cannot be marked complete by a bad row.
 */
export function normalizePosition(position: RecoveryPosition): RecoveryPosition {
  const next = { ...position };
  if (next.seekAnchor || next.headSweepFloor) next.phase = "backfill";
  if (next.phase === "live" && !next.liveWatermark) next.phase = "backfill";
  if (next.phase === "live") {
    next.seekAnchor = false;
    next.headSweepFloor = null;
  }
  if (!next.historyCovered) next.phase = "backfill";
  return next;
}

/**
 * Reads one Query page. A failure row that cannot be identified throws so the
 * caller fails the invocation instead of dropping that post.
 */
export function parseRecoveryItems(items: ReadonlyArray<Record<string, unknown>>): InstagramRecoveryState {
  const failures: InstagramRecoveryFailure[] = [];
  let position: RecoveryPosition | null = null;

  for (const item of items) {
    const sk = item.sk;
    if (typeof sk !== "string" || !sk) {
      throw new Error("Recovery item is missing a sort key");
    }
    if (sk === WATERMARK_SK) {
      const backfillUntil = validTime(item.backfillUntil);
      if (!backfillUntil) throw new Error("Recovery watermark is missing a backfill floor");
      const phase: RecoveryPhase = item.phase === "live" ? "live" : "backfill";
      position = normalizePosition({
        phase,
        backfillUntil,
        liveWatermark: optionalTime(item.liveWatermark),
        pendingHead: optionalTime(item.pendingHead),
        resumeCursor: optionalText(item.resumeCursor),
        anchorId: optionalText(item.anchorId),
        anchorTimestamp: optionalTime(item.anchorTimestamp),
        seekAnchor: item.seekAnchor === true,
        historyCovered: item.historyCovered === true,
        headSweepFloor: optionalTime(item.headSweepFloor),
      });
      continue;
    }
    if (!sk.startsWith(FAILURE_PREFIX)) continue;

    const fromKey = sk.slice(FAILURE_PREFIX.length);
    const mediaId = typeof item.mediaId === "string" && item.mediaId.trim() ? item.mediaId : fromKey;
    if (!mediaId.trim()) {
      throw new Error("Recovery failure item is missing a media id");
    }
    const timestamp = item.instagramTimestamp;
    failures.push({
      mediaId,
      instagramTimestamp: typeof timestamp === "string" && timestamp.trim() ? timestamp : undefined,
    });
  }

  const base = position ?? emptyBackfill(DEFAULT_BACKFILL_UNTIL);
  return {
    ...base,
    initialised: position !== null,
    failures,
  };
}
