export const INSTAGRAM_TOKEN_SECRET_ID = "opulence-wedding-bakes/instagram-access-token";

export class InstagramGraphError extends Error {
  readonly httpStatus: number;
  readonly graphCode: number | null;
  readonly graphType: string | null;
  readonly reauthorisationRequired: boolean;

  constructor(
    message: string,
    httpStatus: number,
    graphCode: number | null,
    graphType: string | null,
    reauthorisationRequired: boolean
  ) {
    super(message);
    this.name = "InstagramGraphError";
    this.httpStatus = httpStatus;
    this.graphCode = graphCode;
    this.graphType = graphType;
    this.reauthorisationRequired = reauthorisationRequired;
  }
}

/** Remove credential material that a Graph error body might echo. */
export function sanitizeGraphMessage(message: string): string {
  return message
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/bearer\s+[a-z0-9._\-+/=]+/gi, "Bearer [redacted]");
}

export function parseGraphError(httpStatus: number, body: string): InstagramGraphError {
  let graphCode: number | null = null;
  let graphType: string | null = null;
  let detail = `Instagram Graph API request failed with HTTP ${httpStatus}`;

  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown; code?: unknown; type?: unknown } };
    const error = parsed?.error;
    if (error && typeof error === "object") {
      if (typeof error.message === "string" && error.message.trim()) {
        detail = sanitizeGraphMessage(error.message);
      }
      if (typeof error.code === "number") graphCode = error.code;
      if (typeof error.type === "string") graphType = error.type;
    }
  } catch {
    detail = `Instagram Graph API request failed with HTTP ${httpStatus}`;
  }

  const reauthorisationRequired = graphCode === 190;
  const message = reauthorisationRequired
    ? `Instagram session invalidated (HTTP ${httpStatus}, OAuthException code 190). Manual re-authorisation is required. Replace Secrets Manager secret ${INSTAGRAM_TOKEN_SECRET_ID}. Automatic refresh cannot recover this token. Graph message: ${detail}`
    : `Instagram Graph API error (HTTP ${httpStatus}, code ${graphCode ?? "none"}, type ${graphType ?? "none"}): ${detail}`;

  return new InstagramGraphError(
    message,
    httpStatus,
    graphCode,
    graphType,
    reauthorisationRequired
  );
}

export function logGraphError(error: InstagramGraphError): void {
  console.error(
    JSON.stringify({
      event: "instagram_graph_error",
      httpStatus: error.httpStatus,
      graphCode: error.graphCode,
      graphType: error.graphType,
      reauthorisationRequired: error.reauthorisationRequired,
      message: error.message,
    })
  );
}

export function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown error";
  return sanitizeGraphMessage(raw);
}
