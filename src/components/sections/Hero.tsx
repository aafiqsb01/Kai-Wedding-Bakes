type HeroProps = {
  imageUrl?: string;
};

export function Hero({ imageUrl }: HeroProps) {
  const src =
    imageUrl?.trim() || "/images/hero.jpg";

  return (
    <section className="bg-cream py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="grid grid-cols-1 items-center gap-12 md:grid-cols-2">
          <div className="text-left">
            <h1 className="text-5xl font-bold leading-tight text-warm-brown md:text-6xl">
              Wedding Cakes Made to Celebrate You
            </h1>
            <p className="mt-6 max-w-lg text-base text-taupe md:text-lg">
              Beautiful, bespoke wedding cakes for every kind of celebration —
              from intimate nikkah ceremonies and engagements to the big day
              itself.
            </p>
          </div>

          <div className="flex justify-center md:justify-end md:items-center">
            <div className="w-[68%] max-w-sm sm:max-w-md md:max-w-[22rem]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt="White wedding cake with cascading red roses"
                className="block h-auto w-full rounded-2xl object-contain"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
