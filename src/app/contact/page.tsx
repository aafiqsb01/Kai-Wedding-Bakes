'use client';

import { FormEvent, useState } from 'react';
import { Mail } from 'lucide-react';

const fieldClass =
  'w-full rounded-lg border border-taupe/30 bg-white p-4 text-warm-brown placeholder:text-taupe/50 focus:outline-none focus:ring-1 focus:ring-taupe/40';

function InstagramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  );
}

export default function ContactPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [weddingDate, setWeddingDate] = useState('');
  const [venue, setVenue] = useState('');
  const [vision, setVision] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const subject = encodeURIComponent(`Wedding cake inquiry from ${name || 'Guest'}`);
    const body = encodeURIComponent(
      [
        `Name: ${name}`,
        `Email: ${email}`,
        `Wedding date: ${weddingDate}`,
        `Venue: ${venue}`,
        '',
        'Vision:',
        vision,
      ].join('\n'),
    );

    window.location.href = `mailto:opulenceweddingcakes@gmail.com?subject=${subject}&body=${body}`;
  }

  return (
    <main className="min-h-[calc(100vh-80px)] bg-cream flex flex-col justify-center">
    <div className="mx-auto max-w-7xl px-6 py-16 md:py-20 w-full">
      <div className="grid grid-cols-1 items-start gap-16 md:grid-cols-2">
          <div>
            <h1 className="text-5xl font-bold text-warm-brown">
              Submit your booking inquiry
            </h1>
            <p className="mt-6 text-base leading-relaxed text-taupe">
              We accept a limited number of commissions each season. Share your
              date and vision and we will reply personally.
            </p>

            <div className="mt-8">
              <a
                href="mailto:opulenceweddingcakes@gmail.com"
                className="flex items-center gap-3 text-warm-brown transition hover:text-dark-brown"
              >
                <Mail size={20} aria-hidden />
                opulenceweddingcakes@gmail.com
              </a>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center gap-3 text-warm-brown transition hover:text-dark-brown"
              >
                <InstagramIcon size={20} />
                @opulence_wedding_cakes
              </a>
            </div>
          </div>

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl bg-[#E8DFD6] p-8 md:p-10"
          >
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="name" className="mb-2 block text-xs uppercase tracking-widest text-taupe">
                  NAME
                </label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your full name"
                  className={fieldClass}
                  required
                />
              </div>

              <div>
                <label htmlFor="email" className="mb-2 block text-xs uppercase tracking-widest text-taupe">
                  EMAIL
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className={fieldClass}
                  required
                />
              </div>

              <div>
                <label htmlFor="wedding-date" className="mb-2 block text-xs uppercase tracking-widest text-taupe">
                  WEDDING DATE
                </label>
                <input
                  id="wedding-date"
                  type="text"
                  value={weddingDate}
                  onChange={(e) => setWeddingDate(e.target.value)}
                  placeholder="e.g. 12 June 2027"
                  className={fieldClass}
                />
              </div>

              <div>
                <label htmlFor="venue" className="mb-2 block text-xs uppercase tracking-widest text-taupe">
                  VENUE
                </label>
                <input
                  id="venue"
                  type="text"
                  value={venue}
                  onChange={(e) => setVenue(e.target.value)}
                  placeholder="Venue or location"
                  className={fieldClass}
                />
              </div>
            </div>

            <div className="mt-6">
              <label htmlFor="vision" className="mb-2 block text-xs uppercase tracking-widest text-taupe">
                YOUR VISION
              </label>
              <textarea
                id="vision"
                value={vision}
                onChange={(e) => setVision(e.target.value)}
                placeholder="Guest numbers, styling, colours, flavours..."
                rows={5}
                className={`${fieldClass} resize-y`}
              />
            </div>

            <button
              type="submit"
              className="mt-8 rounded-none bg-dark-brown px-6 py-3 text-sm uppercase tracking-wider text-white transition hover:bg-warm-brown"
            >
              SEND INQUIRY
            </button>

            <p className="mt-4 text-sm text-taupe">
              This opens your email app with the details ready to send.
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
