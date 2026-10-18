import type { DynamoGalleryItem, DynamoGalleryMedia, ProductType } from "../../config/database";
import {
  isInvalidCursorError,
  logGraphError,
  parseGraphError,
  publicErrorMessage,
} from "./graph-error";
import {
  DEFAULT_MAX_PAGES,
  continuationLooksRestarted,
  newestTimestamp,
  oldestTimestamp,
  pageIsStrictlyOlderThanBoundary,
  shouldImportPost,
  timestampMillis,
} from "./pagination";
import {
  emptyBackfill,
  type InstagramRecoveryState,
  type RecoveryPosition,
} from "./recovery-state";
import {
  isRefreshEligible,
  parseRefreshResponse,
  parseStoredToken,
  serialiseRefreshedToken,
  type StoredInstagramToken,
} from "./token-lifecycle";

export const SYNC_METRIC_NAMESPACE = "OpulenceWeddingBakes/InstagramSync";
export const SYNC_METRIC_NAME = "SyncSuccess";
export const SYNC_FUNCTION_NAME = "opulence-instagram-sync";
export { DEFAULT_MAX_PAGES };

const GRAPH_VERSION = "v18.0";
const MEDIA_FIELDS = "id,media_type,media_url,caption,like_count,comments_count,timestamp,permalink";

export interface InstagramMedia {
  id: string;
  media_type: string;
  media_url?: string;
  caption?: string;
  like_count?: number;
  timestamp?: string;
  permalink: string;
}

interface InstagramChildMedia {
  id: string;
  media_type: string;
  media_url?: string;
}

interface InstagramPage {
  data?: InstagramMedia[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
  };
}

