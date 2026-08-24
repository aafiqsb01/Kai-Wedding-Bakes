export interface Cake {
    id: string;
    title: string;
    category: 'wedding cake' | 'nikkah cake' | 'engagement cake' | 'cupcakes';
    imageUrl: string;
    description: string;
    instagramUrl?: string;
    tags: string[];
    flavor?: string;
    servings?: number;
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
    phone: string;
    eventDate: string;
    // guestCount: number;
    message: string;
  }