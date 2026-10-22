import type { Cake } from "@/types";
import {
  formatProductTypeLabel,
  getProductTypeKey,
  membershipOf,
} from "@/lib/product-type";

export const GALLERY_CAROUSEL_LIMIT = 12;
export const FEATURED_COMMISSIONS_LIMIT = 5;

function likesOf(cake: Cake): number {
  return cake.likes ?? 0;
}

/** Prefer Instagram post time; fall back to sync time for legacy records. */
function sortTimestampOf(cake: Cake): string {
  return cake.instagramTimestamp ?? cake.syncedAt ?? "";
}

function isNewer(a: Cake, b: Cake): boolean {
  return sortTimestampOf(a) > sortTimestampOf(b);
}

/**
 * Last single-category hashtag dictionary (exact token, first match wins).
 * Plural and compound tags such as birthdaycakes are not entries.
 */
const LEGACY_HASHTAG_TO_PRODUCT_TYPE: Record<string, string> = {
  weddingcake: "wedding-cake",
  "wedding-cake": "wedding-cake",
  nikahcake: "nikah-cake",
  nikkahcake: "nikah-cake",
  "nikah-cake": "nikah-cake",
  "nikkah-cake": "nikah-cake",
  cupcakes: "cupcakes",
  engagement: "engagement-cake",
  engagementcake: "engagement-cake",
  birthdaycake: "birthday-cake",
  "birthday-cake": "birthday-cake",
  anniversarycake: "anniversary-cake",
  "anniversary-cake": "anniversary-cake",
};

const RECENT_COMMISSION_OCCASIONS = new Set([
  "birthday-cake",
  "anniversary-cake",
  "nikah-cake",
]);

/** First recognised legacy hashtag in a caption. Unrecognised captions return null. */
function firstLegacyProductType(caption: string): string | null {
  const tags = caption.match(/#[\w-]+/g);
  if (!tags) return null;

  for (const tag of tags) {
    const productType = LEGACY_HASHTAG_TO_PRODUCT_TYPE[tag.slice(1).toLowerCase()];
    if (productType) return productType;
  }

  return null;
}

/**
 * Recent Commissions category. Celebratory posts recover birthday, anniversary,
 * or nikkah when that is the caption's first exact legacy hashtag.
 */
function featuredProductType(cake: Cake): string {
  const stored = getProductTypeKey(cake.productType);
  if (stored !== "celebratory-cakes") return stored;

  const legacy = firstLegacyProductType(cake.description);
  if (legacy && RECENT_COMMISSION_OCCASIONS.has(legacy)) return legacy;
  return stored;
}

/** Group cakes by every product type they belong to. A post is added once per type. */
export function groupByProductType(cakes: Cake[]): Map<string, Cake[]> {
  const groups = new Map<string, Cake[]>();

  for (const cake of cakes) {
    for (const key of membershipOf(cake)) {
      const existing = groups.get(key);
      if (existing) {
        if (existing.some((item) => item.id === cake.id)) continue;
        existing.push(cake);
      } else {
        groups.set(key, [cake]);
      }
    }
  }

  return groups;
}

export type GallerySection = {
  productType: string;
  label: string;
  items: Cake[];
};

/**
 * Build gallery page sections: one carousel per product type,
 * ordered by how many gallery items belong to that type (highest first).
 * Equal counts keep the previous order: most recently active type first.
 * Items inside a section stay sorted by instagramTimestamp (fallback: syncedAt)
 * desc and are capped at the latest N posts. Types with no items are omitted.
 */
export function getGallerySections(
  cakes: Cake[],
  limitPerType: number = GALLERY_CAROUSEL_LIMIT
): GallerySection[] {
  const groups = groupByProductType(cakes);

  const sections: GallerySection[] = [];

  for (const [productType, items] of groups) {
    if (items.length === 0) continue;

    const sorted = [...items].sort((a, b) => {
      const byDate = sortTimestampOf(b).localeCompare(sortTimestampOf(a));
      if (byDate !== 0) return byDate;
      return likesOf(b) - likesOf(a);
    });

    sections.push({
      productType,
      label: formatProductTypeLabel(
        productType === "other" ? undefined : productType
      ),
      items: sorted,
    });
  }

  sections.sort((a, b) => {
    const byCount = b.items.length - a.items.length;
    if (byCount !== 0) return byCount;
    const aLatest = sortTimestampOf(a.items[0]!);
    const bLatest = sortTimestampOf(b.items[0]!);
    return bLatest.localeCompare(aLatest);
  });

  return sections.map((section) => ({
    ...section,
    items: section.items.slice(0, limitPerType),
  }));
}

/**
 * Recent Commissions only. One most-liked item per category, then up to
 * `limit` categories ranked by likes. Celebratory posts can recover a legacy
 * occasion from the caption. Other posts keep their singular productType.
 */
export function getFeaturedCommissions(
  cakes: Cake[],
  limit: number = FEATURED_COMMISSIONS_LIMIT
): Cake[] {
  const bestByType = new Map<string, Cake>();

  for (const cake of cakes) {
    if (!cake.imageUrl) continue;

    const key = featuredProductType(cake);
    const current = bestByType.get(key);

    if (!current) {
      bestByType.set(key, cake);
      continue;
    }

    const cakeLikes = likesOf(cake);
    const currentLikes = likesOf(current);

    if (
      cakeLikes > currentLikes ||
      (cakeLikes === currentLikes && isNewer(cake, current))
    ) {
      bestByType.set(key, cake);
    }
  }

  return Array.from(bestByType.entries())
    .sort(([, a], [, b]) => {
      const byLikes = likesOf(b) - likesOf(a);
      if (byLikes !== 0) return byLikes;
      return sortTimestampOf(b).localeCompare(sortTimestampOf(a));
    })
    .slice(0, limit)
    .map(([productType, cake]) =>
      getProductTypeKey(cake.productType) === productType
        ? cake
        : { ...cake, productType }
    );
}
