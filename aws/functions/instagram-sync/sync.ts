import type { DynamoGalleryItem, DynamoGalleryMedia, ProductType } from "../../config/database";
import {
  InstagramGraphError,
  logGraphError,
  parseGraphError,
  publicErrorMessage,
} from "./graph-error";
import {
  DEFAULT_MAX_PAGES,
  pageIsStrictlyOlderThanBoundary,
  shouldImportPost,
  timestampMillis,
} from "./pagination";
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
  getBoundary: () => Promise<string | null>;
  saveGalleryItem: (item: DynamoGalleryItem) => Promise<void>;
  uploadPhoto: (photoId: string, body: Buffer, contentType: string) => Promise<string>;
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
  const stored = parseStoredToken(await deps.loadSecret());
  const token = isRefreshEligible(stored, deps.now())
    ? await refreshToken(stored, deps)
    : stored;

  const boundaryRaw = await deps.getBoundary();
  const boundaryMs = timestampMillis(boundaryRaw);
  const accountId = deps.getAccountId();
  const maxPages = deps.maxPages > 0 ? deps.maxPages : DEFAULT_MAX_PAGES;

  const failures: string[] = [];
  let saved = 0;
  let skipped = 0;
  let after: string | undefined;

  for (let page = 1; page <= maxPages; page += 1) {
    const mediaPage = await fetchMediaPage(deps, accountId, token.accessToken, after);
    const posts = mediaPage.data ?? [];

    for (const media of posts) {
      if (!shouldImportPost(media.timestamp, boundaryMs)) continue;
      try {
        const outcome = await processInstagramMedia(media, token.accessToken, deps);
        if (outcome === "skipped") skipped += 1;
        else saved += 1;
      } catch (error) {
        failures.push(media.id);
        console.error(
          `Failed to process media ${media.id}: ${publicErrorMessage(error)}`
        );
      }
    }

    const reachedOlderHistory =
      boundaryMs !== null &&
      pageIsStrictlyOlderThanBoundary(
        posts.map((post) => post.timestamp),
        boundaryMs
      );
    const hasNext = Boolean(mediaPage.paging?.next);
    if (reachedOlderHistory || !hasNext) {
      after = undefined;
      break;
    }

    const cursor = mediaPage.paging?.cursors?.after;
    if (!cursor) {
      throw new Error(
        "Instagram returned another page without a cursor. Sync stopped before completion. Posts already written were kept."
      );
    }
    if (page === maxPages) {
      const reason = boundaryMs === null
        ? `Instagram sync stopped after the page limit of ${maxPages} and more posts remain.`
        : `Instagram sync stopped after the page limit of ${maxPages} before reaching posts older than the gallery boundary.`;
      throw new Error(
        `${reason} Raise INSTAGRAM_SYNC_MAX_PAGES and retry. Posts already written were kept.`
      );
    }
    after = cursor;
  }

  if (failures.length > 0) {
    throw new Error(
      `Instagram sync incomplete. ${failures.length} post(s) failed (${failures.join(", ")}). Posts already written were kept.`
    );
  }

  await deps.putSuccessMetric();
  return { saved, skipped };
}

async function refreshToken(
  current: StoredInstagramToken,
  deps: SyncDependencies
): Promise<StoredInstagramToken> {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", current.accessToken);

  const { status, body } = await readGraph(deps, url);
  if (status < 200 || status >= 300) {
    const error = parseGraphError(status, body);
    logGraphError(error);
    throw error;
  }

  const refreshed = parseRefreshResponse(body);
  await assertReplacementTokenWorks(refreshed.accessToken, deps);

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

async function assertReplacementTokenWorks(accessToken: string, deps: SyncDependencies): Promise<void> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/me`);
  url.searchParams.set("fields", "id");
  url.searchParams.set("access_token", accessToken);

  const { status, body } = await readGraph(deps, url);
  if (status < 200 || status >= 300) {
    const error = parseGraphError(status, body);
    logGraphError(error);
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Replacement Instagram token could not be validated");
  }
  const id = parsed && typeof parsed === "object" ? (parsed as { id?: unknown }).id : undefined;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Replacement Instagram token could not be validated");
  }
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

  const { status, body } = await readGraph(deps, url);
  if (status < 200 || status >= 300) {
    const error = parseGraphError(status, body);
    logGraphError(error);
    throw error;
  }

  try {
    return JSON.parse(body) as InstagramPage;
  } catch {
    throw new Error("Instagram media response was not valid JSON");
  }
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

async function fetchCarouselChildren(
  mediaId: string,
  accessToken: string,
  deps: SyncDependencies
): Promise<InstagramChildMedia[]> {
  const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${mediaId}/children`);
  url.searchParams.set("fields", "id,media_type,media_url");
  url.searchParams.set("access_token", accessToken);

  const { status, body } = await readGraph(deps, url);
  if (status < 200 || status >= 300) {
    const error = parseGraphError(status, body);
    logGraphError(error);
    throw error;
  }

  const data = JSON.parse(body) as { data?: InstagramChildMedia[] };
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

function buildS3Key(photoId: string): string {
  return `instagram/${new Date().getFullYear()}/${photoId}.jpg`;
}

async function downloadAndUploadImage(
  mediaId: string,
  mediaUrl: string,
  deps: SyncDependencies
): Promise<DynamoGalleryMedia> {
  const imageBuffer = await downloadMediaFromUrl(mediaUrl, deps);
  const s3Url = await deps.uploadPhoto(mediaId, imageBuffer, "image/jpeg");
  return { mediaId, s3Key: buildS3Key(mediaId), url: s3Url };
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

  const mediaAssets: DynamoGalleryMedia[] = [];
  for (const child of children) {
    if (child.media_type !== "IMAGE") {
      console.log(`Skipping ${child.media_type} carousel child: ${child.id} (parent ${media.id})`);
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

  if (!media.media_url) {
    throw new Error(`No media_url found for ${media.id}`);
  }

  const uploaded = await downloadAndUploadImage(media.id, media.media_url, deps);
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

export function isReauthorisationError(error: unknown): boolean {
  return error instanceof InstagramGraphError && error.reauthorisationRequired;
}
