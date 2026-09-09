import { Hero } from '@/components/sections/Hero';
import { GalleryGrid } from '@/components/sections/GalleryGrid';
import { ServicesSection } from '@/components/sections/ServicesSection';
import { CTASection } from '@/components/sections/CTASection';
import { mockServices } from '@/lib/mock-data';
import { getGalleryCakes } from '@/lib/gallery';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const cakes = await getGalleryCakes();

  return (
    <main className="min-h-screen bg-white">
      <Hero />
      <GalleryGrid cakes={cakes} />
      <ServicesSection services={mockServices} />
      <CTASection />
    </main>
  );
}
