import { Hero } from '@/components/sections/Hero';
import { GalleryGrid } from '@/components/sections/GalleryGrid';
import { ServicesSection } from '@/components/sections/ServicesSection';
import { CTASection } from '@/components/sections/CTASection';
import { mockCakes, mockServices } from '@/lib/mock-data';

export default function Home() {
  return (
    <main className="min-h-screen bg-white">
      <Hero />
      <GalleryGrid cakes={mockCakes} />
      <ServicesSection services={mockServices} />
      <CTASection />
    </main>
  );
}
