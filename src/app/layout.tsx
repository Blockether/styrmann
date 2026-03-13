import type { Metadata, Viewport } from 'next';
import './globals.css';
import { IBM_Plex_Mono, Atkinson_Hyperlegible } from 'next/font/google';
import DemoBanner from '@/components/DemoBanner';

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-ibm-plex-mono',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const atkinsonHyperlegible = Atkinson_Hyperlegible({
  subsets: ['latin'],
  variable: '--font-atkinson-hyperlegible',
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Blockether',
  description: 'AI Agent Orchestration Dashboard',
  icons: {
    icon: '/favicon.svg',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html data-component="src/app/layout" lang="en" className={`${ibmPlexMono.variable} ${atkinsonHyperlegible.variable}`}>
      <body className={`${ibmPlexMono.className} bg-mc-bg text-mc-text min-h-screen`}>
        <DemoBanner />
        {children}
      </body>
    </html>
  );
}
