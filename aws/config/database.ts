import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";

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

/**
 * Canonical gallery product categories written by Instagram sync.
 * Older rows may still store nikah, engagement, birthday, or anniversary
 * types until reclassify-gallery-product-types is applied.
 */
export type ProductType = "wedding-cake" | "cupcakes" | "celebratory-cakes" | "other-fun-bakes";

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
    /**
     * Primary type. Kept for readers that still expect one value.
     * Omitted when a new post has no classifiable hashtag. Those posts are
     * not given wedding-cake. Reclassification leaves an existing row unchanged
     * when its caption is unclassifiable.
     */
    productType?: ProductType;
    /**
     * Every product type this post belongs to, in canonical order:
     * wedding-cake, cupcakes, celebratory-cakes, other-fun-bakes.
     * other-fun-bakes is stored alone, never beside a specific category.
     * Absent on older rows, which still classify from productType alone.
     */
    productTypes?: ProductType[];
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

// Save a gallery item to DynamoDB
export async function saveGalleryItem(item: DynamoGalleryItem): Promise<void> {
  const command = new PutCommand({
    TableName: TABLES.GALLERY,
    Item: item,
  });
  await documentClient.send(command);
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