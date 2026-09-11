"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Cake } from "@/types";
import { GalleryPostModal } from "@/components/gallery/GalleryPostModal";

type ProductCarouselProps = {
  label: string;
  items: Cake[];
};

export function ProductCarousel({ label, items }: ProductCarouselProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<Cake | null>(null);

  if (items.length === 0) {
    return null;
  }

  const scrollBy = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const amount = Math.min(el.clientWidth * 0.75, 360);
    el.scrollBy({ left: direction * amount, behavior: "smooth" });
  };

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <h2 className="text-2xl font-bold text-warm-brown md:text-3xl">
          {label}
        </h2>
        {items.length > 3 ? (
          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={() => scrollBy(-1)}
              aria-label={`Scroll ${label} gallery left`}
              className="flex h-9 w-9 items-center justify-center border border-taupe/30 text-warm-brown transition-colors hover:border-warm-brown hover:bg-warm-brown hover:text-cream"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => scrollBy(1)}
              aria-label={`Scroll ${label} gallery right`}
              className="flex h-9 w-9 items-center justify-center border border-taupe/30 text-warm-brown transition-colors hover:border-warm-brown hover:bg-warm-brown hover:text-cream"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
          </div>
        ) : null}
      </div>

      <div
        ref={scrollerRef}
        className="flex gap-5 overflow-x-auto scroll-smooth pb-2 [-ms-overflow-style:none] [scrollbar-width:none] snap-x snap-mandatory touch-pan-x md:gap-6 [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          if (!item.imageUrl) return null;

          const isCarousel =
            (item.imageUrls?.length ?? 0) > 1 ||
            item.mediaType === "CAROUSEL_ALBUM";

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setSelected(item)}
              className="group relative block h-64 w-44 shrink-0 snap-start overflow-hidden rounded-xl bg-stone-200 text-left sm:h-72 sm:w-52 md:h-80 md:w-56"
              aria-label={
                isCarousel
                  ? `Open ${label} carousel post`
                  : `Open ${label} post`
              }
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.imageUrl}
                alt={label}
                className="aspect-[3/4] h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                loading="lazy"
              />
            </button>
          );
        })}
      </div>

      {selected ? (
        <GalleryPostModal
          key={selected.id}
          item={selected}
          open
          onClose={() => setSelected(null)}
        />
      ) : null}
    </section>
  );
}
