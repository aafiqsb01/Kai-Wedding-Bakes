export interface Cake {
  id: string;
  title: string;
  category: "wedding cake" | "nikkah cake" | "engagement cake" | "cupcakes";
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
  /** Raw DynamoDB productType, e.g. "wedding-cake" */
  productType?: string;
  likes?: number;
  syncedAt?: string;
  mediaType?: "IMAGE" | "CAROUSEL_ALBUM";
}

export interface Service {
  id: string;
  title: string;
  description: string;
  icon: string;
}

export interface ContactFormData {
  name: string;
  email: string;
  eventDate: string;
  venue: string;
  enquiry: string;
}
