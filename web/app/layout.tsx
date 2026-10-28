import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shotflow",
  description: "A Flow-style AI video studio. Free open models, or bring your own fal.ai key for Veo 3.1, Seedance 2.0, Kling 3.0 and FLUX 3.",
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* separate links, so one family failing never blocks the other */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap" />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop offset='0' stop-color='%238ab4f8'/%3E%3Cstop offset='.5' stop-color='%23c58af9'/%3E%3Cstop offset='1' stop-color='%23fdd663'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='32' height='32' rx='9' fill='url(%23g)'/%3E%3Cpath d='M16 7l2.4 6.6L25 16l-6.6 2.4L16 25l-2.4-6.6L7 16l6.6-2.4z' fill='%230b0b0c'/%3E%3C/svg%3E"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
