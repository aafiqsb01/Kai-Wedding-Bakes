"use client";

import { useEffect, useId, useState, type MouseEvent } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import type { Cake } from "@/types";

type GalleryPostModalProps = {
  item: Cake;
  open: boolean;
  onClose: () => void;
};

function getSlideUrls(item: Cake): string[] {
  if (item.imageUrls && item.imageUrls.length > 0) {
    return item.imageUrls;
  }
  return item.imageUrl ? [item.imageUrl] : [];
}

export function GalleryPostModal({ item, open, onClose }: GalleryPostModalProps) {
  const titleId = useId();
  const slides = getSlideUrls(item);
  const isCarousel = slides.length > 1;
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (!isCarousel) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => (current - 1 + slides.length) % slides.length);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        setIndex((current) => (current + 1) % slides.length);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, isCarousel, slides.length]);

  if (!open || slides.length === 0) {
    return null;
  }

  const safeIndex = ((index % slides.length) + slides.length) % slides.length;
  const currentSrc = slides[safeIndex];

  const goPrev = (event: MouseEvent) => {
    event.stopPropagation();
    setIndex((current) => (current - 1 + slides.length) % slides.length);
  };

  const goNext = (event: MouseEvent) => {
    event.stopPropagation();
    setIndex((current) => (current + 1) % slides.length);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-dark-brown/70 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-3xl flex-col gap-3"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close gallery post"
          className="absolute -top-10 right-0 flex h-9 w-9 items-center justify-center text-cream transition-opacity hover:opacity-80 sm:-top-11"
        >
          <X size={22} aria-hidden />
        </button>

        <h2 id={titleId} className="sr-only">
          {item.title}
        </h2>

        <div className="relative overflow-hidden rounded-xl bg-stone-200 shadow-lg">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentSrc}
            alt={item.description || item.title}
            className="mx-auto max-h-[75vh] w-full object-contain"
          />

          {isCarousel ? (
            <>
              <button
                type="button"
                onClick={goPrev}
                aria-label="Previous image"
                className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-taupe/40 bg-cream/90 text-warm-brown transition-colors hover:border-warm-brown hover:bg-warm-brown hover:text-cream sm:left-3"
              >
                <ChevronLeft size={20} aria-hidden />
              </button>
              <button
                type="button"
                onClick={goNext}
                aria-label="Next image"
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center border border-taupe/40 bg-cream/90 text-warm-brown transition-colors hover:border-warm-brown hover:bg-warm-brown hover:text-cream sm:right-3"
              >
                <ChevronRight size={20} aria-hidden />
              </button>
            </>
          ) : null}
        </div>

        {isCarousel ? (
          <p
            className="text-center text-sm tracking-wide text-black"
            aria-live="polite"
          >
            {safeIndex + 1} / {slides.length}
          </p>
        ) : null}

        {item.instagramUrl ? (
          <a
            href={item.instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-center text-xs uppercase tracking-[0.18em] text-black transition-colors hover:text-black/80"
            onClick={(event) => event.stopPropagation()}
          >
            View on Instagram
          </a>
        ) : null}
      </div>
    </div>
  );
}
