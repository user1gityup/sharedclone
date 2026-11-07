import Link from "next/link";
import { cookies } from "next/headers";
import { getCart } from "@/lib/cartStore";
import { fromMinor } from "@/lib/units";

export const dynamic = "force-dynamic";

export default async function CartPage() {
  const cookieStore = await cookies();
  const cartId = cookieStore.get("canna_cart_id")?.value ?? "";
  const cart = getCart(cartId);

  return (
    <div>
      <h1>Your cart</h1>
      {cart.lines.length === 0 ? (
        <p>
          Your cart is empty. <Link href="/">Browse products</Link>
        </p>
      ) : (
        <>
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {cart.lines.map((l) => (
                <tr key={l.variant.sku}>
                  <td>{l.variant.name}</td>
                  <td>{l.quantity}</td>
                  <td>${fromMinor(l.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p>
            <strong>Total: ${fromMinor(cart.totalCents)}</strong>
          </p>
          <form action="/api/checkout" method="POST" style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
            <label htmlFor="method">Payment method</label>
            <select id="method" name="method" defaultValue="dutchie_pay">
              <option value="dutchie_pay">Dutchie Pay</option>
              <option value="treez_pay">Treez Pay</option>
              <option value="crypto">Crypto</option>
              <option value="ach">ACH</option>
              <option value="terms">Terms</option>
            </select>
            <button type="submit">Place order</button>
          </form>
        </>
      )}
    </div>
  );
}
