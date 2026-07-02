import type { Metadata } from 'next';
import { Playfair_Display, Outfit, JetBrains_Mono } from 'next/font/google';
import { ClerkProvider } from '@clerk/nextjs';
import './globals.css';

const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
});

const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-sans',
  weight: ['300', '400', '500', '600'],
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  weight: ['400', '500', '600'],
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
      <html lang="en" className={`${playfair.variable} ${outfit.variable} ${jetbrains.variable}`}>
        <body className="font-sans antialiased bg-[#faf8f3] text-[#1a1008] overflow-hidden">
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}
