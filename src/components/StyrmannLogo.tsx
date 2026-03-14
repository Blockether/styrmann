'use client';

interface StyrmannLogoProps {
  size?: number;
  className?: string;
}

export function StyrmannLogo({ size = 24, className }: StyrmannLogoProps) {
  return (
    <svg
      data-component="src/components/StyrmannLogo"
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 ${className ?? ''}`.trim()}
      aria-label="Styrmann"
    >
      <circle cx="20" cy="20" r="17" stroke="#B8942E" strokeWidth="2" fill="none" />
      <circle cx="20" cy="20" r="12" stroke="#D4A847" strokeWidth="1.5" fill="none" />
      <g stroke="#B8942E" strokeWidth="2" strokeLinecap="round">
        <line x1="20" y1="3" x2="20" y2="10" />
        <line x1="20" y1="30" x2="20" y2="37" />
        <line x1="3" y1="20" x2="10" y2="20" />
        <line x1="30" y1="20" x2="37" y2="20" />
        <line x1="8" y1="8" x2="12.5" y2="12.5" />
        <line x1="27.5" y1="27.5" x2="32" y2="32" />
        <line x1="32" y1="8" x2="27.5" y2="12.5" />
        <line x1="12.5" y1="27.5" x2="8" y2="32" />
      </g>
      <g fill="#8B6F22">
        <circle cx="20" cy="5" r="2.5" />
        <circle cx="20" cy="35" r="2.5" />
        <circle cx="5" cy="20" r="2.5" />
        <circle cx="35" cy="20" r="2.5" />
        <circle cx="9.5" cy="9.5" r="2" />
        <circle cx="30.5" cy="30.5" r="2" />
        <circle cx="30.5" cy="9.5" r="2" />
        <circle cx="9.5" cy="30.5" r="2" />
      </g>
      <g fill="#D4A847">
        <path d="M20 10 L22 18 L30 20 L22 22 L20 30 L18 22 L10 20 L18 18 Z" />
        <circle cx="20" cy="20" r="3" fill="#8B6F22" />
      </g>
    </svg>
  );
}
