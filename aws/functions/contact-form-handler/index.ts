import { randomUUID } from "crypto";
import { Handler } from "aws-lambda";
import { Resend } from "resend";
import { saveEnquiry, DynamoEnquiry } from "../../config/database";
import { getResendApiKey } from "../../config/secrets";

// ============================================
// Types
// ============================================

interface ContactFormPayload {
  name: string;
  email: string;
  eventDate: string;
  venue: string;
  enquiry: string;
}

interface HandlerResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

type OutboundEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
};

export type ContactFormDeps = {
  saveEnquiry: (enquiry: DynamoEnquiry) => Promise<void>;
  sendEmail: (message: OutboundEmail) => Promise<void>;
  now: () => Date;
  createId: () => string;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
};

/** Same practical email check as Zod 4 z.email(). */
const EMAIL_PATTERN =
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
/** ASCII letters, a literal space, apostrophes, and hyphens. Not `\s`. */
const NAME_PATTERN = /^[a-zA-Z '-]+$/;

const CONFIRMATION_FROM = "Opulence Wedding Bakes <onboarding@resend.dev>";
const NOTIFICATION_FROM = "Opulence Wedding Bakes <onboarding@resend.dev>";

function jsonResponse(statusCode: number, payload: unknown): HandlerResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  };
}

function invalidPayloadResponse(): HandlerResponse {
  console.warn("Contact form rejected: invalid payload");
  return jsonResponse(400, { error: "Missing required fields" });
}

/**
 * Website contactFormSchema rules, applied to untrusted JSON.
 * Strings are not trimmed except for the event-date non-blank check.
 */
export function validateContactEnquiry(input: unknown): ContactFormPayload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;

  const record = input as Record<string, unknown>;
  const { name, email, eventDate, venue, enquiry } = record;

  if (typeof name !== "string" || name.length < 2 || name.length > 100 || !NAME_PATTERN.test(name)) {
    return null;
  }
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email)) return null;
  if (typeof eventDate !== "string" || eventDate.length < 1 || eventDate.trim().length === 0) {
    return null;
  }
  if (typeof venue !== "string" || venue.length < 2) return null;
  if (typeof enquiry !== "string" || enquiry.length < 10 || enquiry.length > 1000) return null;

  return { name, email, eventDate, venue, enquiry };
}

/** Escape text once, before any intentional HTML such as line-break tags is added. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function confirmationEmailHtml(customerName: string): string {
  return `
    <h2>Thank you, ${escapeHtml(customerName)}!</h2>
    <p/>
    <p>We've received your wedding cake enquiry and will get back to you within 24 hours.</p>
    <p>In the meantime, feel free to check out our gallery for inspiration!</p>
    <p>Best regards,<br/>Kai Wedding Bakes</p>
  `;
}

export function notificationEmailHtml(enquiry: DynamoEnquiry): string {
  const message = escapeHtml(enquiry.enquiry).replace(/\n/g, "<br/>");

  return `
    <h3>New enquiry</h3>
    <p><strong>Name:</strong> ${escapeHtml(enquiry.name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(enquiry.email)}</p>
    <p><strong>Event Date:</strong> ${escapeHtml(enquiry.eventDate)}</p>
    <p><strong>Venue:</strong> ${escapeHtml(enquiry.venue)}</p>
    <p><strong>Message:</strong></p>
    <p>${message}</p>
    <hr/>
    <p><small>Enquiry ID: ${enquiry.enquiryId}</small></p>
    <p><small>Received: ${enquiry.createdAt}</small></p>
  `;
}

function readRequestBody(event: { body?: unknown; isBase64Encoded?: boolean }): unknown {
  let rawBody = event.body;
  if (rawBody == null) {
    throw new Error("Missing request body");
  }
  if (event.isBase64Encoded && typeof rawBody === "string") {
    rawBody = Buffer.from(rawBody, "base64").toString("utf8");
  }
  return typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
}

function logHandlerError(enquiryId: string | undefined, error: unknown): void {
  const errorName = error instanceof Error ? error.name : "UnknownError";
  console.error(
    JSON.stringify({
      message: "Contact form handler failed",
      enquiryId: enquiryId ?? null,
      errorName,
    })
  );
}

async function sendWithResend(message: OutboundEmail): Promise<void> {
  const resendApiKey = await getResendApiKey();
  const resend = new Resend(resendApiKey);
  await resend.emails.send(message);
}

const defaultDeps: ContactFormDeps = {
  saveEnquiry,
  sendEmail: sendWithResend,
  now: () => new Date(),
  createId: () => randomUUID(),
};

export async function processContactForm(
  event: any,
  deps: ContactFormDeps = defaultDeps
): Promise<HandlerResponse> {
  console.log("Contact form handler Lambda started");

  // API Gateway / Function URL CORS preflight
  const method = event.requestContext?.http?.method || event.httpMethod || event.requestContext?.httpMethod;
  if (method === "OPTIONS") {
    return jsonResponse(204, {});
  }

  let parsed: unknown;
  try {
    parsed = readRequestBody(event);
  } catch {
    return invalidPayloadResponse();
  }

  const formData = validateContactEnquiry(parsed);
  if (!formData) {
    return invalidPayloadResponse();
  }

  let enquiryId: string | undefined;

  try {
    enquiryId = deps.createId();
    const now = deps.now().toISOString();

    const enquiry: DynamoEnquiry = {
      enquiryId,
      name: formData.name,
      email: formData.email,
      eventDate: formData.eventDate,
      venue: formData.venue,
      enquiry: formData.enquiry,
      status: "new",
      createdAt: now,
      updatedAt: now,
    };

    // Save to DynamoDB
    console.log(`Saving enquiry ${enquiryId}`);
    await deps.saveEnquiry(enquiry);

    const businessEmail = process.env.CONTACT_FORM_RECIPIENT_EMAIL || "opulenceweddingcakes@gmail.com";

    // Send confirmation email to user
    console.log(`Sending confirmation email for enquiry ${enquiryId}`);
    await deps.sendEmail({
      from: CONFIRMATION_FROM,
      to: formData.email,
      subject: "We've received your enquiry - Opulence Wedding Bakes",
      html: confirmationEmailHtml(formData.name),
    });

    // Send notification email to business
    console.log(`Sending notification email for enquiry ${enquiryId}`);
    await deps.sendEmail({
      from: NOTIFICATION_FROM,
      to: businessEmail,
      subject: `New Enquiry from ${enquiry.name}`,
      html: notificationEmailHtml(enquiry),
    });

    return jsonResponse(200, {
      message: "✅ Enquiry received successfully",
      enquiryId,
    });
  } catch (error) {
    logHandlerError(enquiryId, error);
    return jsonResponse(500, {
      error: "Failed to process enquiry",
    });
  }
}

export const handler: Handler = (event) => processContactForm(event);
