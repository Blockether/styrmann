interface AgentInitialsProps {
  name: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-6 h-6 text-xs',
  md: 'w-8 h-8 text-sm',
  lg: 'w-10 h-10 text-base',
} as const;

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AgentInitials({ name, size = 'md', className = '' }: AgentInitialsProps) {
  return (
    <span
      data-component="src/components/AgentInitials"
      className={`inline-flex items-center justify-center rounded-full bg-mc-accent/15 text-mc-accent font-semibold select-none flex-shrink-0 ${sizeMap[size]} ${className}`}
      title={name}
    >
      {getInitials(name)}
    </span>
  );
}
