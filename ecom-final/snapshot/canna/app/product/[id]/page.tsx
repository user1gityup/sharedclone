import Link from "next/link";
import { notFound } from "next/navigation";
import { getProduct } from "@/lib/catalog";
import { fromMinor } from "@/lib/units";

export const dynamic = "force-dynamic";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();

  return (
    <div>
      <p>
        <Link href="/">← back to shop</Link>
      </p>
      <h1>{product.name}</h1>
      <p className="muted">{product.category}</p>
      <p>{product.description}</p>
      {product.thcPercent !== null && (
        <p>
          THC {product.thcPercent}% / CBD {product.cbdPercent ?? 0}%
        </p>
      )}
      <h2>Variants</h2>
      <ul>
        {product.variants.map((v) => (
          <li key={v.id} style={{ marginBottom: "0.6rem" }}>
            <form action="/api/cart" method="POST" style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
              <input type="hidden" name="sku" value={v.sku} />
              <span>
                {v.name} — ${fromMinor(v.priceCents)}{" "}
                <span className="muted">({v.stock} in stock)</span>
              </span>
              <input type="number" name="quantity" defaultValue={1} min={1} max={v.stock} style={{ width: "4.5rem" }} />
              <button type="submit">Add to cart</button>
            </form>
          </li>
        ))}
      </ul>
    </div>
  );
}
