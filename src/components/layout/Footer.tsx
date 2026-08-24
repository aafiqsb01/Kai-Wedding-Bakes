export function Footer() {
  return (
    <footer className="border-t border-taupe/20 bg-cream">
      <div className="mx-auto flex max-w-7xl items-start justify-between px-6 py-12">
        <div>
          <p className="text-2xl font-semibold text-warm-brown">OPULENCE</p>
          <p className="mt-2 text-xs uppercase tracking-widest text-taupe">
            BESPOKE WEDDING CAKES & CUPCAKES
          </p>
        </div>

        <div className="text-right">
          <p className="mb-3 text-xs uppercase tracking-widest text-taupe">
            CONNECT
          </p>
          <a
            href="mailto:opulenceweddingcakes@gmail.com"
            className="block text-sm text-warm-brown transition hover:text-dark-brown"
          >
            opulenceweddingcakes@gmail.com
          </a>
          <a
            href="https://instagram.com/opulence_weddingcakes"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block text-sm text-warm-brown transition hover:text-dark-brown"
          >
            @opulence_wedding_cakes
          </a>
        </div>
      </div>
    </footer>
  );
}
