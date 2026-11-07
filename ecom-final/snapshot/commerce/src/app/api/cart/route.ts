export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// GET /api/cart — return the current user's cart
export async function GET(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { usersId: session.sub } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    include: {
      lines: {
        include: {
          product: { include: { vendor: { select: { businessName: true } } } },
        },
      },
    },
  });

  if (!cart) {
    return NextResponse.json({ cart: null, lines: [], totalMinor: 0 });
  }

  const totalMinor = cart.lines.reduce((sum: number, l: any) => {
    const price = l.product.basePrice;
    return sum + price * l.quantity;
  }, 0);

  return NextResponse.json({ cart, lines: cart.lines, totalMinor });
}

// POST /api/cart — add an item to the cart
export async function POST(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json();
  const { productId, variantId, quantity = 1 } = body;

  if (!productId) return NextResponse.json({ error: "productId is required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { usersId: session.sub } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Upsert cart
  let cart = await prisma.cart.findUnique({ where: { userId: user.id } });
  if (!cart) {
    cart = await prisma.cart.create({ data: { userId: user.id } });
  }

  // Check for existing line
  const existing = await prisma.cartLine.findFirst({
    where: { cartId: cart.id, productId, variantId: variantId || null },
  });

  if (existing) {
    await prisma.cartLine.update({
      where: { id: existing.id },
      data: { quantity: existing.quantity + quantity },
    });
  } else {
    await prisma.cartLine.create({
      data: { cartId: cart.id, productId, variantId: variantId || null, quantity },
    });
  }

  return NextResponse.json({ ok: true });
}

// DELETE /api/cart — remove a line item
export async function DELETE(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const lineId = searchParams.get("lineId");
  if (!lineId) return NextResponse.json({ error: "lineId is required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { usersId: session.sub } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const cart = await prisma.cart.findUnique({ where: { userId: user.id } });
  if (!cart) return NextResponse.json({ error: "Cart not found" }, { status: 404 });

  await prisma.cartLine.deleteMany({ where: { id: lineId, cartId: cart.id } });

  return NextResponse.json({ ok: true });
}
