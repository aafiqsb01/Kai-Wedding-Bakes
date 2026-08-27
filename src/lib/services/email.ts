import React from 'react';
import { Resend } from 'resend';
import { ContactEnquiryEmail } from '@/lib/templates/emails/ContactEnquiry';
import type { ContactFormData } from '@/types';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendContactEnquiry(data: ContactFormData) {
  console.log(
    'RESEND_API_KEY:',
    process.env.RESEND_API_KEY ? 'set' : 'not set',
  );

  const from = 'onboarding@resend.dev';
  const to = 'opulenceweddingcakes@gmail.com';
  const subject = `New event enquiry from ${data.name}`;

  console.log('Sending email with:', { from, to, subject });

  try {
    const { data: response, error } = await resend.emails.send({
      from,
      to,
      subject,
      react: React.createElement(ContactEnquiryEmail, {
        name: data.name,
        email: data.email,
        eventDate: data.eventDate,
        venue: data.venue,
        enquiry: data.enquiry,
      }),
    });

    if (error) {
      console.error('Email send failed:', error);
      return {
        success: false as const,
        error: error.message || 'Email service error',
      };
    }

    console.log('Resend response:', response);
    return { success: true as const, data: response };
  } catch (error) {
    console.error('Email send failed:', error);
    return {
      success: false as const,
      error:
        error instanceof Error ? error.message : 'Email service error',
    };
  }
}
