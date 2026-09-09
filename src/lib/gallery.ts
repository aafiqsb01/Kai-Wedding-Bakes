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

interface DynamoGalleryItem {
  photoId: string;
  backupUrl?: string;
  instagramUrl?: string;
  caption?: string;
  productType?: DynamoProductType | string;
  likes?: number | null;
  syncedAt?: string;
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

function resolveImageUrl(item: DynamoGalleryItem): string {
  const fromBackup = item.backupUrl?.trim()
    ? getObjectKeyFromBackupUrl(item.backupUrl.trim())
    : null;

  const objectKey =
    fromBackup ?? `instagram/2026/${item.photoId}.jpg`;

  return `${CLOUDFRONT_BASE.replace(/\/+$/, "")}/${objectKey}`;
}

function mapGalleryItemToCake(item: DynamoGalleryItem): Cake {
  const productType = item.productType?.trim() || undefined;

  return {
    id: item.photoId,
    title: formatProductTypeLabel(productType),
    category: mapProductTypeToCategory(productType),
    imageUrl: resolveImageUrl(item),
    description: item.caption ?? "",
    instagramUrl: item.instagramUrl,
    tags: [],
    productType,
    likes: typeof item.likes === "number" && !Number.isNaN(item.likes)
      ? item.likes
      : 0,
    syncedAt: item.syncedAt,
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
