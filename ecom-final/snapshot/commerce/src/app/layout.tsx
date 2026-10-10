import "@/lib/prisma";

// "use client" marker for pages that aren't here
// But this is the root layout — server component
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Commerce — Multi-Vendor Storefront",
  description: "A complete multi-vendor ecommerce platform.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif" }}>
        <header style={{ background: "#1a1a2e", color: "white", padding: "16px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Link href="/" style={{ color: "white", textDecoration: "none", fontSize: "1.25rem", fontWeight: 700 }}>
            Commerce
          </Link>
          <nav style={{ display: "flex", gap: "16px" }}>
            <Link href="/search" style={{ color: "white", textDecoration: "none" }}>Search</Link>
            <Link href="/cart" style={{ color: "white", textDecoration: "none" }}>Cart</Link>
            <Link href="/orders" style={{ color: "white", textDecoration: "none" }}>Orders</Link>
            <Link href="/vendor/dashboard" style={{ color: "white", textDecoration: "none" }}>Sell</Link>
          </nav>
        </header>
        <main style={{ maxWidth: 1200, margin: "0 auto", padding: "24px" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
