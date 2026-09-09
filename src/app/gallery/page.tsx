import { ProductCarousel } from "@/components/gallery/ProductCarousel";
import { getGalleryCakes } from "@/lib/gallery";
import { getGallerySections } from "@/lib/gallery-helpers";

export const dynamic = "force-dynamic";

export default async function GalleryPage() {
  const cakes = await getGalleryCakes();
  const sections = getGallerySections(cakes);

  return (
    <main className="min-h-screen bg-[#E8DFD6]">
      <div className="mx-auto max-w-7xl px-6 py-20 md:py-24">
        <header className="mb-16 max-w-2xl">
          <h1 className="text-4xl font-bold text-warm-brown md:text-5xl">
            Gallery
          </h1>
          <p className="mt-4 text-base leading-relaxed text-taupe md:text-lg">
            A selection of recent commissions, organised by cake type.
          </p>
        </header>

        {sections.length === 0 ? (
          <p className="text-base text-taupe">
            Gallery images will appear here once commissions are available.
          </p>
        ) : (
          <div className="flex flex-col gap-16 md:gap-20">
            {sections.map((section) => (
              <ProductCarousel
                key={section.productType}
                label={section.label}
                items={section.items}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
