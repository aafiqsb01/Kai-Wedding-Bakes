import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";

// Initialize DynamoDB client
const dynamoDbClient = new DynamoDBClient({ region: process.env.AWS_REGION || "eu-west-2" });
export const documentClient = DynamoDBDocumentClient.from(dynamoDbClient);

// ============================================
// Table Names
// ============================================
export const TABLES = {
  ENQUIRIES: process.env.AWS_DYNAMODB_TABLE_ENQUIRIES || "opulence-wedding-bakes-enquiries",
  GALLERY: process.env.AWS_DYNAMODB_TABLE_GALLERY || "opulence-wedding-bakes-gallery",
  INSTAGRAM_SYNC_RECOVERY:
    process.env.AWS_DYNAMODB_TABLE_INSTAGRAM_SYNC_RECOVERY ||
    "opulence-wedding-bakes-instagram-sync-recovery",
} as const;

// ============================================
// Type Definitions
// ============================================

/**
 * Enquiry record in DynamoDB
 * Mirrors the ContactFormData from the frontend form
 */
export interface DynamoEnquiry {
  enquiryId: string;          // PK: UUID
  name: string;
  email: string;
  eventDate: string;          // ISO date string
  venue: string;
  enquiry: string;            // Full message
  status: "new" | "contacted" | "archived";
  createdAt: string;          // ISO timestamp
  updatedAt: string;          // ISO timestamp
}

/**
 * A single media asset belonging to a gallery item (e.g. carousel child).
 */
export interface DynamoGalleryMedia {
  mediaId: string; // Instagram child media ID (or parent ID for single images)
  s3Key: string;
  url: string; // S3 object URL
}

/** Canonical gallery product categories written by Instagram sync. */
export type ProductType =
  | "wedding-cake"
  | "nikah-cake"
  | "cupcakes"
  | "engagement-cake";

/**
 * Gallery item record in DynamoDB
 * Synced from Instagram via Lambda
 *
 * Legacy single-image items only have backupUrl (no media / mediaType).
 * Carousel albums store media[] while still setting backupUrl to the first
 * image so existing readers keep working.
 */
export interface DynamoGalleryItem {
    photoId: string;                    // PK: Instagram media ID
    instagramUrl: string;               // Original Instagram URL
    backupUrl: string;                  // S3 backup URL (cover / first image)
    caption: string;
    productType: ProductType;
    likes: number;                      // ✅ NEEDED for "most liked" filter
    syncedAt: string;                   // ISO timestamp of last Lambda sync
    /** Original Instagram media timestamp (ISO). Used for gallery ordering. */
    instagramTimestamp?: string;
    mediaType?: "IMAGE" | "CAROUSEL_ALBUM";
    media?: DynamoGalleryMedia[];       // Present for carousels; optional for IMAGE
    // comments: number;                // ❌ Optional – only if you want to display
  }

// ============================================
// DynamoDB Operations (Optional helpers for Lambda)
// ============================================

// Save an enquiry to DynamoDB
export async function saveEnquiry(enquiry: DynamoEnquiry): Promise<void> {
  const command = new PutCommand({
    TableName: TABLES.ENQUIRIES,
    Item: enquiry,
  });
  await documentClient.send(command);
}

// Fetch a single enquiry by ID
export async function getEnquiry(enquiryId: string): Promise<DynamoEnquiry | undefined> {
  const command = new GetCommand({
    TableName: TABLES.ENQUIRIES,
    Key: { enquiryId },
  });
  const result = await documentClient.send(command);
  return result.Item as DynamoEnquiry | undefined;
}

// Scan all enquiries (use cautiously in production)
export async function getAllEnquiries(): Promise<DynamoEnquiry[]> {
  const command = new ScanCommand({
    TableName: TABLES.ENQUIRIES,
  });
  const result = await documentClient.send(command);
  return (result.Items || []) as DynamoEnquiry[];
}

// Save a gallery item to DynamoDB
export async function saveGalleryItem(item: DynamoGalleryItem): Promise<void> {
  const command = new PutCommand({
    TableName: TABLES.GALLERY,
    Item: item,
  });
  await documentClient.send(command);
}

/**
 * Newest Instagram timestamp already stored, or null when the gallery has none.
 * Sync does not use this as its import boundary. The recovery row owns the
 * backfill floor and any resume cursor. Does not delete or rewrite rows.
 */
export async function getGallerySyncBoundary(): Promise<string | null> {
  let newestMs: number | null = null;
  let newestRaw: string | null = null;
  let startKey: Record<string, unknown> | undefined;

  do {
    const result = await documentClient.send(
      new ScanCommand({
        TableName: TABLES.GALLERY,
        ProjectionExpression: "instagramTimestamp",
        ExclusiveStartKey: startKey,
      })
    );

    for (const item of result.Items ?? []) {
      const raw = item.instagramTimestamp;
      if (typeof raw !== "string" || !raw.trim()) continue;
      const ms = Date.parse(raw);
      if (Number.isNaN(ms)) continue;
      if (newestMs === null || ms > newestMs) {
        newestMs = ms;
        newestRaw = raw;
      }
    }

    startKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (startKey);

  return newestRaw;
}

// Fetch all gallery items
export async function getAllGalleryItems(): Promise<DynamoGalleryItem[]> {
  const command = new ScanCommand({
    TableName: TABLES.GALLERY,
  });
  const result = await documentClient.send(command);
  return (result.Items || []) as DynamoGalleryItem[];
}

// Fetch a single gallery item by photoId
export async function getGalleryItem(photoId: string): Promise<DynamoGalleryItem | undefined> {
  const command = new GetCommand({
    TableName: TABLES.GALLERY,
    Key: { photoId },
  });
  const result = await documentClient.send(command);
  return result.Item as DynamoGalleryItem | undefined;
}