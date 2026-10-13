import type { Metadata, Viewport } from 'next';
import { Caprasimo, Figtree } from 'next/font/google';
import './globals.css';

/**
 * Caprasimo is the only display face in the Organic system — a warm, heavy
 * slab that carries all the personality. Figtree does everything else. Both
 * are self-hosted by next/font rather than @import'd from Google, so there is
 * no render-blocking third-party request and no layout shift on load.
 */
const caprasimo = Caprasimo({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-caprasimo',
  display: 'swap',
});

const figtree = Figtree({
  weight: ['400', '600', '700'],
  subsets: ['latin'],
  variable: '--font-figtree',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'FitSync — hold the pose, we’ll watch the rest',
  description:
    'Real-time yoga form feedback from the camera you already have. Eight poses, timed holds, and one calm spoken correction at a time. Pose detection runs on your device — the video never leaves it.',
  applicationName: 'FitSync',
  openGraph: {
    title: 'FitSync',
    description:
      'Real-time yoga form feedback from the camera you already have. Eight poses, timed holds, one calm correction at a time.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#f5ead8',
  width: 'device-width',
  initialScale: 1,
  // The live session is a fixed full-viewport surface; letting it zoom on a
  // double-tap while someone is mid-pose would be actively unhelpful, but
  // capping zoom outright fails WCAG. maximumScale is left alone deliberately.
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${caprasimo.variable} ${figtree.variable}`}>
      <body>{children}</body>
    </html>
  );
}
