import { mockCakes } from './mock-data';

export function cn(...classes: (string | undefined | boolean)[]) {
  return classes.filter(Boolean).join(' ');
}

export function getCakesByCategory(category: string) {
  return mockCakes.filter((cake) => cake.category === category);
}

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}