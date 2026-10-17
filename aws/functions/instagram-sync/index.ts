import { CloudWatchClient, PutMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { Handler } from "aws-lambda";
import fetch from "node-fetch";
import { getGallerySyncBoundary, saveGalleryItem } from "../../config/database";
import { getInstagramAccountId, getSecret, putSecret } from "../../config/secrets";
import { uploadPhotoToS3 } from "../../config/storage";
import {
  DEFAULT_MAX_PAGES,
  SYNC_FUNCTION_NAME,
  SYNC_METRIC_NAME,
  SYNC_METRIC_NAMESPACE,
  runInstagramSync,
} from "./sync";

const cloudWatch = new CloudWatchClient({ region: process.env.AWS_REGION || "eu-west-2" });
const TOKEN_SECRET_ID =
  process.env.AWS_SECRETS_INSTAGRAM || "opulence-wedding-bakes/instagram-access-token";

function maxPages(): number {
  const parsed = Number.parseInt(process.env.INSTAGRAM_SYNC_MAX_PAGES ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PAGES;
}

/**
 * Scheduled handler. A thrown error marks the EventBridge invocation as failed.
 * A returned value means every in-scope page and post completed, and the
 * success metric was published.
 */
export const handler: Handler = async () => {
  console.log("Instagram sync Lambda started");

  const summary = await runInstagramSync({
    fetch: async (url) => fetch(url),
    loadSecret: () => getSecret(TOKEN_SECRET_ID),
    saveSecret: (value) => putSecret(TOKEN_SECRET_ID, value),
    getAccountId: () => getInstagramAccountId(),
    getBoundary: () => getGallerySyncBoundary(),
    saveGalleryItem,
    uploadPhoto: (photoId, body, contentType) => uploadPhotoToS3(photoId, body, contentType),
    putSuccessMetric: async () => {
      await cloudWatch.send(
        new PutMetricDataCommand({
          Namespace: SYNC_METRIC_NAMESPACE,
          MetricData: [
            {
              MetricName: SYNC_METRIC_NAME,
              Dimensions: [{ Name: "FunctionName", Value: SYNC_FUNCTION_NAME }],
              Unit: "Count",
              Value: 1,
            },
          ],
        })
      );
    },
    now: () => new Date(),
    maxPages: maxPages(),
  });

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "Instagram sync completed",
      itemsProcessed: summary.saved,
      itemsSkipped: summary.skipped,
    }),
  };
};
