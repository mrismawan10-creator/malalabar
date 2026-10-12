import type { Metadata } from "next";
import { DemoBanner } from "@malalabar/ui";
import { config } from "@/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "Malalabar KDS",
  description: "Kitchen display system",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Fredoka:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-ui bg-ink text-white h-screen overflow-hidden">
        {children}
        {config.demoMode && <DemoBanner variant="pill" />}
      </body>
    </html>
  );
}
