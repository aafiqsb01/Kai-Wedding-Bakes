import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// Initialize S3 client
const s3Client = new S3Client({ region: process.env.AWS_REGION || "eu-west-2" });
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || "opulence-wedding-bakes-photos";

// ============================================
// S3 Operations
// ============================================

/** Key and URL of one object written by uploadPhotoToS3. */
export type UploadedPhoto = {
  key: string;
  url: string;
};

function photoObjectKey(photoId: string): string {
  return `instagram/${new Date().getFullYear()}/${photoId}.jpg`;
}

/**
 * Upload a photo to S3 from Instagram.
 * Returns the key that was written and the same S3 URL format as before.
 */
export async function uploadPhotoToS3(
  photoId: string,
  photoBuffer: Buffer,
  contentType: string
): Promise<UploadedPhoto> {
  const key = photoObjectKey(photoId);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: photoBuffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  return {
    key,
    url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION || "eu-west-2"}.amazonaws.com/${key}`,
  };
}