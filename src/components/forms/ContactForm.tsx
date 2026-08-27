'use client';

import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { contactFormSchema } from '@/lib/validations/contact';
import type { ContactFormData } from '@/types';
import { submitContactForm } from '@/app/actions/contact';
import { Button } from '@/components/ui/Button';

const fieldClass =
  'w-full rounded-lg border border-taupe/30 bg-white p-4 text-warm-brown placeholder:text-taupe/50 focus:outline-none focus:ring-1 focus:ring-taupe/40';

const labelClass =
  'mb-2 block text-xs uppercase tracking-widest text-taupe';

export function ContactForm() {
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    mode: 'onBlur',
    defaultValues: {
      name: '',
      email: '',
      eventDate: '',
      venue: '',
      enquiry: '',
    },
  });

  function onSubmit(data: ContactFormData) {
    setStatusMessage(null);

    startTransition(async () => {
      const result = await submitContactForm(data);

      if (result.success) {
        reset();
        setStatusMessage({
          type: 'success',
          text: result.message,
        });
        return;
      }

      if ('error' in result && result.error) {
        setStatusMessage({
          type: 'error',
          text: result.error,
        });
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="rounded-2xl bg-[#E8DFD6] p-8 md:p-10"
      noValidate
    >
      {statusMessage ? (
        <p
          className={`mb-6 text-sm font-medium ${
            statusMessage.type === 'success'
              ? 'text-warm-brown'
              : 'text-red-600'
          }`}
          role="status"
        >
          {statusMessage.text}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="name" className={labelClass}>
            NAME
          </label>
          <input
            id="name"
            type="text"
            placeholder="Your full name"
            className={fieldClass}
            {...register('name')}
          />
          {errors.name && (
            <p className="mt-1 text-xs text-red-600">{errors.name?.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            EMAIL
          </label>
          <input
            id="email"
            type="email"
            placeholder="you@example.com"
            className={fieldClass}
            {...register('email')}
          />
          {errors.email && (
            <p className="mt-1 text-xs text-red-600">{errors.email?.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="eventDate" className={labelClass}>
            EVENT DATE
          </label>
          <input
            id="eventDate"
            type="text"
            placeholder="e.g. 12 June 2027"
            className={fieldClass}
            {...register('eventDate')}
          />
          {errors.eventDate && (
            <p className="mt-1 text-xs text-red-600">
              {errors.eventDate.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="venue" className={labelClass}>
            VENUE
          </label>
          <input
            id="venue"
            type="text"
            placeholder="Venue or location"
            className={fieldClass}
            {...register('venue')}
          />
          {errors.venue && (
            <p className="mt-1 text-xs text-red-600">{errors.venue?.message}</p>
          )}
        </div>
      </div>

      <div className="mt-6">
        <label htmlFor="enquiry" className={labelClass}>
          YOUR INQUIRY
        </label>
        <textarea
          id="enquiry"
          rows={5}
          placeholder="Guest numbers, styling, colours, flavours..."
          className={`${fieldClass} resize-y`}
          {...register('enquiry')}
        />
        {errors.enquiry && (
          <p className="mt-1 text-xs text-red-600">{errors.enquiry?.message}</p>
        )}
      </div>

      <Button
        type="submit"
        disabled={isPending}
        className="mt-8 bg-dark-brown px-6 py-3 text-sm uppercase tracking-wider text-white rounded-none hover:bg-warm-brown disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'Sending...' : 'SEND INQUIRY'}
      </Button>
    </form>
  );
}
