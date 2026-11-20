import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Manrope } from 'next/font/google';
import type { ReactNode } from 'react';
import { copy } from '@/lib/copy';
import './globals.css';

const manrope = Manrope({
  subsets: ['latin'],
  // The same four weights the team site loads.
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-manrope',
});

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['600', '800'],
  display: 'swap',
  variable: '--font-bricolage',
});

export const metadata: Metadata = {
  title: copy.app.title,
  robots: { index: false, follow: false },
  icons: { icon: '/icon.png', apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: copy.app.shortTitle, statusBarStyle: 'black-translucent' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#050507',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${bricolage.variable} bg-space font-sans text-paper antialiased`}>
        {children}
      </body>
    </html>
  );
}
