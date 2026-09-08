import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// Initialize Secrets Manager client
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || "eu-west-2" });

// Simple cache to avoid repeated API calls
const secretsCache = new Map<string, string>();

// ============================================
// Secrets Manager Operations
// ============================================

/**
 * Fetch a secret by name from AWS Secrets Manager
 * @param secretName - Name of the secret (e.g., "kai/instagram-api")
 * @returns Secret value
 */
export async function getSecret(secretName: string): Promise<string> {
  // Check cache first
  if (secretsCache.has(secretName)) {
    return secretsCache.get(secretName)!;
  }

  try {
    const command = new GetSecretValueCommand({
      SecretId: secretName,
    });

    const result = await secretsClient.send(command);
    const secretValue = result.SecretString || result.SecretBinary?.toString() || "";

    // Cache the secret
    secretsCache.set(secretName, secretValue);

    return secretValue;
  } catch (error) {
    console.error(`Failed to fetch secret: ${secretName}`, error);
    throw new Error(`Could not retrieve secret: ${secretName}`);
  }
}

/**
 * Fetch Instagram API token from Secrets Manager
 * Falls back to environment variable if not found
 */
export async function getInstagramToken(): Promise<string> {
  try {
    const secretName = process.env.AWS_SECRETS_INSTAGRAM || "opulence/instagram-api";
    return await getSecret(secretName);
  } catch (error) {
    // Fallback to env var
    const token = process.env.INSTAGRAM_ACCESS_TOKEN;
    if (!token) {
      throw new Error("Instagram token not found in Secrets Manager or environment");
    }
    return token;
  }
}

/**
 * Fetch Resend API key from Secrets Manager
 * Falls back to environment variable if not found
 */
export async function getResendApiKey(): Promise<string> {
  try {
    const secretName = process.env.AWS_SECRETS_RESEND || "opulence/resend-api";
    return await getSecret(secretName);
  } catch (error) {
    // Fallback to env var
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      throw new Error("Resend API key not found in Secrets Manager or environment");
    }
    return key;
  }
}

/**
 * Clear the secrets cache (useful for testing or credential rotation)
 */
export function clearSecretsCache(): void {
  secretsCache.clear();
}

/**
 * Fetch Instagram Business Account ID from environment
 * (Account ID is not sensitive, so it stays in env vars)
 */
export function getInstagramAccountId(): string {
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  if (!accountId) {
    throw new Error("Instagram Business Account ID not configured");
  }
  return accountId;
}