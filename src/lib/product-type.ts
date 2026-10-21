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
    cupcakes: "Cupcakes",
    "celebratory-cakes": "Celebratory Cakes",
    "other-fun-bakes": "Other Fun Bakes",
    // Legacy types still stored until gallery reclassification is applied.
    "nikah-cake": "Nikkah Cake",
    "engagement-cake": "Engagement Cake",
    "birthday-cake": "Birthday Cake",
    "anniversary-cake": "Anniversary Cake",
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

/**
 * Categories a gallery post belongs to.
 * Uses productTypes when the row has been given a set, otherwise the single productType.
 * Duplicate entries are dropped so a post appears once in each category.
 */
export function membershipOf(cake: {
  productType?: string | null;
  productTypes?: readonly (string | null | undefined)[] | null;
}): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  const listed = cake.productTypes ?? [];
  for (const value of listed) {
    const key = value?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  if (keys.length > 0) return keys;
  const fallback = cake.productType?.trim();
  if (!fallback) return [];
  return [getProductTypeKey(fallback)];
}
