export const dynamic = "force-dynamic";

// Admin dashboard — vendor approval queue, platform overview.
export default function AdminDashboardPage() {
  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "8px" }}>Admin Dashboard</h1>
      <p style={{ color: "#888", marginBottom: "32px" }}>Platform management and vendor approvals.</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "16px" }}>
        <div style={{ padding: "24px", border: "1px solid #eaeaea", borderRadius: "12px", background: "#fff3cd" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>Pending Vendor Approvals</h2>
          <p style={{ fontSize: "2rem", fontWeight: 700 }}>2</p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>Needs review</p>
        </div>
        <div style={{ padding: "24px", border: "1px solid #eaeaea", borderRadius: "12px" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>Total Users</h2>
          <p style={{ fontSize: "2rem", fontWeight: 700 }}>156</p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>Active accounts</p>
        </div>
        <div style={{ padding: "24px", border: "1px solid #eaeaea", borderRadius: "12px" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>Total Orders</h2>
          <p style={{ fontSize: "2rem", fontWeight: 700 }}>842</p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>All time</p>
        </div>
        <div style={{ padding: "24px", border: "1px solid #eaeaea", borderRadius: "12px" }}>
          <h2 style={{ fontSize: "1rem", marginBottom: "8px" }}>House Revenue</h2>
          <p style={{ fontSize: "2rem", fontWeight: 700 }}>$3,210.00</p>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>This month</p>
        </div>
      </div>
    </div>
  );
}