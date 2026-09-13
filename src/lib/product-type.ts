/**
 * Converts a machine-readable productType (e.g. "wedding-cake")
 * into a user-facing label (e.g. "Wedding Cake").
 * Unknown values fall back to Title Case from kebab-case.
 */
export function formatProductTypeLabel(
  productType: string | undefined | null
): string {
  const normalized = productType?.trim().toLowerCase();

  if (!normalized) {
    return "Cake";
  }

  const knownLabels: Record<string, string> = {
    "wedding-cake": "Wedding Cake",
    "nikah-cake": "Nikkah Cake",
    cupcakes: "Cupcakes",
    "engagement-cake": "Engagement Cake",
  };

  if (knownLabels[normalized]) {
    return knownLabels[normalized];
  }

  return normalized
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Stable key for grouping; unknown/missing types share one bucket. */
export function getProductTypeKey(
  productType: string | undefined | null
): string {
  const normalized = productType?.trim().toLowerCase();
  return normalized || "other";
}
