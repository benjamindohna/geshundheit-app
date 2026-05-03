import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gesundheits-Dashboard",
  description: "Persönliches Gesundheits-Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className={`${geist.variable} h-full`}>
      <body className="min-h-full font-[var(--font-geist)] antialiased">{children}</body>
    </html>
  );
}