export type GraphResponse = {
  status: number;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type SyncDependencies = {
  fetch: (url: string) => Promise<GraphResponse>;
  loadSecret: () => Promise<string>;
  saveSecret: (value: string) => Promise<void>;
  getAccountId: () => string;
  /** Posts strictly older than this are outside the one-time historical backfill. */
  backfillUntil: string;
  loadRecoveryState: () => Promise<InstagramRecoveryState>;
  initialiseRecovery: (position: RecoveryPosition) => Promise<void>;
  saveRecovery: (position: RecoveryPosition) => Promise<void>;
  recordFailure: (mediaId: string, instagramTimestamp: string | undefined) => Promise<void>;
  clearFailure: (mediaId: string) => Promise<void>;
  saveGalleryItem: (item: DynamoGalleryItem) => Promise<void>;
  loadGalleryItem: (photoId: string) => Promise<DynamoGalleryItem | undefined>;
  uploadPhoto: (
    photoId: string,
    body: Buffer,
    contentType: string
  ) => Promise<{ key: string; url: string }>;
  putSuccessMetric: () => Promise<void>;
  now: () => Date;
  maxPages: number;
};

export type SyncSummary = {
  saved: number;
  skipped: number;
};

/** Recognised Instagram hashtags (lowercase, without #) → canonical productType. */
const HASHTAG_TO_PRODUCT_TYPE: Record<string, ProductType> = {
  weddingcake: "wedding-cake",
  "wedding-cake": "wedding-cake",
  nikahcake: "nikah-cake",
  nikkahcake: "nikah-cake",
  "nikkah-cake": "nikah-cake",
  "nikah-cake": "nikah-cake",
  cupcakes: "cupcakes",
  engagement: "engagement-cake",
  engagementcake: "engagement-cake",
  birthdaycake: "birthday-cake",
  "birthday-cake": "birthday-cake",
  anniversarycake: "anniversary-cake",
  "anniversary-cake": "anniversary-cake",
};

export function mapToProductType(caption?: string): ProductType {
  if (!caption) return "wedding-cake";

  const matches = caption.match(/#[\w-]+/g);
  if (!matches) return "wedding-cake";

  for (const tag of matches) {
    const productType = HASHTAG_TO_PRODUCT_TYPE[tag.slice(1).toLowerCase()];
    if (productType) return productType;
  }

  return "wedding-cake";
}

export async function runInstagramSync(deps: SyncDependencies): Promise<SyncSummary> {
  const accountId = configuredAccountId(deps);
  const stored = parseStoredToken(await deps.loadSecret());
  const token = isRefreshEligible(stored, deps.now())
    ? await refreshToken(stored, accountId, deps)
    : stored;
  await assertTokenMatchesAccount(token.accessToken, accountId, deps);

  const loaded = await deps.loadRecoveryState();
  const position: RecoveryPosition = loaded.initialised
    ? copyPosition(loaded)
    : emptyBackfill(deps.backfillUntil);
  if (!loaded.initialised) {
    await deps.initialiseRecovery(position);
  }

  const outstanding = new Set(loaded.failures.map((failure) => failure.mediaId));
  const attempted = new Set<string>();
  const summary: SyncSummary = { saved: 0, skipped: 0 };
  const accessToken = token.accessToken;

  for (const mediaId of loaded.failures.map((failure) => failure.mediaId)) {
    if (attempted.has(mediaId)) continue;
    attempted.add(mediaId);
    try {
      const media = await fetchMediaById(deps, mediaId, accessToken);
      const outcome = await processInstagramMedia(media, accessToken, deps);
      if (outcome === "skipped") summary.skipped += 1;
      else summary.saved += 1;
    } catch (error) {
      console.error(`Failed to retry media ${mediaId}: ${publicErrorMessage(error)}`);
      continue;
    }
    await deps.clearFailure(mediaId);
    outstanding.delete(mediaId);
  }

  const maxPages = deps.maxPages > 0 ? deps.maxPages : DEFAULT_MAX_PAGES;
  let result = await walkFeed({
    deps,
    accessToken,
    accountId,
    maxPages,
    position,
    outstanding,
    attempted,
    summary,
  });

  if (
    result.stop === "complete" &&
    !result.sawHead &&
    !position.headSweepFloor &&
    result.position.historyCovered
  ) {
    const sweepFloor = result.position.pendingHead ?? result.position.backfillUntil;
    const sweepPosition: RecoveryPosition = {
      ...result.position,
      phase: "backfill",
      historyCovered: true,
      headSweepFloor: sweepFloor,
      resumeCursor: null,
      seekAnchor: false,
      anchorId: null,
      anchorTimestamp: null,
    };
    await deps.saveRecovery(sweepPosition);
    result = await walkFeed({
      deps,
      accessToken,
      accountId,
      maxPages,
      position: sweepPosition,
      outstanding,
      attempted,
      summary,
    });
  }

  if (result.stop !== "complete") {
    throw incompleteError(result.stop, outstanding, maxPages, result.position);
  }

  const live = toLivePosition(result.position);
  await deps.saveRecovery(live);
  if (outstanding.size > 0) {
    throw incompleteError("failures", outstanding, maxPages, live);
  }

  await deps.putSuccessMetric();
  return summary;
}

type WalkStop = "complete" | "page-cap" | "missing-cursor" | "repeated-cursor" | "failures";

function incompleteError(
  stop: WalkStop,
  outstanding: Set<string>,
  maxPages: number,
  position: RecoveryPosition
): Error {
  if (outstanding.size > 0) {
    const failedIds = [...outstanding].sort();
    return new Error(
      `Instagram sync incomplete. ${failedIds.length} post(s) failed (${failedIds.join(", ")}). Posts already written were kept.`
    );
  }
  if (stop === "missing-cursor") {
    return new Error(
      "Instagram returned another page without a cursor. Sync stopped before completion. Posts already written were kept."
    );
  }
  if (stop === "repeated-cursor") {
    return new Error(
      "Instagram repeated a paging cursor. Sync stopped before completion. Posts already written were kept."
    );
  }
  const boundary = position.phase === "live" ? position.liveWatermark : position.backfillUntil;
  const reason = timestampMillis(boundary) === null
    ? `Instagram sync stopped after the page limit of ${maxPages} and more posts remain.`
    : `Instagram sync stopped after the page limit of ${maxPages} before reaching posts older than the gallery boundary.`;
  return new Error(
    `${reason} Raise INSTAGRAM_SYNC_MAX_PAGES and retry. Posts already written were kept.`
  );
}

function copyPosition(state: InstagramRecoveryState): RecoveryPosition {
  return {
    phase: state.phase,
    backfillUntil: state.backfillUntil,
    liveWatermark: state.liveWatermark,
    pendingHead: state.pendingHead,
    resumeCursor: state.resumeCursor,
    anchorId: state.anchorId,
    anchorTimestamp: state.anchorTimestamp,
    seekAnchor: state.seekAnchor,
    historyCovered: state.historyCovered,
    headSweepFloor: state.headSweepFloor,
  };
}

function toLivePosition(position: RecoveryPosition): RecoveryPosition {
  const head = position.pendingHead ?? position.liveWatermark ?? position.backfillUntil;
  return {
    ...position,
    phase: "live",
    historyCovered: true,
    liveWatermark: head,
    pendingHead: head,
    resumeCursor: null,
    anchorId: null,
    anchorTimestamp: null,
    seekAnchor: false,
    headSweepFloor: null,
  };
}

function importFloor(position: RecoveryPosition): string | null {
  if (position.headSweepFloor) return position.headSweepFloor;
  if (position.phase === "live" && position.liveWatermark) return position.liveWatermark;
  return position.backfillUntil;
}

function feedWalkFinished(posts: InstagramMedia[], hasNext: boolean, position: RecoveryPosition): boolean {
  if (!hasNext) return true;
  if (position.headSweepFloor) {
    const oldest = oldestTimestamp(posts.map((post) => post.timestamp));
    const oldestMs = timestampMillis(oldest);
    const floorMs = timestampMillis(position.headSweepFloor);
    return oldestMs !== null && floorMs !== null && oldestMs <= floorMs;
  }
  const boundary = position.phase === "live" ? position.liveWatermark : position.backfillUntil;
  return pageIsStrictlyOlderThanBoundary(
    posts.map((post) => post.timestamp),
    timestampMillis(boundary)
  );
}

async function walkFeed(input: {
  deps: SyncDependencies;
  accessToken: string;
  accountId: string;
  maxPages: number;
  position: RecoveryPosition;
  outstanding: Set<string>;
  attempted: Set<string>;
  summary: SyncSummary;
}): Promise<{ stop: WalkStop; sawHead: boolean; position: RecoveryPosition }> {
  const { deps, accessToken, accountId, maxPages, outstanding, attempted, summary } = input;
  const position: RecoveryPosition = { ...input.position };
  let after = position.resumeCursor ?? undefined;
  let seekAnchor = position.seekAnchor;
  let sawAnchor = !seekAnchor;
  const savedAnchor = { id: position.anchorId, timestamp: position.anchorTimestamp };
  let sawHead = !after;
  let rewalked = false;
  let pages = 0;

  const restartFromHead = (reason: string) => {
    console.error(reason);
    rewalked = true;
    after = undefined;
    seekAnchor = true;
    sawAnchor = false;
    sawHead = true;
    position.resumeCursor = null;
    position.seekAnchor = true;
  };

  while (pages < maxPages) {
    let mediaPage: InstagramPage;
    const requestedAfter = after;
    try {
      mediaPage = await fetchMediaPage(deps, accountId, accessToken, requestedAfter);
    } catch (error) {
      if (requestedAfter && isInvalidCursorError(error) && !rewalked) {
        restartFromHead(
          "Instagram continuation cursor was rejected. Restarting this walk from the newest page without marking history complete."
        );
        continue;
      }
      throw error;
    }

    const posts = mediaPage.data ?? [];
    if (requestedAfter && posts.length === 0 && !rewalked) {
      restartFromHead(
        "Instagram continuation cursor returned no posts. Restarting from the newest page without marking history complete."
      );
      continue;
    }
    if (
      requestedAfter &&
      !rewalked &&
      continuationLooksRestarted(posts, savedAnchor)
    ) {
      // Discard this body. A missing next link here is not the end of the feed.
      // The following request has no cursor, so only that fresh head can finish the walk.
      restartFromHead(
        "Instagram continuation cursor did not resume older history. Restarting from the newest page without marking history complete."
      );
      continue;
    }

    pages += 1;
    const fromHead = !requestedAfter || (rewalked && pages === 1);
    if (fromHead) sawHead = true;

    const floor = importFloor(position);
    const floorMs = timestampMillis(floor);
    for (const media of posts) {
      if (seekAnchor && media.id === savedAnchor.id) sawAnchor = true;
      if (!shouldImportPost(media.timestamp, floorMs)) continue;
      if (attempted.has(media.id)) continue;
      attempted.add(media.id);
      try {
        const outcome = await processInstagramMedia(media, accessToken, deps);
        if (outcome === "skipped") summary.skipped += 1;
        else summary.saved += 1;
      } catch (error) {
        console.error(`Failed to process media ${media.id}: ${publicErrorMessage(error)}`);
        await deps.recordFailure(media.id, media.timestamp);
        outstanding.add(media.id);
      }
    }

    if (fromHead) {
      const newest = newestTimestamp(posts.map((post) => post.timestamp));
      const newestMs = timestampMillis(newest);
      const pendingMs = timestampMillis(position.pendingHead);
      if (newest && newestMs !== null && (pendingMs === null || newestMs > pendingMs)) {
        position.pendingHead = newest;
      }
    }

    const hasNext = Boolean(mediaPage.paging?.next);
    if (feedWalkFinished(posts, hasNext, position)) {
      if (!position.headSweepFloor && position.phase !== "live") position.historyCovered = true;
      position.resumeCursor = null;
      position.anchorId = null;
      position.anchorTimestamp = null;
      position.seekAnchor = false;
      if (position.headSweepFloor) position.headSweepFloor = null;
      return { stop: "complete", sawHead, position };
    }

    const cursor = mediaPage.paging?.cursors?.after;
    if (!cursor) return { stop: "missing-cursor", sawHead, position };
    if (requestedAfter && cursor === requestedAfter) {
      if (!rewalked) {
        restartFromHead(
          "Instagram returned the same continuation cursor. Restarting from the newest page without marking history complete."
        );
        continue;
      }
      position.resumeCursor = null;
      position.anchorId = null;
      position.anchorTimestamp = null;
      position.seekAnchor = false;
      await deps.saveRecovery(position);
      return { stop: "repeated-cursor", sawHead, position };
    }

    const last = posts[posts.length - 1];
    position.resumeCursor = cursor;
    position.anchorId = last?.id ?? null;
    position.anchorTimestamp = oldestTimestamp(posts.map((post) => post.timestamp));
    position.seekAnchor = seekAnchor && !sawAnchor;
    await deps.saveRecovery(position);

    if (pages >= maxPages) return { stop: "page-cap", sawHead, position };
    after = cursor;
  }

  return { stop: "page-cap", sawHead, position };
}

function configuredAccountId(deps: SyncDependencies): string {
  const accountId = deps.getAccountId().trim();
  if (!accountId) {
    throw new Error("Instagram Business Account ID not configured");
  }
  return accountId;
}

async function refreshToken(
  current: StoredInstagramToken,
  accountId: string,
  deps: SyncDependencies
): Promise<StoredInstagramToken> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", current.accessToken);

  const parsed = await readGraphJson<unknown>(
    deps,
    url,
    "Instagram token refresh returned a non-JSON response"
  );
  const refreshed = parseRefreshResponse(JSON.stringify(parsed));
  await assertTokenMatchesAccount(refreshed.accessToken, accountId, deps);

  const serialised = serialiseRefreshedToken(refreshed.accessToken, refreshed.expiresIn, deps.now());
  try {
    await deps.saveSecret(serialised);
  } catch (error) {
    console.error(
      `Failed to store refreshed Instagram token: ${publicErrorMessage(error)}. The previous secret was left unchanged.`
    );
    throw new Error(
      "Could not store the refreshed Instagram token. The previous secret was left unchanged."
    );
  }

  return parseStoredToken(serialised);
}

async function assertTokenMatchesAccount(
  accessToken: string,
  accountId: string,
  deps: SyncDependencies
): Promise<void> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/me`);
  url.searchParams.set("fields", "id");
  url.searchParams.set("access_token", accessToken);

  const parsed = await readGraphJson<unknown>(
    deps,
    url,
    "Instagram token could not be validated"
  );
  const id = parsed && typeof parsed === "object" ? (parsed as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Instagram token could not be validated");
  }
  const returned = id.trim();
  if (returned !== accountId) {
    throw new Error(
      `Instagram token account ${returned} does not match configured account ${accountId}`
    );
  }
}

async function fetchMediaById(
  deps: SyncDependencies,
  mediaId: string,
  accessToken: string
): Promise<InstagramMedia> {
  const url = new URL(
    `https://graph.instagram.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`
  );
  url.searchParams.set("fields", MEDIA_FIELDS);
  url.searchParams.set("access_token", accessToken);

  const media = await readGraphJson<InstagramMedia>(
    deps,
    url,
    `Instagram media ${mediaId} response was not valid JSON`
  );
  if (!media || typeof media.id !== "string" || !media.id.trim()) {
    throw new Error(`Instagram media ${mediaId} could not be read`);
  }
  return media;
}

