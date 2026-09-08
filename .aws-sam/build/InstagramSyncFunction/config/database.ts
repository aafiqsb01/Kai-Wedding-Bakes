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
 * Gallery item record in DynamoDB
 * Synced from Instagram via Lambda
 */
export interface DynamoGalleryItem {
    photoId: string;                    // PK: Instagram media ID
    instagramUrl: string;               // Original Instagram URL
    backupUrl: string;                      // S3 backup URL
    caption: string;
    productType: "wedding-cake" | "nikah-cake" | "cupcakes" | "biscuits" | "engagement-cake";
    likes: number;                      // ✅ NEEDED for "most liked" filter
    syncedAt: string;                   // ISO timestamp
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