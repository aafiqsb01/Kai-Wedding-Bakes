export const INSTAGRAM_TOKEN_SECRET_ID = "opulence-wedding-bakes/instagram-access-token";

export class InstagramGraphError extends Error {
  readonly httpStatus: number;
  readonly graphCode: number | null;
  readonly graphSubcode: number | null;
  readonly graphType: string | null;
  /** Structured `error.is_transient` flag. Rate-limit codes are classified separately. */
  readonly transient: boolean;
  readonly blameFields: readonly string[];
  readonly reauthorisationRequired: boolean;

  constructor(
    message: string,
    httpStatus: number,
    graphCode: number | null,
    graphSubcode: number | null,
    graphType: string | null,
    transient: boolean,
    blameFields: readonly string[],
    reauthorisationRequired: boolean
  ) {
    super(message);
    this.name = "InstagramGraphError";
    this.httpStatus = httpStatus;
    this.graphCode = graphCode;
    this.graphSubcode = graphSubcode;
    this.graphType = graphType;
    this.transient = transient;
    this.blameFields = blameFields;
    this.reauthorisationRequired = reauthorisationRequired;
  }
}

/** Remove credential material that a Graph error body might echo. */
export function sanitizeGraphMessage(message: string): string {
  return message
    .replace(/access_token=[^&\s]+/gi, "access_token=[redacted]")
    .replace(/bearer\s+[a-z0-9._\-+/=]+/gi, "Bearer [redacted]");
}

/** Graph API unknown/service errors and documented throttling codes. */
const TRANSIENT_GRAPH_CODES = new Set([
  1, 2, 4, 17, 32, 613, 80000, 80001, 80002, 80003, 80004, 80006, 80008, 80014,
]);

const CURSOR_FIELDS = new Set(["after", "cursor"]);

function blameFieldsOf(error: { error_data?: unknown }): string[] {
  const data = error.error_data;
  if (!data || typeof data !== "object") return [];
  const record = data as { blame_field?: unknown; blame_field_specs?: unknown };
  const fields: string[] = [];
  if (typeof record.blame_field === "string" && record.blame_field.trim()) {
    fields.push(record.blame_field);
  }
  if (Array.isArray(record.blame_field_specs)) {
    for (const spec of record.blame_field_specs) {
      if (typeof spec === "string" && spec.trim()) fields.push(spec);
      if (!Array.isArray(spec)) continue;
      for (const part of spec) {
        if (typeof part === "string" && part.trim()) fields.push(part);
      }
    }
  }
  return fields;
}

export function parseGraphError(httpStatus: number, body: string): InstagramGraphError {
  let graphCode: number | null = null;
  let graphSubcode: number | null = null;
  let graphType: string | null = null;
  let transient = false;
  let blameFields: string[] = [];
  let detail = `Instagram Graph API request failed with HTTP ${httpStatus}`;

  try {
    const parsed = JSON.parse(body) as {
      error?: {
        message?: unknown;
        code?: unknown;
        error_subcode?: unknown;
        type?: unknown;
        is_transient?: unknown;
        error_data?: unknown;
      };
    };
    const error = parsed?.error;
    if (error && typeof error === "object") {
      if (typeof error.message === "string" && error.message.trim()) {
        detail = sanitizeGraphMessage(error.message);
      }
      if (typeof error.code === "number") graphCode = error.code;
      if (typeof error.error_subcode === "number") graphSubcode = error.error_subcode;
      if (typeof error.type === "string") graphType = error.type;
      transient = error.is_transient === true;
      blameFields = blameFieldsOf(error);
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
    graphSubcode,
    graphType,
    transient,
    blameFields,
    reauthorisationRequired
  );
}

export function logGraphError(error: InstagramGraphError): void {
  console.error(
    JSON.stringify({
      event: "instagram_graph_error",
      httpStatus: error.httpStatus,
      graphCode: error.graphCode,
      graphSubcode: error.graphSubcode,
      graphType: error.graphType,
      transient: error.transient,
      reauthorisationRequired: error.reauthorisationRequired,
      message: error.message,
    })
  );
}

/**
 * Temporary Graph failures, including throttling, should keep the saved cursor
 * for the next scheduled run. Auth failures are not retries of the same page.
 */
export function isTransientGraphError(error: InstagramGraphError): boolean {
  if (error.reauthorisationRequired) return false;
  if (error.transient) return true;
  if (error.httpStatus === 429 || error.httpStatus >= 500) return true;
  return error.graphCode !== null && TRANSIENT_GRAPH_CODES.has(error.graphCode);
}

/**
 * A rejected paging cursor on a continuation request.
 * Transient errors and code 190 are excluded. Code 100 is Graph's invalid-parameter
 * code; continuation requests add only `after`, so that code identifies the cursor
 * without matching message text. `error_data` blame fields are preferred when present.
 * The message remains a fallback for bodies that name the cursor and use another code.
 */
export function isInvalidCursorError(error: unknown): boolean {
  if (!(error instanceof InstagramGraphError)) return false;
  if (error.reauthorisationRequired) return false;
  if (isTransientGraphError(error)) return false;
  if (error.blameFields.some((field) => CURSOR_FIELDS.has(field))) return true;
  if (error.graphCode === 100) return true;
  return /cursor/i.test(error.message);
}

export function publicErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : "Unknown error";
  return sanitizeGraphMessage(raw);
}
