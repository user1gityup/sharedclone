export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function HomePage() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    include: { vendor: { select: { businessName: true } } },
    orderBy: { createdAt: "desc" },
    take: 12,
  });

  const categories = ["Electronics", "Home"];

  return (
    <div>
      <section style={{ marginBottom: "32px" }}>
        <h1 style={{ fontSize: "2rem", marginBottom: "8px" }}>Welcome to Commerce</h1>
        <p style={{ color: "#666", fontSize: "1.1rem" }}>Multi-vendor marketplace — shop from independent sellers.</p>
      </section>

      <section style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "12px" }}>Categories</h2>
        <div style={{ display: "flex", gap: "12px" }}>
          <Link href="/" style={{ padding: "8px 16px", background: "#1a1a2e", color: "white", borderRadius: "8px", textDecoration: "none" }}>All</Link>
          {categories.map((cat) => (
            <Link key={cat} href={`/search?category=${encodeURIComponent(cat)}`} style={{ padding: "8px 16px", background: "#f0f0f0", borderRadius: "8px", textDecoration: "none", color: "#333" }}>
              {cat}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ fontSize: "1.25rem", marginBottom: "16px" }}>Featured Products</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "24px" }}>
          {products.map((product) => (
            <Link
              key={product.id}
              href={`/products/${product.id}`}
              style={{ textDecoration: "none", color: "inherit", border: "1px solid #eaeaea", borderRadius: "12px", overflow: "hidden", display: "block" }}
            >
              <div style={{ background: "#f5f5f5", height: "200px", display: "flex", alignItems: "center", justifyContent: "center", color: "#999", fontSize: "0.9rem" }}>
                {product.imageUrl ? `[${product.name}]` : "📦"}
              </div>
              <div style={{ padding: "16px" }}>
                <p style={{ fontSize: "0.8rem", color: "#888", marginBottom: "4px" }}>{product.vendor.businessName}</p>
                <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>{product.name}</h3>
                <p style={{ fontWeight: 700, fontSize: "1.1rem", color: "#1a1a2e" }}>
                  ${(product.basePrice / 100).toFixed(2)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
