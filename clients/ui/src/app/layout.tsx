import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { ClientProviders } from '@/components/client-providers';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  display: 'swap', // AC-4.9: Critical fonts use font-display: swap
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'RoboPoker',
  description: 'On-chain multiplayer poker',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // AC-8.3: viewport-fit=cover enables safe area insets on notched devices
    <html lang="en" className="dark">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased safe-area-insets`}
      >
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
