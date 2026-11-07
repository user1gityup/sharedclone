import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { clearCart, getCart } from "@/lib/cartStore";
import { checkout, CheckoutError } from "@/lib/checkoutService";
import { saveOrderResult } from "@/lib/orderResults";
import type { PaymentMethod } from "@/drivers/payment";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const cartId = cookieStore.get("canna_cart_id")?.value ?? "";
  const cart = getCart(cartId);

  if (cart.lines.length === 0) {
    return NextResponse.redirect(new URL("/cart", request.url));
  }

  const form = await request.formData();
  const method = String(form.get("method") ?? "dutchie_pay") as PaymentMethod;

  try {
    const result = await checkout({
      method,
      isWholesale: false,
      licenceVerified: true,
      hasTwoFactor: true,
      lines: cart.lines.map((l) => ({ sku: l.variant.sku, quantity: l.quantity })),
    });
    saveOrderResult(result);
    clearCart(cartId);
    return NextResponse.redirect(new URL(`/checkout/result?ref=${result.orderRef}`, request.url));
  } catch (err) {
    if (err instanceof CheckoutError) {
      return NextResponse.redirect(new URL(`/checkout/result?error=${err.code}`, request.url));
    }
    return NextResponse.json(
      { error: "internal", error_description: err instanceof Error ? err.message : "checkout failed" },
      { status: 500 },
    );
  }
}
