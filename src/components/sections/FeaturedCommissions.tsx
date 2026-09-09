import Link from "next/link";
import type { Cake } from "@/types";
import { formatProductTypeLabel } from "@/lib/product-type";
import { cn } from "@/lib/utils";

type FeaturedCommissionsProps = {
  cakes: Cake[];
};

export function FeaturedCommissions({ cakes }: FeaturedCommissionsProps) {
  if (cakes.length === 0) {
    return null;
  }

  return (
    <section className="bg-[#E8DFD6]">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="mb-14 flex items-baseline justify-between gap-6">
          <h2 className="text-4xl font-bold text-warm-brown md:text-5xl">
            Recent Commissions
          </h2>
          <Link
            href="/gallery"
            className="shrink-0 text-xs uppercase tracking-[0.2em] text-warm-brown transition-colors hover:text-dark-brown"
          >
            SEE ALL CAKES
          </Link>
        </div>

        {/* Mobile / tablet: touch-friendly horizontal scroll with offset rhythm */}
        <div className="flex gap-5 overflow-x-auto pb-4 pt-6 [-ms-overflow-style:none] [scrollbar-width:none] snap-x snap-mandatory touch-pan-x lg:hidden [&::-webkit-scrollbar]:hidden">
          {cakes.map((cake, index) => (
            <FeaturedItem
              key={cake.id}
              cake={cake}
              offset={index % 2 === 0 ? "down" : "up"}
              className="w-44 shrink-0 snap-start sm:w-48"
            />
          ))}
        </div>

        {/* Desktop: five-across editorial composition with alternating offsets */}
        <div
          className={cn(
            "hidden items-start pb-10 pt-10 lg:flex",
            cakes.length >= 5
              ? "justify-between gap-4 xl:gap-6"
              : "justify-center gap-8 xl:gap-10"
          )}
        >
          {cakes.map((cake, index) => (
            <FeaturedItem
              key={cake.id}
              cake={cake}
              offset={index % 2 === 0 ? "down" : "up"}
              className={
                cakes.length >= 5
                  ? "max-w-[13rem] flex-1"
                  : "w-[12.5rem] shrink-0"
              }
            />
          ))}
        </div>
      </div>
    </section>
  );
}

type FeaturedItemProps = {
  cake: Cake;
  offset: "up" | "down";
  className?: string;
};

function FeaturedItem({ cake, offset, className }: FeaturedItemProps) {
  const label = formatProductTypeLabel(cake.productType);
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={cake.imageUrl}
      alt={label}
      className="aspect-[3/4] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
      loading="lazy"
    />
  );

  const content = (
    <>
      <div className="overflow-hidden rounded-xl bg-stone-200 shadow-sm">
        {image}
      </div>
      <p className="mt-4 text-center text-sm font-medium text-warm-brown md:text-base">
        {label}
      </p>
    </>
  );

  const offsetClass =
    offset === "down" ? "translate-y-5 md:translate-y-8" : "-translate-y-2 md:-translate-y-4";

  if (cake.instagramUrl) {
    return (
      <a
        href={cake.instagramUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "group block transition-transform duration-300",
          offsetClass,
          className
        )}
      >
        {content}
      </a>
    );
  }

  return (
    <div className={cn("group block", offsetClass, className)}>{content}</div>
  );
}
