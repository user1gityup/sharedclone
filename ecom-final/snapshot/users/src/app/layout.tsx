import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "users — identity service",
  description:
    "Identity, authentication and session service (ECOMM BUILD 1 of 3). Issues Ed25519-signed sessions verified by storefronts via JWKS.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
