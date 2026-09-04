import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "OB Slips",
  description: "Turn missing work days into printable Official Business Slips.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
