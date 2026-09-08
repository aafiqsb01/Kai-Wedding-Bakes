import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Initialize S3 client
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-2" });
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || "opulence-wedding-bakes-photos";

// ============================================
// S3 Operations
// ============================================

/**
 * Upload a photo to S3 from Instagram
 * @param photoId - Instagram media ID (unique identifier)
 * @param photoBuffer - Image buffer/binary data
 * @param contentType - MIME type (image/jpeg, image/png, etc.)
 * @returns S3 URL of uploaded photo
 */
export async function uploadPhotoToS3(
  photoId: string,
  photoBuffer: Buffer,
  contentType: string
): Promise<string> {
  const key = `instagram/${new Date().getFullYear()}/${photoId}.jpg`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: photoBuffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || "eu-west-2"}.amazonaws.com/${key}`;
}

/**
 * Get a signed URL for downloading a photo from S3
 * (useful if bucket is private)
 * @param photoId - Instagram media ID
 * @returns Signed URL valid for 1 hour
 */
export async function getSignedPhotoUrl(photoId: string): Promise<string> {
  const key = `instagram/${new Date().getFullYear()}/${photoId}.jpg`;

  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
}

/**
 * List all photos in S3 (optional: by prefix/year)
 * @param prefix - Optional folder prefix (e.g., "instagram/2025/")
 * @returns Array of object keys
 */
export async function listPhotosInS3(prefix?: string): Promise<string[]> {
  const command = new ListObjectsV2Command({
    Bucket: BUCKET_NAME,
    Prefix: prefix || "instagram/",
  });

  const result = await s3Client.send(command);
  return (result.Contents || []).map((obj) => obj.Key || "").filter(Boolean);
}

/**
 * Delete a photo from S3
 * @param photoId - Instagram media ID
 */
export async function deletePhotoFromS3(photoId: string): Promise<void> {
  const key = `instagram/${new Date().getFullYear()}/${photoId}.jpg`;

  const command = new DeleteObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });

  await s3Client.send(command);
}

/**
 * Check if a photo exists in S3
 * @param photoId - Instagram media ID
 * @returns true if exists, false otherwise
 */
export async function photoExistsInS3(photoId: string): Promise<boolean> {
  try {
    const key = `instagram/${new Date().getFullYear()}/${photoId}.jpg`;
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    return false;
  }
}