async function fetchMediaPage(
  deps: SyncDependencies,
  accountId: string,
  accessToken: string,
  after?: string
): Promise<InstagramPage> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${accountId}/media`);
  url.searchParams.set("fields", MEDIA_FIELDS);
  url.searchParams.set("limit", "25");
  url.searchParams.set("access_token", accessToken);
  if (after) url.searchParams.set("after", after);

  return readGraphJson<InstagramPage>(deps, url, "Instagram media response was not valid JSON");
}

async function readGraph(deps: SyncDependencies, url: URL): Promise<{ status: number; body: string }> {
  let response: GraphResponse;
  try {
    response = await deps.fetch(url.toString());
  } catch {
    throw new Error("Instagram Graph API request failed before a response was received");
  }

  let body = "";
  try {
    body = await response.text();
  } catch {
    throw new Error("Instagram Graph API response could not be read");
  }

  return { status: response.status, body };
}

async function readGraphJson<T>(
  deps: SyncDependencies,
  url: URL,
  invalidJsonMessage: string
): Promise<T> {
  const { status, body } = await readGraph(deps, url);
  if (status < 200 || status >= 300) {
    const error = parseGraphError(status, body);
    logGraphError(error);
    throw error;
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(invalidJsonMessage);
  }
}

async function fetchCarouselChildren(
  mediaId: string,
  accessToken: string,
  deps: SyncDependencies
): Promise<InstagramChildMedia[]> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${mediaId}/children`);
  url.searchParams.set("fields", "id,media_type,media_url");
  url.searchParams.set("access_token", accessToken);

  const data = await readGraphJson<{ data?: InstagramChildMedia[] }>(
    deps,
    url,
    `Instagram media ${mediaId} response was not valid JSON`
  );
  return data.data ?? [];
}

