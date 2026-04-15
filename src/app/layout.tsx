import type { Metadata } from 'next';
import { DM_Sans, DM_Serif_Display, DM_Mono, Orbitron } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300','400','500','600','700'],
  display: 'swap',
});

const dmSerif = DM_Serif_Display({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400'],
  style: ['normal','italic'],
  display: 'swap',
});

const dmMono = DM_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400','500'],
  display: 'swap',
});

const orbitron = Orbitron({
  subsets: ['latin'],
  variable: '--font-brand',
  weight: ['700','800'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Alpha Horizon',
  description: 'AI Financial Planner + Portfolio Growth Lab — unified institutional-grade platform',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${dmSans.variable} ${dmSerif.variable} ${dmMono.variable} ${orbitron.variable}`}>
        <body className="font-sans antialiased bg-slate-50 text-gray-800 overflow-hidden">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
