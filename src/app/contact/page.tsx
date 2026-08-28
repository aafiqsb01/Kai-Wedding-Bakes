import { Mail } from 'lucide-react';
import { ContactForm } from '@/components/forms/ContactForm';

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
  return (
    <main className="flex min-h-[calc(100vh-80px)] flex-col justify-center bg-cream">
      <div className="mx-auto w-full max-w-7xl px-6 py-16 md:py-20">
        <div className="grid grid-cols-1 items-start gap-16 md:grid-cols-2">
          <div>
            <h1 className="text-5xl font-bold text-warm-brown">
              Submit your booking enquiry
            </h1>
            <p className="mt-6 text-base leading-relaxed text-taupe">
              We accept a limited number of commissions each season. <br/>
              Share your date and vision and we will reply personally.
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

          <ContactForm />
        </div>
      </div>
    </main>
  );
}
