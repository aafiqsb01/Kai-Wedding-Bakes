'use server';

import { ZodError } from 'zod';
import { contactFormSchema } from '@/lib/validations/contact';
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

  const lambdaUrl = process.env.AWS_LAMBDA_CONTACT_FORM_URL;

  if (!lambdaUrl) {
    console.error('AWS_LAMBDA_CONTACT_FORM_URL is not set');
    return {
      success: false as const,
      error: 'Failed to send enquiry. Please try again.',
    };
  }

  try {
    const response = await fetch(lambdaUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(formData),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Contact form Lambda error:', response.status, errorBody);
      return {
        success: false as const,
        error: 'Failed to send enquiry. Please try again.',
      };
    }

    return {
      success: true as const,
      message: 'Enquiry sent successfully!',
    };
  } catch (error) {
    console.error('submitContactForm Lambda error:', error);
    return {
      success: false as const,
      error: 'Failed to send enquiry. Please try again.',
    };
  }
}
