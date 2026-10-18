import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DynamoEnquiry } from "../../../aws/config/database";
import {
  confirmationEmailHtml,
  escapeHtml,
  notificationEmailHtml,
  processContactForm,
  validateContactEnquiry,
  type ContactFormDeps,
} from "../../../aws/functions/contact-form-handler/index";

const NOW = new Date("2026-10-18T12:00:00.000Z");
const ENQUIRY_ID = "enquiry-1";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    name: "Mary-Jane O'Brien",
    email: "mary@example.com",
    eventDate: "12 June 2027",
    venue: "The Hall",
    enquiry: "We would like a wedding cake.",
    ...overrides,
  };
}

function eventFor(body: unknown, method = "POST") {
  return {
    body: typeof body === "string" ? body : JSON.stringify(body),
    requestContext: { http: { method } },
  };
}

function harness() {
  const saved: DynamoEnquiry[] = [];
  const emails: Array<{ from: string; to: string; subject: string; html: string }> = [];
  const deps: ContactFormDeps = {
    saveEnquiry: async (enquiry) => {
      saved.push(enquiry);
    },
    sendEmail: async (message) => {
      emails.push(message);
    },
    now: () => NOW,
    createId: () => ENQUIRY_ID,
  };
  return { deps, saved, emails };
}

describe("validateContactEnquiry", () => {
  it("accepts a valid enquiry", () => {
    assert.deepEqual(validateContactEnquiry(validBody()), validBody());
  });

  it("rejects missing and incorrectly typed fields", () => {
    const body = validBody();
    assert.equal(validateContactEnquiry({ ...body, name: undefined }), null);
    assert.equal(validateContactEnquiry({ ...body, email: null }), null);
    assert.equal(validateContactEnquiry({ ...body, venue: 12 }), null);
    assert.equal(validateContactEnquiry({ ...body, enquiry: ["too", "short"] }), null);
    assert.equal(validateContactEnquiry(["not", "an", "object"]), null);
    assert.equal(validateContactEnquiry(null), null);
  });

  it("rejects an invalid email and values outside the website limits", () => {
    assert.equal(validateContactEnquiry(validBody({ email: "not-an-email" })), null);
    assert.equal(validateContactEnquiry(validBody({ email: "a@b.c" })), null);
    assert.equal(validateContactEnquiry(validBody({ name: "A" })), null);
    assert.equal(validateContactEnquiry(validBody({ name: `${"A".repeat(101)}` })), null);
    assert.equal(validateContactEnquiry(validBody({ name: "Mary1" })), null);
    assert.equal(validateContactEnquiry(validBody({ eventDate: " " })), null);
    assert.equal(validateContactEnquiry(validBody({ venue: "A" })), null);
    assert.equal(validateContactEnquiry(validBody({ enquiry: "too short" })), null);
    assert.equal(validateContactEnquiry(validBody({ enquiry: "e".repeat(1001) })), null);
  });

  it("accepts spaces, apostrophes and hyphens, and rejects control characters", () => {
    assert.deepEqual(
      validateContactEnquiry(validBody({ name: "Mary Jane" })),
      validBody({ name: "Mary Jane" })
    );
    assert.deepEqual(
      validateContactEnquiry(validBody({ name: "O'Brien" })),
      validBody({ name: "O'Brien" })
    );
    assert.deepEqual(
      validateContactEnquiry(validBody({ name: "Mary-Jane" })),
      validBody({ name: "Mary-Jane" })
    );
    assert.equal(validateContactEnquiry(validBody({ name: "Ann\nMarie" })), null);
    assert.equal(validateContactEnquiry(validBody({ name: "Ann\rMarie" })), null);
    assert.equal(validateContactEnquiry(validBody({ name: "Ann\tMarie" })), null);
  });

  it("accepts boundary lengths the website allows", () => {
    const enquiry = validBody({
      name: "Ab",
      email: "a@b.co",
      eventDate: "1",
      venue: "AB",
      enquiry: "e".repeat(10),
    });
    assert.deepEqual(validateContactEnquiry(enquiry), enquiry);
    assert.ok(validateContactEnquiry(validBody({ name: "A".repeat(100), enquiry: "e".repeat(1000) })));
  });
});

