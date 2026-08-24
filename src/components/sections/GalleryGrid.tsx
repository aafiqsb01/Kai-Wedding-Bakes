'use client';

import { Cake } from '@/types';
import { Card, CardImage, CardContent } from '@/components/ui/Card';

type GalleryGridProps = {
  cakes: Cake[];
};

export function GalleryGrid({ cakes }: GalleryGridProps) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <h2 className="mb-8 text-3xl font-bold text-neutral-900">
        Recent Commissions
      </h2>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {cakes.map((cake) => (
          <Card
            key={cake.id}
            className="cursor-pointer"
            onClick={() => console.log(cake.id)}
          >
            <CardImage src={cake.imageUrl} alt={cake.title} />
            <CardContent>
              <h3 className="text-xl font-semibold text-neutral-900">
                {cake.title}
              </h3>
              <p className="mt-2 text-sm text-neutral-600">{cake.description}</p>
              <p className="mt-3 text-xs text-neutral-500">
                {cake.tags.join(' ')}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
