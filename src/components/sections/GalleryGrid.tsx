'use client';

import Link from 'next/link';
import { Cake } from '@/types';
import { Card, CardImage, CardContent } from '@/components/ui/Card';

type GalleryGridProps = {
  cakes: Cake[];
};

export function GalleryGrid({ cakes }: GalleryGridProps) {
  return (
    <section className="bg-[#E8DFD6]">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-12 flex items-center justify-between">
          <h2 className="text-4xl font-bold text-warm-brown">
            Recent Commissions
          </h2>
          <Link
            href="/gallery"
            className="bg-black px-6 py-3 text-sm uppercase tracking-widest text-white transition-colors hover:bg-neutral-800"
          >
            SEE ALL CAKES
          </Link>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          {cakes.map((cake) => (
            <Card
              key={cake.id}
              className="cursor-pointer overflow-hidden rounded-2xl bg-white transition-shadow hover:shadow-md"
              onClick={() => console.log(cake.id)}
            >
              <CardImage
                src={cake.imageUrl}
                alt={cake.title}
                className="h-64 w-full object-cover"
              />
              <CardContent className="p-6">
                <h3 className="text-lg font-semibold text-warm-brown">
                  {cake.title}
                </h3>
                <p className="mt-2 text-sm text-taupe">{cake.description}</p>
                <p className="mt-3 text-xs text-taupe/60">
                  {cake.tags.join(' ')}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
}
