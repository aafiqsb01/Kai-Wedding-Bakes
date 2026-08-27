import { z } from 'zod';

export const contactFormSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(100)
    .regex(/^[a-zA-Z\s'-]+$/, {
      error: 'Name can only contain letters, spaces, hyphens, and apostrophes.',
    }),
  email: z.email({
    error: 'Please enter a valid email address.',
  }),
  eventDate: z
    .string()
    .min(1, 'Event date is required')
    .refine(
      (value) => {
        // Basic check: must have at least a month/year or full date
        return value.trim().length > 0;
      },
      'Please enter a valid event date',
    ),
  venue: z.string().min(2, {
    error: 'Venue name or location is required.',
  }),
  enquiry: z
    .string()
    .min(10, {
      error: 'Please tell us more about your enquiry (at least 10 characters).',
    })
    .max(1000),
});

export type ContactFormData = z.infer<typeof contactFormSchema>;
