import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Malalabar Admin",
  description: "Restaurant management",
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
          href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="font-ui bg-surface-page min-h-screen">{children}</body>
    </html>
  );
}
