export const dynamic = "force-dynamic";

// Vendor dashboard — manage products, view orders, track payouts.
export default function VendorDashboardPage() {
  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "8px" }}>Vendor Dashboard</h1>
      <p style={{ color: "#888", marginBottom: "32px" }}>Manage your products, orders, and payouts.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
        <div style={{ padding: "24px", border: "1px solid #eaeaea", borderRadius: "12px" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>Products</h2>
          <p style={{ fontSize: "2rem", fontWeight: 700 }}>3</p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>Active listings</p>
        </div>
        <div style={{ padding: "24px", border: "1px solid #eaeaea", borderRadius: "12px" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>Orders</h2>
          <p style={{ fontSize: "2rem", fontWeight: 700 }}>12</p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>Pending fulfilment</p>
        </div>
        <div style={{ padding: "24px", border: "1px solid #eaeaea", borderRadius: "12px" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>Revenue</h2>
          <p style={{ fontSize: "2rem", fontWeight: 700 }}>$1,234.50</p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>This month</p>
        </div>
        <div style={{ padding: "24px", border: "1px solid #eaeaea", borderRadius: "12px" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>Payouts</h2>
          <p style={{ fontSize: "2rem", fontWeight: 700 }}>$890.00</p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>Pending settlement</p>
        </div>
      </div>
    </div>
  );
}