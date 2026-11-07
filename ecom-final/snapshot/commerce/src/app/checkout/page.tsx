export const dynamic = "force-dynamic";

// Checkout page — shows the four payment rails. In production the rails
// are driven by /api/orders + payment request creation.
export default function CheckoutPage() {
  const rails = [
    { id: "stripe", label: "Credit / Debit Card", description: "Pay securely with Stripe Checkout.", icon: "💳" },
    { id: "stripe_connect", label: "Vendor Payout (Connect)", description: "For vendor payouts through Stripe Connect.", icon: "🏪" },
    { id: "solana_devnet", label: "Solana (Devnet)", description: "Pay with SOL or USDC on Solana devnet.", icon: "◎" },
    { id: "manual_crypto", label: "ETH / BTC", description: "Send ETH or BTC to a merchant address, then admin confirms.", icon: "₿" },
  ];

  const demoTotalMinor = 7999 + 5499 * 2;

  return (
    <div>
      <h1 style={{ fontSize: "1.75rem", marginBottom: "8px" }}>Checkout</h1>
      <p style={{ color: "#666", marginBottom: "24px" }}>Choose a payment method.</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "32px", alignItems: "start" }}>
        <div>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "16px" }}>Payment Method</h2>
          {rails.map((rail) => (
            <div key={rail.id} style={{ display: "flex", alignItems: "center", padding: "16px", marginBottom: "12px", border: "1px solid #eaeaea", borderRadius: "8px" }}>
              <span style={{ fontSize: "1.5rem", marginRight: "16px" }}>{rail.icon}</span>
              <div style={{ flex: 1 }}>
                <p style={{ fontWeight: 600, marginBottom: "4px" }}>{rail.label}</p>
                <p style={{ color: "#888", fontSize: "0.85rem" }}>{rail.description}</p>
              </div>
              <input type="radio" name="rail" value={rail.id} defaultChecked={rail.id === "stripe"} />
            </div>
          ))}
        </div>
        <div style={{ border: "1px solid #eaeaea", borderRadius: "12px", padding: "24px" }}>
          <h2 style={{ fontSize: "1.1rem", marginBottom: "16px" }}>Summary</h2>
          <p style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1a1a2e", marginBottom: "16px" }}>
            ${(demoTotalMinor / 100).toFixed(2)}
          </p>
          <button style={{ display: "block", width: "100%", padding: "12px", background: "#1a1a2e", color: "white", borderRadius: "8px", border: "none", fontSize: "1rem", fontWeight: 600, cursor: "pointer" }}>
            Pay Now
          </button>
          <p style={{ color: "#888", fontSize: "0.8rem", marginTop: "12px", textAlign: "center" }}>
            Sandbox mode — no real charge will be made.
          </p>
        </div>
      </div>
    </div>
  );
}