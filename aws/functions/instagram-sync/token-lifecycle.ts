/**
 * Instagram Login long-lived tokens.
 * Meta documents that a token can be refreshed only while it is still valid
 * and at least 24 hours old:
 * GET https://graph.instagram.com/refresh_access_token
 *   ?grant_type=ig_refresh_token&access_token={token}
 * The response includes expires_in (seconds). Refreshed tokens last 60 days
 * from the refresh. OAuthException code 190 means the session is dead and
 * must not be sent to the refresh endpoint.
 *
 * This module never invents expiresAt. A raw secret string has no expiry, so
 * it is used as-is. Auto-refresh runs only when a previous Meta response
 * supplied expiresAt and refreshedAt, the token is at least 24 hours old,
 * and expiry is inside the refresh window.
 */
export const REFRESH_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;
export const MIN_TOKEN_AGE_MS = 24 * 60 * 60 * 1000;

export type StoredInstagramToken = {
  accessToken: string;
  expiresAt: string | null;
  refreshedAt: string | null;
  format: "raw" | "structured";
};

export function parseStoredToken(secret: string): StoredInstagramToken {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new Error("Instagram access token secret is empty");
  }

  if (!trimmed.startsWith("{")) {
    return {
      accessToken: trimmed,
      expiresAt: null,
      refreshedAt: null,
      format: "raw",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("Instagram access token secret is malformed JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Instagram access token secret is malformed JSON");
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.accessToken !== "string" || !record.accessToken.trim()) {
    throw new Error("Structured Instagram token is missing accessToken");
  }

  const expiresAt = optionalTimestamp(record.expiresAt, "expiresAt");
  const refreshedAt = optionalTimestamp(record.refreshedAt, "refreshedAt");

  return {
    accessToken: record.accessToken.trim(),
    expiresAt,
    refreshedAt,
    format: "structured",
  };
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new Error(`Structured Instagram token has an invalid ${field}`);
  }
  return value;
}

export function isRefreshEligible(token: StoredInstagramToken, now: Date): boolean {
  if (!token.expiresAt || !token.refreshedAt) return false;

  const expiresMs = Date.parse(token.expiresAt);
  const refreshedMs = Date.parse(token.refreshedAt);
  if (Number.isNaN(expiresMs) || Number.isNaN(refreshedMs)) return false;

  const nowMs = now.getTime();
  if (nowMs >= expiresMs) return false;
  if (nowMs - refreshedMs < MIN_TOKEN_AGE_MS) return false;
  return expiresMs - nowMs <= REFRESH_WINDOW_MS;
}

export function parseRefreshResponse(body: string): { accessToken: string; expiresIn: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("Instagram token refresh returned a non-JSON response");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Instagram token refresh returned an invalid response");
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.access_token !== "string" || !record.access_token.trim()) {
    throw new Error("Instagram token refresh response did not include an access token");
  }
  if (typeof record.expires_in !== "number" || !Number.isFinite(record.expires_in) || record.expires_in <= 0) {
    throw new Error("Instagram token refresh response did not include expires_in");
  }

  return { accessToken: record.access_token.trim(), expiresIn: record.expires_in };
}

/** Build the structured secret from Meta's expires_in. Does not guess a duration. */
export function serialiseRefreshedToken(accessToken: string, expiresInSeconds: number, now: Date): string {
  if (!accessToken.trim()) {
    throw new Error("Refusing to store an empty refreshed Instagram token");
  }
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("Refusing to store a refreshed Instagram token without expires_in");
  }

  return JSON.stringify({
    accessToken,
    expiresAt: new Date(now.getTime() + expiresInSeconds * 1000).toISOString(),
    refreshedAt: now.toISOString(),
  });
}
