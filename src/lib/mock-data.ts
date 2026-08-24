import { Cake, Service } from '@/types';

export const mockCakes: Cake[] = [
  {
    id: '1',
    title: 'The Versailles Lace',
    category: 'wedding cake',
    imageUrl: '/images/cake-lace.jpg',
    description: 'Close up of intricate white lace-pattern icing on a wedding cake',
    tags: ['#elegant', '#lace', '#classic'],
    flavor: 'Vanilla & raspberry',
    servings: 80,
  },
  {
    id: '2',
    title: 'Gilded Texture',
    category: 'wedding cake',
    imageUrl: '/images/cake-gilded.jpg',
    description: 'Modern textured wedding cake with gold leaf accents',
    tags: ['#modern', '#gold', '#texture'],
    flavor: 'Chocolate & caramel',
    servings: 100,
  },
  {
    id: '3',
    title: 'Orchid Minimalist',
    category: 'wedding cake',
    imageUrl: '/images/cake-orchid.jpg',
    description: 'Minimalist wedding cake with fresh wild orchids',
    tags: ['#minimal', '#floral', '#fresh'],
    flavor: 'Lemon & elderflower',
    servings: 60,
  },
  {
    id: '4',
    title: 'Nikkah Elegance',
    category: 'nikkah cake',
    imageUrl: '/images/cake-nikkah.jpg',
    description: 'Traditional nikkah cake with intricate henna-inspired patterns',
    tags: ['#nikkah', '#cultural', '#elegant'],
    flavor: 'Rose & pistachio',
    servings: 50,
  },
  {
    id: '5',
    title: 'Engagement Blush',
    category: 'engagement cake',
    imageUrl: '/images/cake-engagement.jpg',
    description: 'Soft blush-toned engagement cake with delicate florals',
    tags: ['#engagement', '#blush', '#romantic'],
    flavor: 'Strawberry & cream',
    servings: 40,
  },
  {
    id: '6',
    title: 'Cupcake Collection',
    category: 'cupcakes',
    imageUrl: '/images/cupcakes.jpg',
    description: 'Assorted cupcakes in wedding flavors and designs',
    tags: ['#cupcakes', '#variety', '#mini'],
    flavor: 'Mixed flavors',
    servings: 24,
  },
];

export const mockServices: Service[] = [
  {
    id: '1',
    title: 'Custom Design',
    description:
      'Your cake, your way. We work with you to create a design that fits your wedding style, colour palette, and favourite flavours.',
    icon: 'Palette',
  },
  {
    id: '2',
    title: 'Private Tasting',
    description:
      'Book a relaxed tasting session to try our sponges, fillings, and finishes, and find the perfect combination for your cake.',
    icon: 'UtensilsCrossed',
  },
  {
    id: '3',
    title: 'Delivery & Setup',
    description:
      'We deliver and set up your cake at your venue so it looks perfect before your guests arrive.',
    icon: 'Truck',
  },
];