export interface Cake {
  id: string;
  title: string;
  category: "wedding cake" | "nikkah cake" | "engagement cake" | "cupcakes";
  imageUrl: string;
  description: string;
  instagramUrl?: string;
  tags: string[];
  flavor?: string;
  servings?: number;
  /** Raw DynamoDB productType, e.g. "wedding-cake" */
  productType?: string;
  likes?: number;
  syncedAt?: string;
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
