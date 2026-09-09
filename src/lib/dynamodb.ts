import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { awsCredentialsProvider } from "@vercel/functions/oidc";

const region = process.env.AWS_REGION || "eu-west-2";

// Vercel injects OIDC tokens; local/dev uses the AWS SDK default credential chain
// (e.g. AWS CLI profile / SSO). Never put access keys in the repo or .env files.
const client = new DynamoDBClient(
  process.env.VERCEL && process.env.AWS_ROLE_ARN
    ? {
        region,
        credentials: awsCredentialsProvider({
          roleArn: process.env.AWS_ROLE_ARN,
        }),
      }
    : {
        region,
      }
);

export const docClient = DynamoDBDocumentClient.from(client);

export const GALLERY_TABLE =
  process.env.AWS_DYNAMODB_TABLE_GALLERY || "opulence-wedding-bakes-gallery";
