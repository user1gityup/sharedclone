import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { addToCart, clearCart, getCart } from "@/lib/cartStore";

export const dynamic = "force-dynamic";

async function resolveCartId(): Promise<string> {
  const cookieStore = await cookies();
  let cartId = cookieStore.get("canna_cart_id")?.value;
  if (!cartId) {
    cartId = crypto.randomUUID();
    cookieStore.set("canna_cart_id", cartId, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
  }
  return cartId;
}

export async function GET() {
  const cartId = await resolveCartId();
  return NextResponse.json({ cart: getCart(cartId) });
}

export async function POST(request: Request) {
  const cartId = await resolveCartId();
  const form = await request.formData();
  const sku = String(form.get("sku") ?? "");
  const quantity = Number(form.get("quantity") ?? 1);
  try {
    addToCart(cartId, sku, quantity);
  } catch (err) {
    return NextResponse.json(
      { error: "validation_failed", error_description: err instanceof Error ? err.message : "invalid cart input" },
      { status: 400 },
    );
  }
  return NextResponse.redirect(new URL("/cart", request.url));
}

export async function DELETE() {
  const cookieStore = await cookies();
  const cartId = cookieStore.get("canna_cart_id")?.value ?? "";
  clearCart(cartId);
  return NextResponse.json({ ok: true });
}
