'use client';

/* eslint-disable @next/next/no-img-element */

interface StyrmannLogoProps {
  size?: number;
  className?: string;
}

export function StyrmannLogo({ size = 24, className }: StyrmannLogoProps) {
  return (
    <img
      data-component="src/components/StyrmannLogo"
      src="/logo.png"
      alt="Styrmann"
      width={size}
      height={size}
      className={`shrink-0 rounded object-contain ${className ?? ''}`.trim()}
    />
  );
}
