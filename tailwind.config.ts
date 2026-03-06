import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Blockether Light Theme — Gold #FFD700, Cream #fdf4e5, Charcoal #333
        'mc-bg': '#fdf4e5',
        'mc-bg-secondary': '#ffffff',
        'mc-bg-tertiary': '#f5ead6',
        'mc-border': '#e0d4be',
        'mc-text': '#333333',
        'mc-text-secondary': '#6e6453',
        'mc-accent': '#8a700a',
        'mc-accent-green': '#1a7a2e',
        'mc-accent-yellow': '#7a5c00',
        'mc-accent-red': '#c83232',
        'mc-accent-purple': '#7c3aed',
        'mc-accent-pink': '#8a700a',
        'mc-accent-cyan': '#0d7d72',
        'mc-gold': '#FFD700',
      },
      fontFamily: {
        serif: ['Atkinson Hyperlegible', 'Georgia', 'serif'],
        mono: ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
