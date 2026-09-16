import type { Cake } from "@/types";
import {
  formatProductTypeLabel,
  getProductTypeKey,
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

/** Group cakes by productType (missing → "other"). */
export function groupByProductType(cakes: Cake[]): Map<string, Cake[]> {
  const groups = new Map<string, Cake[]>();

  for (const cake of cakes) {
    const key = getProductTypeKey(cake.productType);
    const existing = groups.get(key);
    if (existing) {
      existing.push(cake);
    } else {
      groups.set(key, [cake]);
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
 * each sorted by instagramTimestamp (fallback: syncedAt) desc
 * and capped at the latest N posts.
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
      items: sorted.slice(0, limitPerType),
    });
  }

  // Most recently active product types first
  sections.sort((a, b) => {
    const aLatest = sortTimestampOf(a.items[0]!);
    const bLatest = sortTimestampOf(b.items[0]!);
    return bLatest.localeCompare(aLatest);
  });

  return sections;
}

/**
 * One most-liked item per product type, then take up to `limit`
 * product types ranked by likes.
 */
export function getFeaturedCommissions(
  cakes: Cake[],
  limit: number = FEATURED_COMMISSIONS_LIMIT
): Cake[] {
  const bestByType = new Map<string, Cake>();

  for (const cake of cakes) {
    if (!cake.imageUrl) continue;

    const key = getProductTypeKey(cake.productType);
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

  return Array.from(bestByType.values())
    .sort((a, b) => {
      const byLikes = likesOf(b) - likesOf(a);
      if (byLikes !== 0) return byLikes;
      return sortTimestampOf(b).localeCompare(sortTimestampOf(a));
    })
    .slice(0, limit);
}
