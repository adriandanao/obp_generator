import type { Metadata } from "next";

import Nav from "./nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "HR Forms",
  description: "Printable Official Business slips and Applications for Leave.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
