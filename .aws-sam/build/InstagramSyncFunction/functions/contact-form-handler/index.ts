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

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json",
};

function jsonResponse(statusCode: number, payload: unknown): HandlerResponse {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(payload),
  };
}

function parseRequestBody(event: any): ContactFormPayload {
  let rawBody = event.body;
  if (rawBody == null) {
    throw new Error("Missing request body");
  }
  if (event.isBase64Encoded && typeof rawBody === "string") {
    rawBody = Buffer.from(rawBody, "base64").toString("utf8");
  }
  return typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
}

// ============================================
// Lambda Handler
// ============================================

export const handler: Handler = async (event: any): Promise<HandlerResponse> => {
  console.log("📧 Contact form handler Lambda started");
  console.log("Event:", JSON.stringify(event, null, 2));

  // API Gateway / Function URL CORS preflight
  const method = event.requestContext?.http?.method || event.httpMethod || event.requestContext?.httpMethod;
  if (method === "OPTIONS") {
    return jsonResponse(204, {});
  }

  try {
    // Parse request body (API Gateway may base64-encode the payload)
    const formData = parseRequestBody(event);

    // Validate required fields
    if (!formData.name || !formData.email || !formData.eventDate || !formData.venue || !formData.enquiry) {
      console.warn("❌ Missing required fields");
      return jsonResponse(400, { error: "Missing required fields" });
    }

    // Create enquiry record
    // #region agent log
    let enquiryId: string;
    try {
      enquiryId = randomUUID();
      fetch('http://127.0.0.1:7624/ingest/4a5b035c-2516-4325-be36-20d27c93f202',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d995f0'},body:JSON.stringify({sessionId:'d995f0',runId:'post-fix',hypothesisId:'A',location:'contact-form-handler/index.ts:enquiryId',message:'randomUUID succeeded',data:{enquiryIdPrefix:enquiryId.slice(0,8),hasCryptoGlobal:typeof (globalThis as { crypto?: unknown }).crypto !== 'undefined'},timestamp:Date.now()})}).catch(()=>{});
      console.log(JSON.stringify({sessionId:'d995f0',hypothesisId:'A',message:'randomUUID succeeded',enquiryIdPrefix:enquiryId.slice(0,8)}));
    } catch (cryptoErr) {
      fetch('http://127.0.0.1:7624/ingest/4a5b035c-2516-4325-be36-20d27c93f202',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'d995f0'},body:JSON.stringify({sessionId:'d995f0',runId:'post-fix',hypothesisId:'A',location:'contact-form-handler/index.ts:enquiryId',message:'randomUUID failed',data:{error:cryptoErr instanceof Error ? cryptoErr.message : String(cryptoErr)},timestamp:Date.now()})}).catch(()=>{});
      console.error(JSON.stringify({sessionId:'d995f0',hypothesisId:'A',message:'randomUUID failed',error:cryptoErr instanceof Error ? cryptoErr.message : String(cryptoErr)}));
      throw cryptoErr;
    }
    // #endregion
    const now = new Date().toISOString();

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
    console.log(`💾 Saving enquiry to DynamoDB: ${enquiryId}`);
    await saveEnquiry(enquiry);

    // Send confirmation email to user
    console.log(`📬 Sending confirmation email to: ${formData.email}`);
    await sendConfirmationEmail(formData.email, formData.name);

    // Send notification email to business
    console.log(`📬 Sending notification email to business`);
    await sendNotificationEmail(enquiry);

    return jsonResponse(200, {
      message: "✅ Enquiry received successfully",
      enquiryId,
    });
  } catch (error) {
    console.error("❌ Contact form handler failed:", error);
    return jsonResponse(500, {
      error: "Failed to process enquiry",
      details: error instanceof Error ? error.message : String(error),
    });
  }
};

// ============================================
// Email Functions
// ============================================

/**
 * Send confirmation email to customer
 */
async function sendConfirmationEmail(customerEmail: string, customerName: string): Promise<void> {
  const resendApiKey = await getResendApiKey();
  const resend = new Resend(resendApiKey);

  const emailHtml = `
    <h2>Thank you, ${customerName}!</h2>
    <p/>
    <p>We've received your wedding cake enquiry and will get back to you within 24 hours.</p>
    <p>In the meantime, feel free to check out our gallery for inspiration!</p>
    <p>Best regards,<br/>Kai Wedding Bakes</p>
  `;

  await resend.emails.send({
    from: "Opulence Wedding Bakes <onboarding@resend.dev>",
    to: customerEmail,
    subject: "We've received your enquiry - Opulence Wedding Bakes",
    html: emailHtml,
  });

  console.log(`✅ Confirmation email sent to ${customerEmail}`);
}

/**
 * Send notification email to business (from Secrets Manager)
 */
async function sendNotificationEmail(enquiry: DynamoEnquiry): Promise<void> {
  const resendApiKey = await getResendApiKey();
  const businessEmail = process.env.CONTACT_FORM_RECIPIENT_EMAIL || "opulenceweddingcakes@gmail.com";

  const resend = new Resend(resendApiKey);

  const emailHtml = `
    <h3>New enquiry</h3>
    <p><strong>Name:</strong> ${enquiry.name}</p>
    <p><strong>Email:</strong> ${enquiry.email}</p>
    <p><strong>Event Date:</strong> ${enquiry.eventDate}</p>
    <p><strong>Venue:</strong> ${enquiry.venue}</p>
    <p><strong>Message:</strong></p>
    <p>${enquiry.enquiry.replace(/\n/g, "<br/>")}</p>
    <hr/>
    <p><small>Enquiry ID: ${enquiry.enquiryId}</small></p>
    <p><small>Received: ${enquiry.createdAt}</small></p>
  `;

  await resend.emails.send({
    from: "Opulence Wedding Bakes <onboarding@resend.dev>",
    to: businessEmail,
    subject: `New Enquiry from ${enquiry.name}`,
    html: emailHtml,
  });

  console.log(`✅ Notification email sent to ${businessEmail}`);
}