export const dynamic = "force-dynamic";

import Link from "next/link";

// Cart page — client-side cart state, simplified. In a real app this
// syncs with /api/cart behind a bearer token.
export default function CartPage() {
  const demoLineItems = [
    { id: "line_1", name: "Wireless Bluetooth Headphones", vendor: "Acme Electronics", priceMinor: 7999, quantity: 1 },
    { id: "line_2", name: "Organic Cotton Towel Set", vendor: "GreenLeaf Home Goods", priceMinor: 5499, quantity: 2 },
  ];

  const totalMinor = demoLineItems.reduce((s, l) => s + l.priceMinor * l.quantity, 0);

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "24px" }}>Your Cart</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "32px", alignItems: "start" }}>
        <div>
          {demoLineItems.map((line) => (
            <div key={line.id} style={{ display: "flex", justifyContent: "space-between", padding: "16px", border: "1px solid #eaeaea", borderRadius: "8px", marginBottom: "12px" }}>
              <div>
                <p style={{ fontWeight: 600, marginBottom: "4px" }}>{line.name}</p>
                <p style={{ color: "#888", fontSize: "0.85rem" }}>{line.vendor}</p>
              </div>
              <div style={{ textAlign: "right" }}>
                <p style={{ fontWeight: 700 }}>${(line.priceMinor / 100).toFixed(2)} × {line.quantity}</p>
                <p style={{ color: "#888", fontSize: "0.85rem" }}>${(line.priceMinor * line.quantity / 100).toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
        <div style={{ border: "1px solid #eaeaea", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "16px" }}>Order Summary</h2>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e", marginBottom: "16px" }}>
            ${(totalMinor / 100).toFixed(2)}
          </p>
          <Link href="/checkout" style={{ display: "block", textAlign: "center", padding: "12px", background: "#1a1a2e", color: "white", borderRadius: "8px", textDecoration: "none", fontWeight: 600 }}>
            Proceed to Checkout
          </Link>
        </div>
      </div>
    </div>
  );
}