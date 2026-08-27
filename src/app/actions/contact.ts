'use server';

import { ZodError } from 'zod';
import { contactFormSchema } from '@/lib/validations/contact';
import { sendContactEnquiry } from '@/lib/services/email';
import type { ContactFormData } from '@/types';

export async function submitContactForm(formData: ContactFormData) {
  try {
    contactFormSchema.parse(formData);
  } catch (error) {
    if (error instanceof ZodError) {
      return { success: false as const, errors: error.flatten() };
    }
    return {
      success: false as const,
      error: 'Failed to send enquiry. Please try again.',
    };
  }

  try {
    const result = await sendContactEnquiry(formData);

    if (!result.success) {
      return {
        success: false as const,
        error: result.error || 'Failed to send enquiry. Please try again.',
      };
    }

    return {
      success: true as const,
      message: 'Enquiry sent successfully!',
    };
  } catch (error) {
    console.error('submitContactForm email error:', error);
    return {
      success: false as const,
      error: 'Failed to send enquiry. Please try again.',
    };
  }
}