async function downloadMediaFromUrl(url: string, deps: SyncDependencies): Promise<Buffer> {
  let response: GraphResponse;
  try {
    response = await deps.fetch(url);
  } catch {
    throw new Error("Failed to download media before a response was received");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to download media: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function objectKeyFromUrl(url: string): string | null {
  try {
    const key = new URL(url).pathname.replace(/^\/+/, "").trim();
    return key || null;
  } catch {
    return null;
  }
}

async function downloadAndUploadImage(
  mediaId: string,
  mediaUrl: string,
  deps: SyncDependencies
): Promise<DynamoGalleryMedia> {
  const imageBuffer = await downloadMediaFromUrl(mediaUrl, deps);
  const uploaded = await deps.uploadPhoto(mediaId, imageBuffer, "image/jpeg");
  return { mediaId, s3Key: uploaded.key, url: uploaded.url };
}

function storedImageUrl(item: DynamoGalleryItem | undefined): string | null {
  if (!item || item.mediaType === "CAROUSEL_ALBUM") return null;
  const url = item.backupUrl.trim();
  return url ? url : null;
}

function storedChild(item: DynamoGalleryItem | undefined, childId: string): DynamoGalleryMedia | null {
  const match = item?.media?.find((asset) => asset.mediaId === childId && asset.url.trim());
  if (!match) return null;
  const s3Key = match.s3Key.trim() || objectKeyFromUrl(match.url);
  if (!s3Key) return null;
  return {
    mediaId: match.mediaId,
    s3Key,
    url: match.url,
  };
}

async function processCarouselAlbum(
  media: InstagramMedia,
  accessToken: string,
  deps: SyncDependencies
): Promise<void> {
  const children = await fetchCarouselChildren(media.id, accessToken, deps);
  if (children.length === 0) {
    throw new Error(`Carousel ${media.id} has no child media`);
  }

  const existing = await deps.loadGalleryItem(media.id);
  const mediaAssets: DynamoGalleryMedia[] = [];
  for (const child of children) {
    if (child.media_type !== "IMAGE") {
      console.log(`Skipping ${child.media_type} carousel child: ${child.id} (parent ${media.id})`);
      continue;
    }
    const stored = storedChild(existing, child.id);
    if (stored) {
      mediaAssets.push(stored);
      continue;
    }
    if (!child.media_url) {
      throw new Error(`Carousel child ${child.id} (parent ${media.id}) has no media_url`);
    }
    try {
      mediaAssets.push(await downloadAndUploadImage(child.id, child.media_url, deps));
    } catch (error) {
      throw new Error(
        `Carousel ${media.id} incomplete: child ${child.id} failed — ${publicErrorMessage(error)}`
      );
    }
  }

  if (mediaAssets.length === 0) {
    throw new Error(`Carousel ${media.id} has no IMAGE children to sync`);
  }

  const productType = mapToProductType(media.caption);
  const cover = mediaAssets[0];
  await deps.saveGalleryItem({
    photoId: media.id,
    backupUrl: cover.url,
    instagramUrl: media.permalink,
    caption: media.caption || "",
    productType,
    likes: media.like_count || 0,
    syncedAt: deps.now().toISOString(),
    instagramTimestamp: media.timestamp,
    mediaType: "CAROUSEL_ALBUM",
    media: mediaAssets,
  });
}

async function processInstagramMedia(
  media: InstagramMedia,
  accessToken: string,
  deps: SyncDependencies
): Promise<"saved" | "skipped"> {
  if (media.media_type === "VIDEO") {
    console.log(`Skipping VIDEO media: ${media.id}`);
    return "skipped";
  }

  if (media.media_type === "CAROUSEL_ALBUM") {
    await processCarouselAlbum(media, accessToken, deps);
    return "saved";
  }

  if (media.media_type !== "IMAGE") {
    console.log(`Skipping ${media.media_type} media: ${media.id}`);
    return "skipped";
  }

  const existingUrl = storedImageUrl(await deps.loadGalleryItem(media.id));
  if (!existingUrl && !media.media_url) {
    throw new Error(`No media_url found for ${media.id}`);
  }

  const uploaded = existingUrl
    ? { mediaId: media.id, s3Key: objectKeyFromUrl(existingUrl) ?? "", url: existingUrl }
    : await downloadAndUploadImage(media.id, media.media_url as string, deps);
  const productType = mapToProductType(media.caption);
  await deps.saveGalleryItem({
    photoId: media.id,
    backupUrl: uploaded.url,
    instagramUrl: media.permalink,
    caption: media.caption || "",
    productType,
    likes: media.like_count || 0,
    syncedAt: deps.now().toISOString(),
    instagramTimestamp: media.timestamp,
    mediaType: "IMAGE",
  });
  return "saved";
}
