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
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100`}
      >
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
