import { Handler } from "aws-lambda";
import fetch from "node-fetch";
import { getInstagramToken, getInstagramAccountId } from "../../config/secrets";
import { uploadPhotoToS3 } from "../../config/storage";
import {
  saveGalleryItem,
  DynamoGalleryItem,
  DynamoGalleryMedia,
  ProductType,
} from "../../config/database";

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

interface InstagramChildMedia {
  id: string;
  media_type: "IMAGE" | "VIDEO";
  media_url?: string;
}

interface InstagramChildrenResponse {
  data: InstagramChildMedia[];
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

export const handler: Handler = async () => {
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
 * Fetch child media items for a CAROUSEL_ALBUM post
 */
async function fetchCarouselChildren(
  mediaId: string,
  token: string
): Promise<InstagramChildMedia[]> {
  const url = `https://graph.instagram.com/v18.0/${mediaId}/children?fields=id,media_type,media_url&access_token=${token}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Instagram API error fetching carousel children for ${mediaId}: ${response.statusText}`
    );
  }

  const data = (await response.json()) as InstagramChildrenResponse;
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
 * Stable S3 object key matching uploadPhotoToS3 conventions.
 */
function buildS3Key(photoId: string): string {
  return `instagram/${new Date().getFullYear()}/${photoId}.jpg`;
}

/**
 * Download an image and upload it to S3 using the existing key convention.
 */
async function downloadAndUploadImage(
  mediaId: string,
  mediaUrl: string
): Promise<DynamoGalleryMedia> {
  console.log(`⬇️  Downloading media: ${mediaId}`);
  const imageBuffer = await downloadMediaFromUrl(mediaUrl);

  console.log(`☁️  Uploading to S3: ${mediaId}`);
  const s3Url = await uploadPhotoToS3(mediaId, imageBuffer, "image/jpeg");

  return {
    mediaId,
    s3Key: buildS3Key(mediaId),
    url: s3Url,
  };
}

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

/**
 * Extract hashtag tokens from a caption (without the leading #).
 * Only matches actual #tags, not bare words like "engagements".
 */
function extractHashtags(caption: string): string[] {
  const matches = caption.match(/#[\w-]+/g);
  if (!matches) return [];
  return matches.map((tag) => tag.slice(1).toLowerCase());
}

/**
 * Map Instagram caption hashtags to a canonical product type.
 * First recognised product hashtag wins; otherwise defaults to wedding-cake.
 */
function mapToProductType(caption?: string): ProductType {
  if (!caption) return "wedding-cake";

  for (const tag of extractHashtags(caption)) {
    const productType = HASHTAG_TO_PRODUCT_TYPE[tag];
    if (productType) return productType;
  }

  return "wedding-cake";
}

/**
 * Process a CAROUSEL_ALBUM post as a single gallery item with multiple media assets.
 * If any child image fails to download/upload, the whole carousel fails (no Dynamo write).
 */
async function processCarouselAlbum(
  media: InstagramMedia,
  instagramToken: string
): Promise<void> {
  console.log(`🎠 Processing carousel album: ${media.id}`);

  const children = await fetchCarouselChildren(media.id, instagramToken);
  if (children.length === 0) {
    throw new Error(`Carousel ${media.id} has no child media`);
  }

  const mediaAssets: DynamoGalleryMedia[] = [];

  for (const child of children) {
    if (child.media_type !== "IMAGE") {
      console.log(
        `⏭️  Skipping ${child.media_type} carousel child: ${child.id} (parent ${media.id})`
      );
      continue;
    }

    if (!child.media_url) {
      throw new Error(
        `Carousel child ${child.id} (parent ${media.id}) has no media_url`
      );
    }

    try {
      const asset = await downloadAndUploadImage(child.id, child.media_url);
      mediaAssets.push(asset);
    } catch (error) {
      console.error(
        `❌ Failed to process carousel child ${child.id} (parent ${media.id}):`,
        error
      );
      throw new Error(
        `Carousel ${media.id} incomplete: child ${child.id} failed — ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (mediaAssets.length === 0) {
    throw new Error(
      `Carousel ${media.id} has no IMAGE children to sync`
    );
  }

  const productType = mapToProductType(media.caption);
  const cover = mediaAssets[0];

  console.log(`💾 Saving carousel to DynamoDB: ${media.id} (${mediaAssets.length} images)`);
  const galleryItem: DynamoGalleryItem = {
    photoId: media.id,
    backupUrl: cover.url,
    instagramUrl: media.permalink,
    caption: media.caption || "",
    productType,
    likes: media.like_count || 0,
    syncedAt: new Date().toISOString(),
    instagramTimestamp: media.timestamp,
    mediaType: "CAROUSEL_ALBUM",
    media: mediaAssets,
  };

  await saveGalleryItem(galleryItem);
  console.log(`✅ Processed carousel: ${media.id} → ${productType} (${mediaAssets.length} images)`);
}

/**
 * Process a single Instagram media item
 */
async function processInstagramMedia(media: InstagramMedia, instagramToken: string): Promise<void> {
  if (media.media_type === "VIDEO") {
    console.log(`⏭️  Skipping VIDEO media: ${media.id}`);
    return;
  }

  if (media.media_type === "CAROUSEL_ALBUM") {
    await processCarouselAlbum(media, instagramToken);
    return;
  }

  if (media.media_type !== "IMAGE") {
    console.log(`⏭️  Skipping ${media.media_type} media: ${media.id}`);
    return;
  }

  if (!media.media_url) {
    throw new Error("No media_url found");
  }

  const uploaded = await downloadAndUploadImage(media.id, media.media_url);
  const productType = mapToProductType(media.caption);

  // Save to DynamoDB — keep legacy single-image shape (backupUrl only)
  console.log(`💾 Saving to DynamoDB: ${media.id}`);
  const galleryItem: DynamoGalleryItem = {
    photoId: media.id,
    backupUrl: uploaded.url,
    instagramUrl: media.permalink,
    caption: media.caption || "",
    productType,
    likes: media.like_count || 0,
    syncedAt: new Date().toISOString(),
    instagramTimestamp: media.timestamp,
    mediaType: "IMAGE",
  };

  await saveGalleryItem(galleryItem);
  console.log(`✅ Processed: ${media.id} → ${productType}`);
}
