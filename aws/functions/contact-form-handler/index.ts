import { Handler } from "aws-lambda";
import { Resend } from "resend";
import { v4 as uuidv4 } from "uuid";
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
  body: string;
}

// ============================================
// Lambda Handler
// ============================================

export const handler: Handler = async (event: any): Promise<HandlerResponse> => {
  console.log("📧 Contact form handler Lambda started");
  console.log("Event:", JSON.stringify(event, null, 2));

  try {
    // Parse request body
    const body = typeof event.body === "string" ? JSON.parse(event.body) : event.body;
    const formData: ContactFormPayload = body;

    // Validate required fields
    if (!formData.name || !formData.email || !formData.eventDate || !formData.venue || !formData.enquiry) {
      console.warn("❌ Missing required fields");
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing required fields" }),
      };
    }

    // Create enquiry record
    const enquiryId = uuidv4();
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

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "✅ Enquiry received successfully",
        enquiryId,
      }),
    };
  } catch (error) {
    console.error("❌ Contact form handler failed:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Failed to process enquiry",
        details: error instanceof Error ? error.message : String(error),
      }),
    };
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