describe("escapeHtml", () => {
  it("escapes every HTML-sensitive character once", () => {
    assert.equal(escapeHtml(`& < > " '`), "&amp; &lt; &gt; &quot; &#39;");
    assert.equal(escapeHtml("&amp;"), "&amp;amp;");
  });
});

describe("notification email HTML", () => {
  it("escapes customer-supplied fields and keeps intentional line breaks", () => {
    const html = notificationEmailHtml({
      enquiryId: ENQUIRY_ID,
      name: `Tom & "Ann"`,
      email: "o'brien@example.com",
      eventDate: `<script>alert('date')</script>`,
      venue: `Hall <main> 'side'`,
      enquiry: `Hello <script>alert("x")</script> & friends\nnext line`,
      status: "new",
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
    });

    assert.match(html, /Tom &amp; &quot;Ann&quot;/);
    assert.match(html, /o&#39;brien@example\.com/);
    assert.match(html, /&lt;script&gt;alert\(&#39;date&#39;\)&lt;\/script&gt;/);
    assert.match(html, /Hall &lt;main&gt; &#39;side&#39;/);
    assert.match(html, /Hello &lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; friends<br\/>next line/);
    assert.equal(html.includes("<script>"), false);
    assert.match(html, new RegExp(`Enquiry ID: ${ENQUIRY_ID}`));
    assert.match(html, /<h3>New enquiry<\/h3>/);
  });
});

describe("processContactForm", () => {
  it("saves a valid enquiry and escapes both emails", async () => {
    const { deps, saved, emails } = harness();
    const response = await processContactForm(eventFor(validBody()), deps);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      message: "✅ Enquiry received successfully",
      enquiryId: ENQUIRY_ID,
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.name, "Mary-Jane O'Brien");
    assert.equal(saved[0]?.status, "new");
    assert.equal(emails.length, 2);
    assert.equal(emails[0]?.to, "mary@example.com");
    assert.equal(emails[0]?.html, confirmationEmailHtml("Mary-Jane O'Brien"));
    assert.match(emails[0]?.html ?? "", /Mary-Jane O&#39;Brien/);
    assert.equal(emails[1]?.subject, "New Enquiry from Mary-Jane O'Brien");
    assert.match(emails[1]?.html ?? "", /Mary-Jane O&#39;Brien/);
    assert.match(emails[1]?.html ?? "", /mary@example\.com/);
  });

  it("returns 400 and does not save malformed or invalid payloads", async () => {
    const { deps, saved, emails } = harness();

    const missing = await processContactForm(eventFor({ name: "Ada Lovelace" }), deps);
    const typed = await processContactForm(eventFor(validBody({ email: 1 })), deps);
    const malformed = await processContactForm(
      { body: "{", requestContext: { http: { method: "POST" } } },
      deps
    );
    const newlineName = await processContactForm(eventFor(validBody({ name: "Ann\nMarie" })), deps);

    assert.equal(missing.statusCode, 400);
    assert.equal(typed.statusCode, 400);
    assert.equal(malformed.statusCode, 400);
    assert.equal(newlineName.statusCode, 400);
    assert.deepEqual(JSON.parse(missing.body), { error: "Missing required fields" });
    assert.deepEqual(JSON.parse(newlineName.body), { error: "Missing required fields" });
    assert.equal(saved.length, 0);
    assert.equal(emails.length, 0);
  });

  it("keeps a saved enquiry when a later email fails", async () => {
    const { deps, saved, emails } = harness();
    deps.sendEmail = async (message) => {
      emails.push(message);
      if (emails.length === 1) throw new Error("provider rejected <script> secret-body");
    };

    const response = await processContactForm(
      eventFor(validBody({ enquiry: `<script>alert('x')</script> please` })),
      deps
    );

    assert.equal(response.statusCode, 500);
    assert.deepEqual(JSON.parse(response.body), { error: "Failed to process enquiry" });
    assert.equal(saved.length, 1);
    assert.equal(emails.length, 1);
    assert.equal(response.body.includes("secret-body"), false);
    assert.equal(response.body.includes("<script>"), false);
  });
});
