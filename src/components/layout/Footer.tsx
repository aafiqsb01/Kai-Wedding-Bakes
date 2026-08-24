export function Footer() {
  return (
    <footer className="mt-auto border-t border-neutral-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <p className="text-sm text-neutral-500">
          © {new Date().getFullYear()} Kai Wedding Bakes
        </p>
      </div>
    </footer>
  );
}
