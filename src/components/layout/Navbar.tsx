'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';

const textLinks = [
  { href: '/', label: 'Home' },
  { href: '/gallery', label: 'Gallery' },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  const linkClass = (href: string) =>
    `text-sm uppercase tracking-widest text-warm-brown transition-colors hover:text-dark-brown ${
      pathname === href ? 'underline underline-offset-4' : ''
    }`;

  return (
    <header className="sticky top-0 z-50 border-b border-taupe/20 bg-cream">
      <nav className="relative mx-auto flex h-16 max-w-7xl items-center justify-end px-6">
        <Link
          href="/"
          className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold uppercase text-warm-brown"
          onClick={() => setMobileOpen(false)}
        >
          OPULENCE
        </Link>

        <div className="hidden items-center gap-12 md:flex">
          {textLinks.map((link) => (
            <Link key={link.href} href={link.href} className={linkClass(link.href)}>
              {link.label}
            </Link>
          ))}
          <Link
            href="/contact"
            className="bg-warm-brown px-5 py-2 text-sm uppercase tracking-widest text-cream transition-colors hover:bg-dark-brown"
          >
            Contact
          </Link>
        </div>

        <button
          type="button"
          className="relative z-10 text-warm-brown md:hidden"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>

      {mobileOpen ? (
        <div className="border-t border-taupe/20 bg-cream md:hidden">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-4">
            {textLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={linkClass(link.href)}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
            <Link
              href="/contact"
              className="w-fit bg-warm-brown px-5 py-2 text-sm uppercase tracking-widest text-cream"
              onClick={() => setMobileOpen(false)}
            >
              Contact
            </Link>
          </div>
        </div>
      ) : null}
    </header>
  );
}
