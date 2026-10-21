import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Cake } from "@/types";
import { docClient, GALLERY_TABLE } from "@/lib/dynamodb";
import { formatProductTypeLabel } from "@/lib/product-type";

const CLOUDFRONT_BASE = "https://d2zp5rpt2x30su.cloudfront.net";

type DynamoProductType =
  | "wedding-cake"
  | "celebratory-cakes"
  | "cupcakes"
  | "other-fun-bakes"
  | "nikah-cake"
  | "engagement-cake"
  | "birthday-cake"
  | "anniversary-cake";

interface DynamoGalleryMedia {
  mediaId?: string;
  s3Key?: string;
  url?: string;
}

interface DynamoGalleryItem {
  photoId: string;
  backupUrl?: string;
  instagramUrl?: string;
  caption?: string;
  /** Canonical productType; string allows legacy Dynamo values. */
  productType?: DynamoProductType | string;
  /** Full membership. Older rows omit this and keep productType only. */
  productTypes?: unknown;
  likes?: number | null;
  syncedAt?: string;
  instagramTimestamp?: string;
  mediaType?: "IMAGE" | "CAROUSEL_ALBUM" | string;
  media?: DynamoGalleryMedia[];
}

function mapProductTypeToCategory(
  productType: string | undefined
): Cake["category"] {
  switch (productType) {
    case "celebratory-cakes":
      return "celebratory cakes";
    case "nikah-cake":
      return "nikkah cake";
    case "cupcakes":
      return "cupcakes";
    case "other-fun-bakes":
      return "other fun bakes";
    case "engagement-cake":
      return "engagement cake";
    case "birthday-cake":
      return "birthday cake";
    case "anniversary-cake":
      return "anniversary cake";
    case "wedding-cake":
    default:
      return "wedding cake";
  }
}

/**
 * Derive the S3 object key from backupUrl (private S3 URL) so we can
 * serve the same object via CloudFront. Never return the raw S3 URL.
 */
function getObjectKeyFromBackupUrl(backupUrl: string): string | null {
  try {
    const { pathname } = new URL(backupUrl);
    const key = pathname.replace(/^\/+/, "").trim();
    return key || null;
  } catch {
    return null;
  }
}

function toCloudFrontUrl(objectKey: string): string {
  return `${CLOUDFRONT_BASE.replace(/\/+$/, "")}/${objectKey.replace(/^\/+/, "")}`;
}

function firstMediaKey(item: DynamoGalleryItem): string | null {
  if (!Array.isArray(item.media)) return null;
  for (const entry of item.media) {
    const key = entry.s3Key?.trim();
    if (key) return key;
  }
  return null;
}

/** Used only when the item has neither a media key nor a backup URL path. */
function fallbackObjectKey(item: DynamoGalleryItem): string {
  const parsed = Date.parse(item.syncedAt ?? "");
  const year = Number.isNaN(parsed) ? new Date().getUTCFullYear() : new Date(parsed).getUTCFullYear();
  return `instagram/${year}/${item.photoId}.jpg`;
}

function resolveImageUrl(item: DynamoGalleryItem): string {
  const fromBackup = item.backupUrl?.trim()
    ? getObjectKeyFromBackupUrl(item.backupUrl.trim())
    : null;
  const objectKey = firstMediaKey(item) ?? fromBackup ?? fallbackObjectKey(item);
  return toCloudFrontUrl(objectKey);
}

/**
 * Resolve CloudFront URLs for a carousel media[] collection.
 * Falls back to s3Key, then parses url, skipping invalid entries.
 */
function resolveMediaUrls(media: DynamoGalleryMedia[]): string[] {
  const urls: string[] = [];

  for (const entry of media) {
    const fromKey = entry.s3Key?.trim();
    if (fromKey) {
      urls.push(toCloudFrontUrl(fromKey));
      continue;
    }

    const fromUrl = entry.url?.trim()
      ? getObjectKeyFromBackupUrl(entry.url.trim())
      : null;
    if (fromUrl) {
      urls.push(toCloudFrontUrl(fromUrl));
    }
  }

  return urls;
}

function readProductTypes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const types: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const normalised = entry.trim().toLowerCase();
    if (!normalised || seen.has(normalised)) continue;
    seen.add(normalised);
    types.push(normalised);
  }
  return types.length > 0 ? types : undefined;
}

function mapGalleryItemToCake(item: DynamoGalleryItem): Cake {
  const productTypes = readProductTypes(item.productTypes);
  const productType = item.productType?.trim() || productTypes?.[0];
  const coverUrl = resolveImageUrl(item);

  const mediaUrls =
    Array.isArray(item.media) && item.media.length > 0
      ? resolveMediaUrls(item.media)
      : [];

  // Prefer media[] when present; otherwise legacy single-image via backupUrl
  const imageUrls = mediaUrls.length > 0 ? mediaUrls : undefined;
  const imageUrl = imageUrls?.[0] ?? coverUrl;

  const mediaType =
    item.mediaType === "CAROUSEL_ALBUM" || item.mediaType === "IMAGE"
      ? item.mediaType
      : imageUrls && imageUrls.length > 1
        ? "CAROUSEL_ALBUM"
        : undefined;

  return {
    id: item.photoId,
    title: formatProductTypeLabel(productType),
    category: mapProductTypeToCategory(productType),
    imageUrl,
    imageUrls,
    description: item.caption ?? "",
    instagramUrl: item.instagramUrl,
    tags: [],
    productType,
    productTypes,
    likes: typeof item.likes === "number" && !Number.isNaN(item.likes)
      ? item.likes
      : 0,
    syncedAt: item.syncedAt,
    instagramTimestamp: item.instagramTimestamp,
    mediaType,
  };
}

/**
 * Loads gallery items from DynamoDB and maps them for the frontend.
 * Follows every scan page. Runs only on the server and does not log records.
 */
export async function getGalleryCakes(): Promise<Cake[]> {
  try {
    const items: DynamoGalleryItem[] = [];
    let startKey: Record<string, unknown> | undefined;

    do {
      const result = await docClient.send(
        new ScanCommand({
          TableName: GALLERY_TABLE,
          ...(startKey ? { ExclusiveStartKey: startKey } : {}),
        })
      );

      items.push(...((result.Items ?? []) as DynamoGalleryItem[]));
      startKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (startKey);

    return items
      .filter((item) => Boolean(item.photoId))
      .map(mapGalleryItemToCake);
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    console.error("Failed to load gallery items from DynamoDB", errorName);
    return [];
  }
}
