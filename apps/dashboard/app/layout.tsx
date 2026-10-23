import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ordr.ae", template: "%s | ordr.ae" },
  description: "WhatsApp ordering for restaurants, salons and clinics in the UAE.",
  // Home-screen install on iPhone: the only way Apple delivers Web Push to a site.
  appleWebApp: { capable: true, title: "ordr.ae", statusBarStyle: "default" },
};

export const viewport = { themeColor: "#16a34a" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
