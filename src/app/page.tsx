import { Hero } from "@/components/sections/Hero";
import { FeaturedCommissions } from "@/components/sections/FeaturedCommissions";
import { ServicesSection } from "@/components/sections/ServicesSection";
import { CTASection } from "@/components/sections/CTASection";
import { mockServices } from "@/lib/mock-data";
import { getGalleryCakes } from "@/lib/gallery";
import { getFeaturedCommissions } from "@/lib/gallery-helpers";

/** Stable selection for homepage Hero — Instagram post / DynamoDB photoId. */
const HERO_INSTAGRAM_URL = "https://www.instagram.com/p/DZ470nNNvtA/";
const HERO_PHOTO_ID = "18115033318738404";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cakes = await getGalleryCakes();
  const featured = getFeaturedCommissions(cakes);
  const heroCake =
    cakes.find((cake) => cake.instagramUrl === HERO_INSTAGRAM_URL) ??
    cakes.find((cake) => cake.id === HERO_PHOTO_ID);

  return (
    <main className="min-h-screen bg-white">
      <Hero imageUrl={heroCake?.imageUrl} />
      <FeaturedCommissions cakes={featured} />
      <ServicesSection services={mockServices} />
      <CTASection />
    </main>
  );
}
