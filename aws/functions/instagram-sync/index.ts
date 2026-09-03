import { Handler } from "aws-lambda";
import fetch from "node-fetch";
import { getInstagramToken, getInstagramAccountId } from "../../config/secrets";
import { uploadPhotoToS3 } from "../../config/storage";
import { saveGalleryItem, DynamoGalleryItem } from "../../config/database";

// ============================================
// Instagram Graph API Types
// ============================================

interface InstagramMedia {
  id: string;
  media_type: "IMAGE" | "VIDEO" | "CAROUSEL_ALBUM";
  media_url?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
  timestamp: string;
  permalink: string;
}

interface InstagramResponse {
  data: InstagramMedia[];
  paging?: {
    cursors: {
      before: string;
      after: string;
    };
  };
}

// ============================================
// Lambda Handler
// ============================================

export const handler: Handler = async (event: any) => {
  console.log("🎂 Instagram sync Lambda started");

  try {
    const instagramToken = await getInstagramToken();
    const businessAccountId = await getInstagramAccountId();

    // Fetch latest media from Instagram
    const media = await fetchInstagramMedia(businessAccountId, instagramToken);
    console.log(`📸 Fetched ${media.length} posts from Instagram`);

    // Process and save each media item
    const savedItems: string[] = [];
    for (const item of media) {
      try {
        await processInstagramMedia(item, instagramToken);
        savedItems.push(item.id);
      } catch (error) {
        console.error(`❌ Failed to process media ${item.id}:`, error);
        // Continue with next item even if one fails
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "✅ Instagram sync completed",
        itemsProcessed: savedItems.length,
        itemIds: savedItems,
      }),
    };
  } catch (error) {
    console.error("❌ Instagram sync failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Instagram sync failed",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
  }
};

// ============================================
// Helper Functions
// ============================================

/**
 * Fetch latest media from Instagram Business Account
 */
async function fetchInstagramMedia(accountId: string, token: string): Promise<InstagramMedia[]> {
  const url = `https://graph.instagram.com/v18.0/${accountId}/media?fields=id,media_type,media_url,caption,like_count,comments_count,timestamp,permalink&access_token=${token}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Instagram API error: ${response.statusText}`);
  }

  const data = (await response.json()) as InstagramResponse;
  return data.data || [];
}

/**
 * Download media from Instagram URL
 */
async function downloadMediaFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Map Instagram media type to product type
 * NOTE: This is a placeholder — you may need custom logic or hashtag parsing
 * to determine actual product type from caption
 */
function mapToProductType(
  caption?: string
): "wedding-cake" | "nikah-cake" | "cupcakes" | "biscuits" | "engagement-cake" {
  // Default to wedding-cake, but you can add hashtag parsing logic here
  if (!caption) return "wedding-cake";

  caption = caption.toLowerCase();

  if (caption.includes("#nikahtorte") || caption.includes("#nikahcake")) return "nikah-cake";
  if (caption.includes("#cupcakes")) return "cupcakes";
  if (caption.includes("#biscuits")) return "biscuits";
  if (caption.includes("#engagement")) return "engagement-cake";

  return "wedding-cake"; // Default
}

/**
 * Process a single Instagram media item
 */
async function processInstagramMedia(media: InstagramMedia, instagramToken: string): Promise<void> {
  // Skip videos for now (handle only images)
  if (media.media_type !== "IMAGE") {
    console.log(`⏭️  Skipping ${media.media_type} media: ${media.id}`);
    return;
  }

  if (!media.media_url) {
    throw new Error("No media_url found");
  }

  // Download image from Instagram
  console.log(`⬇️  Downloading media: ${media.id}`);
  const imageBuffer = await downloadMediaFromUrl(media.media_url);

  // Upload to S3
  console.log(`☁️  Uploading to S3: ${media.id}`);
  const s3Url = await uploadPhotoToS3(media.id, imageBuffer, "image/jpeg");

  // Determine product type (placeholder logic)
  const productType = mapToProductType(media.caption);

  // Save to DynamoDB
  console.log(`💾 Saving to DynamoDB: ${media.id}`);
  const galleryItem: DynamoGalleryItem = {
    photoId: media.id,
    backupUrl: s3Url,
    instagramUrl: media.permalink,
    caption: media.caption || "",
    productType,
    likes: media.like_count || 0,
    syncedAt: new Date().toISOString(),
  };

  await saveGalleryItem(galleryItem);
  console.log(`✅ Processed: ${media.id} → ${productType}`);
}