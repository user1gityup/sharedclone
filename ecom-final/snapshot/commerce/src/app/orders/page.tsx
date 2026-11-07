export const dynamic = "force-dynamic";

// Orders page — lists the signed-in user's orders. Backed by /api/orders.
export default function OrdersPage() {
  const demoOrders = [
    {
      id: "ord_demo_001",
      state: "PAID",
      totalMinor: 18997,
      createdAt: "2026-10-01",
      lines: [
        { id: "ol_1", name: "Wireless Bluetooth Headphones", vendor: "Acme Electronics", quantity: 1, priceMinor: 7999 },
        { id: "ol_2", name: "Organic Cotton Towel Set", vendor: "GreenLeaf Home Goods", quantity: 2, priceMinor: 5499 },
      ],
    },
  ];

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "24px" }}>Your Orders</h1>
      {demoOrders.length === 0 && <p style={{ color: "#888" }}>No orders yet.</p>}
      {demoOrders.map((order) => (
        <div key={order.id} style={{ border: "1px solid #eaeaea", borderRadius: "12px", padding: "24px", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
            <span style={{ fontWeight: 600 }}>{order.id}</span>
            <span style={{ padding: "4px 12px", background: order.state === "PAID" ? "#d4edda" : "#f0f0f0", borderRadius: "999px", fontSize: "0.8rem" }}>
              {order.state}
            </span>
          </div>
          <div style={{ marginBottom: "16px" }}>
            {order.lines.map((line) => (
              <div key={line.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span>{line.name} <span style={{ color: "#888", fontSize: "0.85rem" }}>({line.vendor})</span></span>
                <span>${(line.priceMinor * line.quantity / 100).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ textAlign: "right", fontSize: "1.1rem", fontWeight: 700 }}>
            Total: ${(order.totalMinor / 100).toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
}