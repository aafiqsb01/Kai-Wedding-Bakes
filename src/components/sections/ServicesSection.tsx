import { Service } from '@/types';

type ServicesSectionProps = {
  services: Service[];
};

export function ServicesSection({ services }: ServicesSectionProps) {
  return (
    <>
      <section className="bg-stone-50">
        <div className="mx-auto max-w-7xl px-6 py-20">
          <div className="grid grid-cols-1 gap-16 md:grid-cols-3">
            {services.map((service) => (
              <div
                key={service.id}
                className="text-left md:border-r md:border-r-taupe/30 md:pr-8 md:last:border-r-0"
              >
                <h3 className="text-lg font-semibold text-warm-brown">
                  {service.title}
                </h3>
                <p className="mt-4 text-sm leading-relaxed text-taupe">
                  {service.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-cream">
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <p className="mb-6 text-xs uppercase tracking-widest text-taupe">
            CAKES FOR EVERY CELEBRATION
          </p>
          <h2 className="mb-8 text-5xl font-bold text-warm-brown">
            Grand Cakes, Small Weddings, and Everything In Between
          </h2>
          <p className="text-base leading-relaxed text-taupe">
            We offer dummy layers so you can have a tall, show-stopping cake
            without the cost of feeding hundreds — perfect for smaller weddings.
            We also create nikkah cakes, engagement cakes, and cupcakes in all
            flavours, made to match your celebration.
          </p>
        </div>
      </section>
    </>
  );
}
