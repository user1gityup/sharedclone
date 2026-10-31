import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "canna — California cannabis marketplace",
  description: "Members-only California cannabis retail (B2C) and wholesale (B2B) marketplace.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <span className="brand">canna</span>
          <nav>
            <Link href="/">Shop</Link>
            <Link href="/cart">Cart</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
