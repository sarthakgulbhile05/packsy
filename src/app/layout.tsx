import type { Metadata } from "next";
import { Geist, Geist_Mono, Poppins } from "next/font/google";
import { publicOrigin, SITE_NAME } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Geometric display face for the Orbitly wordmark and auth headings.
const display = Poppins({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  metadataBase: new URL(publicOrigin()),
  title: { default: "Orbitly · Products travel with people", template: "%s · Orbitly" },
  description: "Get products from another country through travellers already making that journey: abroad to India, and India to abroad.",
  applicationName: SITE_NAME,
  // Same card everywhere; indexable pages set their own openGraph title and URL.
  twitter: { card: "summary_large_image" },
  // Search Console ownership (URL-prefix property). Public by design.
  verification: { google: "DENiEuoAnU-B6iSKzgcOh8ZOiha5sya0G2iaCUx0kyA" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en-IN"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
