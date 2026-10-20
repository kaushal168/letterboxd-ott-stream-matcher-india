import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CineFind | Where to Watch",
  description: "Instantly check OTT streaming availability in India for your Letterboxd lists, watchlists, and movie searches.",
  keywords: ["Letterboxd", "Streaming", "India", "OTT", "Where to watch", "CineFind", "Movies"],
  openGraph: {
    title: "CineFind",
    description: "Check where any Letterboxd list / film is streaming in India instantly.",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}