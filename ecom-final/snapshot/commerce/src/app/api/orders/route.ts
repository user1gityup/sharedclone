export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";
import crypto from "crypto";

// POST /api/orders — create an order from the cart
export async function POST(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json();
  const { shippingAddress } = body;

  const user = await prisma.user.findUnique({ where: { usersId: session.sub } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const cart = await prisma.cart.findUnique({
    where: { userId: user.id },
    include: { lines: { include: { product: true } } },
  });

  if (!cart || cart.lines.length === 0) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }

  // Group by vendor
  const vendorLines = new Map<string, typeof cart.lines>();
  for (const line of cart.lines) {
    const existing = vendorLines.get(line.product.vendorId);
    if (existing) existing.push(line);
    else vendorLines.set(line.product.vendorId, [line]);
  }

  const totalMinor = cart.lines.reduce((s: number, l: any) => s + l.product.basePrice * l.quantity, 0);

  const order = await prisma.order.create({
    data: {
      userId: user.id,
      state: "DRAFT",
      totalMinor,
      shippingAddress: shippingAddress || null,
      lines: {
        create: cart.lines.map((l: any) => ({
          productId: l.productId,
          variantId: l.variantId,
          priceMinor: l.product.basePrice,
          quantity: l.quantity,
          vendorId: l.product.vendorId,
        })),
      },
    },
    include: { lines: true },
  });

  // Clear the cart
  await prisma.cartLine.deleteMany({ where: { cartId: cart.id } });

  // Transition to awaiting_payment
  await prisma.order.update({
    where: { id: order.id },
    data: { state: "AWAITING_PAYMENT" },
  });

  return NextResponse.json({ order }, { status: 201 });
}

// GET /api/orders — list current user's orders
export async function GET(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { usersId: session.sub } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: {
      lines: { include: { product: { include: { vendor: { select: { businessName: true } } } } } },
      paymentRequests: true,
      shipments: true,
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ orders });
}
