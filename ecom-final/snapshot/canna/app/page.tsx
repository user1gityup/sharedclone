import Link from "next/link";
import { listRetailProducts } from "@/lib/catalog";
import { fromMinor } from "@/lib/units";

export const dynamic = "force-dynamic";

export default function HomePage() {
  const products = listRetailProducts();

  return (
    <div>
      <h1>canna — California cannabis marketplace</h1>
      <p className="notice">
        Demo catalog for local development. Sessions are issued by the users
        service and verified here with its public JWKS; this storefront never
        mints tokens and holds no signing key.
      </p>
      <ul className="grid">
        {products.map((p) => {
          const price = p.variants[0]?.priceCents;
          return (
            <li key={p.id}>
              <Link className="card" href={`/product/${p.id}`}>
                <h2>{p.name}</h2>
                <div className="muted">{p.category}</div>
                <div>from ${price !== undefined ? fromMinor(price) : "—"}</div>
                {p.thcPercent !== null && (
                  <div className="muted">
                    THC {p.thcPercent}% / CBD {p.cbdPercent ?? 0}%
                  </div>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
