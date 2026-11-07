export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await prisma.product.findUnique({
    where: { id: params.id },
    include: {
      variants: { where: { isActive: true } },
      vendor: { select: { id: true, businessName: true } },
    },
  });

  if (!product) {
    return (
      <div style={{ textAlign: "center", padding: "64px" }}>
        <h1>Product Not Found</h1>
        <Link href="/">Back to store</Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/" style={{ color: "#1a1a2e", marginBottom: "16px", display: "inline-block" }}>← Back to store</Link>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginTop: "16px" }}>
        <div style={{ background: "#f5f5f5", height: "400px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "12px", color: "#999" }}>
          📦
        </div>
        <div>
          <p style={{ color: "#888", marginBottom: "4px" }}>{product.vendor.businessName}</p>
          <h1 style={{ fontSize: "1.75rem", marginBottom: "12px" }}>{product.name}</h1>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e", marginBottom: "16px" }}>
            ${(product.basePrice / 100).toFixed(2)}
          </p>
          <p style={{ color: "#555", lineHeight: 1.6, marginBottom: "24px" }}>{product.description}</p>

          {product.variants.length > 0 && (
            <div style={{ marginBottom: "24px" }}>
              <h3 style={{ marginBottom: "8px" }}>Options</h3>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {product.variants.map((v: any) => (
                  <div key={v.id} style={{ padding: "8px 16px", border: "1px solid #ddd", borderRadius: "8px", fontSize: "0.9rem" }}>
                    {v.name} {v.price && v.price !== product.basePrice ? `— $${(v.price / 100).toFixed(2)}` : ""} ({v.stock} in stock)
                  </div>
                ))}
              </div>
            </div>
          )}

          <button style={{ padding: "12px 32px", background: "#1a1a2e", color: "white", border: "none", borderRadius: "8px", fontSize: "1rem", cursor: "pointer", marginRight: "12px" }}>
            Add to Cart
          </button>
          <button style={{ padding: "12px 32px", background: "#e94560", color: "white", border: "none", borderRadius: "8px", fontSize: "1rem", cursor: "pointer" }}>
            Buy Now
          </button>
        </div>
      </div>
    </div>
  );
}
