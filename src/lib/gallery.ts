import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Cake } from "@/types";
import { docClient, GALLERY_TABLE } from "@/lib/dynamodb";
import { formatProductTypeLabel } from "@/lib/product-type";

const CLOUDFRONT_BASE = "https://d2zp5rpt2x30su.cloudfront.net";

type DynamoProductType =
  | "wedding-cake"
  | "nikah-cake"
  | "nikkah-cake"
  | "cupcakes"
  | "biscuits"
  | "brownies"
  | "engagement-cake";

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
  productType?: DynamoProductType | string;
  likes?: number | null;
  syncedAt?: string;
  mediaType?: "IMAGE" | "CAROUSEL_ALBUM" | string;
  media?: DynamoGalleryMedia[];
}

function mapProductTypeToCategory(
  productType: string | undefined
): Cake["category"] {
  switch (productType) {
    case "nikah-cake":
    case "nikkah-cake":
      return "nikkah cake";
    case "cupcakes":
      return "cupcakes";
    case "engagement-cake":
      return "engagement cake";
    case "wedding-cake":
    case "biscuits":
    case "brownies":
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

function resolveImageUrl(item: DynamoGalleryItem): string {
  const fromBackup = item.backupUrl?.trim()
    ? getObjectKeyFromBackupUrl(item.backupUrl.trim())
    : null;

  const objectKey =
    fromBackup ?? `instagram/2026/${item.photoId}.jpg`;

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

function mapGalleryItemToCake(item: DynamoGalleryItem): Cake {
  const productType = item.productType?.trim() || undefined;
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
    likes: typeof item.likes === "number" && !Number.isNaN(item.likes)
      ? item.likes
      : 0,
    syncedAt: item.syncedAt,
    mediaType,
  };
}

/**
 * Loads gallery items from DynamoDB and maps them for the frontend.
 * Runs only on the server; never exposes AWS credentials or raw AWS errors.
 */
export async function getGalleryCakes(): Promise<Cake[]> {
  try {
    const result = await docClient.send(
      new ScanCommand({
        TableName: GALLERY_TABLE,
      })
    );

    const items = (result.Items ?? []) as DynamoGalleryItem[];

    return items
      .filter((item) => Boolean(item.photoId))
      .map(mapGalleryItemToCake);
  } catch (error) {
    console.error("Failed to load gallery items from DynamoDB", error);
    if (error instanceof Error) {
      console.error(error.name);
    }
    return [];
  }
}
