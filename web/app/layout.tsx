import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shotloom",
  description: "A Flow-style AI video studio. Bring your own fal.ai key: Veo 3.1, Seedance 2.0, Kling 3.0 and more.",
};

export const viewport: Viewport = {
  themeColor: "#0d0c0b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
        />
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23f0a43a'/%3E%3Cpath d='M9 8h14v16H9zM13 8v16M19 8v16' fill='none' stroke='%231a1206' stroke-width='2'/%3E%3C/svg%3E"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
