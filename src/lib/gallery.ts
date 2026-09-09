import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import type { Cake } from "@/types";
import { docClient, GALLERY_TABLE } from "@/lib/dynamodb";

const CLOUDFRONT_BASE = "https://d2zp5rpt2x30su.cloudfront.net";

type DynamoProductType =
  | "wedding-cake"
  | "nikah-cake"
  | "cupcakes"
  | "biscuits"
  | "engagement-cake";

interface DynamoGalleryItem {
  photoId: string;
  instagramUrl?: string;
  caption?: string;
  productType?: DynamoProductType | string;
}

function mapProductTypeToCategory(
  productType: string | undefined
): Cake["category"] {
  switch (productType) {
    case "nikah-cake":
      return "nikkah cake";
    case "cupcakes":
      return "cupcakes";
    case "engagement-cake":
      return "engagement cake";
    case "wedding-cake":
    case "biscuits":
    default:
      return "wedding cake";
  }
}

function titleFromProductType(productType: string | undefined): string {
  switch (productType) {
    case "nikah-cake":
      return "Nikkah Cake";
    case "cupcakes":
      return "Cupcakes";
    case "engagement-cake":
      return "Engagement Cake";
    case "biscuits":
      return "Biscuits";
    case "wedding-cake":
    default:
      return "Wedding Cake";
  }
}

function mapGalleryItemToCake(item: DynamoGalleryItem): Cake {
  return {
    id: item.photoId,
    title: titleFromProductType(item.productType),
    category: mapProductTypeToCategory(item.productType),
    imageUrl: `${CLOUDFRONT_BASE}/instagram/2026/${item.photoId}.jpg`,
    description: item.caption ?? "",
    instagramUrl: item.instagramUrl,
    tags: [],
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
    console.error("Failed to load gallery items from DynamoDB" + error);
    if (error instanceof Error) {
      console.error(error.name);
    }
    return [];
  }
}
