import Link from "next/link";
import { getOrderResult } from "@/lib/orderResults";
import { fromMinor } from "@/lib/units";

export const dynamic = "force-dynamic";

export default async function CheckoutResultPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string; error?: string }>;
}) {
  const { ref, error } = await searchParams;

  if (error) {
    return (
      <div>
        <h1>Checkout failed</h1>
        <p className="muted">{error}</p>
        <p>
          <Link href="/cart">Back to cart</Link>
        </p>
      </div>
    );
  }

  const result = ref ? getOrderResult(ref) : undefined;
  if (!result) {
    return (
      <div>
        <h1>Order not found</h1>
        <p>
          <Link href="/">Home</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>Order placed</h1>
      <table>
        <tbody>
          <tr>
            <td>Order ref</td>
            <td>{result.orderRef}</td>
          </tr>
          <tr>
            <td>Total</td>
            <td>${fromMinor(result.totalCents)}</td>
          </tr>
          <tr>
            <td>Compliance</td>
            <td>
              {result.compliance.passed ? "passed" : "failed"} ({result.compliance.system}, record{" "}
              {result.compliance.recordId})
            </td>
          </tr>
          <tr>
            <td>Payment</td>
            <td>
              {result.payment.method} — {result.payment.status}
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        <Link href="/">Continue shopping</Link>
      </p>
    </div>
  );
}
