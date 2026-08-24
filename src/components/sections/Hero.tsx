import Link from 'next/link';
import { Button } from '@/components/ui/Button';

export function Hero() {
  return (
    <section className="bg-white">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="relative flex h-96 items-center justify-center overflow-hidden bg-neutral-100">
          <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center px-6 text-center">
            <h1 className="text-4xl font-bold tracking-tight text-neutral-900 md:text-5xl">
              Wedding Cakes Made to Celebrate You
            </h1>
            <p className="mt-4 text-lg text-neutral-600 max-w-2xl">
              Beautiful, bespoke wedding cakes for every kind of celebration —
              from intimate nikkah ceremonies and engagements to the big day
              itself.
            </p>
            <div className="mt-8">
              <Link href="/gallery">
                <Button>See All Cakes</Button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
