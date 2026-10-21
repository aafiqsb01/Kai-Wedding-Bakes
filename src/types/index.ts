export interface Cake {
  id: string;
  title: string;
  category:
    | "wedding cake"
    | "celebratory cakes"
    | "nikkah cake"
    | "engagement cake"
    | "cupcakes"
    | "birthday cake"
    | "anniversary cake"
    | "other fun bakes";
  /** Cover / primary image (first carousel slide, or the only image). */
  imageUrl: string;
  /**
   * All images for this post. Present when the Dynamo item has a media[]
   * collection (carousels). Legacy single-image items omit this.
   */
  imageUrls?: string[];
  description: string;
  instagramUrl?: string;
  tags: string[];
  flavor?: string;
  servings?: number;
  /** Raw DynamoDB productType, e.g. "wedding-cake". Primary type for older readers. */
  productType?: string;
  /** Every category this post belongs to. Older rows omit this and use productType. */
  productTypes?: string[];
  likes?: number;
  syncedAt?: string;
  /** Original Instagram media timestamp (ISO). Prefer over syncedAt for ordering. */
  instagramTimestamp?: string;
  mediaType?: "IMAGE" | "CAROUSEL_ALBUM";
}

export interface Service {
  id: string;
  title: string;
  description: string;
}

export interface ContactFormData {
  name: string;
  email: string;
  eventDate: string;
  venue: string;
  enquiry: string;
}
