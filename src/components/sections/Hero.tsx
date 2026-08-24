export function Hero() {
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

          <div className="h-96 min-h-96 overflow-hidden rounded-2xl bg-stone-200 md:h-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/hero.jpg"
              alt="Wedding cake with cascading sugar flowers"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
