import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contactFormSchema } from "../../src/lib/validations/contact";

function validEnquiry(name: string) {
  return {
    name,
    email: "mary@example.com",
    eventDate: "12 June 2027",
    venue: "The Hall",
    enquiry: "We would like a wedding cake.",
  };
}

describe("contact name validation", () => {
  it("accepts letters, spaces, apostrophes and hyphens", () => {
    assert.equal(contactFormSchema.safeParse(validEnquiry("Mary Jane")).success, true);
    assert.equal(contactFormSchema.safeParse(validEnquiry("O'Brien")).success, true);
    assert.equal(contactFormSchema.safeParse(validEnquiry("Mary-Jane")).success, true);
    assert.equal(contactFormSchema.safeParse(validEnquiry("Mary-Jane O'Brien")).success, true);
  });

  it("rejects newlines, carriage returns and tabs", () => {
    for (const name of ["Ann\nMarie", "Ann\rMarie", "Ann\tMarie"]) {
      assert.equal(contactFormSchema.safeParse(validEnquiry(name)).success, false);
    }
  });
});
