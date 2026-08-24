import { HTMLAttributes, ImgHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type CardProps = HTMLAttributes<HTMLDivElement>;

export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden bg-white transition-shadow hover:shadow-md',
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

type CardImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
  alt: string;
};

export function CardImage({ src, alt, className, ...props }: CardImageProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={cn('h-56 w-full object-cover bg-neutral-100', className)}
      {...props}
    />
  );
}

type CardContentProps = HTMLAttributes<HTMLDivElement>;

export function CardContent({ className, children, ...props }: CardContentProps) {
  return (
    <div className={cn('p-4', className)} {...props}>
      {children}
    </div>
  );
}
