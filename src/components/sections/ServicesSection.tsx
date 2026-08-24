import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Service } from '@/types';

type ServicesSectionProps = {
  services: Service[];
};

function getIcon(name: string): LucideIcon | null {
  const icon = LucideIcons[name as keyof typeof LucideIcons];
  if (typeof icon === 'function' || (typeof icon === 'object' && icon !== null)) {
    return icon as LucideIcon;
  }
  return null;
}

export function ServicesSection({ services }: ServicesSectionProps) {
  return (
    <section className="mx-auto max-w-7xl px-4 py-16">
      <h2 className="mb-4 text-3xl font-bold text-neutral-900">
        Cakes for Every Celebration
      </h2>
      <p className="mb-12 text-lg text-neutral-600">
        Grand Cakes, Small Weddings, and Everything In Between
      </p>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        {services.map((service) => {
          const Icon = getIcon(service.icon);

          return (
            <div key={service.id} className="border-t-2 border-neutral-200 pt-6">
              {Icon ? (
                <Icon size={32} className="text-neutral-900" aria-hidden />
              ) : null}
              <h3 className="mt-4 text-xl font-semibold text-neutral-900">
                {service.title}
              </h3>
              <p className="mt-3 text-sm text-neutral-600">
                {service.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
