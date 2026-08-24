import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export function CTASection() {
  return (
    <section className="bg-stone-50 py-24">
      <div className="mx-auto max-w-2xl rounded-2xl bg-cream px-12 py-20 text-center shadow-sm">
        <h2 className="mb-6 text-5xl font-bold text-warm-brown">
          Start Your Cake Design
        </h2>
        <p className="mb-8 text-base leading-relaxed text-taupe">
          Tell us about your wedding, your ideas, and your budget. We will help
          you create a cake that looks amazing and tastes even better.
        </p>
        <Link href="/contact">
          <Button className="rounded-none bg-warm-brown px-6 py-3 text-sm uppercase tracking-wider text-white transition hover:bg-dark-brown">
            GET IN TOUCH →
          </Button>
        </Link>
      </div>
    </section>
  );
}
