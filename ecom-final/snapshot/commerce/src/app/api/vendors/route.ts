export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth";

// POST /api/vendors — apply to become a vendor
export async function POST(request: NextRequest) {
  const session = await getSessionUser(request);
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = await request.json();
  const { businessName, description } = body;
  if (!businessName) return NextResponse.json({ error: "businessName is required" }, { status: 400 });

  let user = await prisma.user.findUnique({ where: { usersId: session.sub } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Check if already a vendor
  const existing = await prisma.vendor.findUnique({ where: { userId: user.id } });
  if (existing) {
    return NextResponse.json({ vendor: existing });
  }

  const vendor = await prisma.vendor.create({
    data: {
      userId: user.id,
      businessName,
      description: description || null,
      status: "PENDING",
    },
  });

  return NextResponse.json({ vendor }, { status: 201 });
}

// GET /api/vendors — list approved vendors
export async function GET() {
  const vendors = await prisma.vendor.findMany({
    where: { status: "ACTIVE" },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { businessName: "asc" },
  });

  return NextResponse.json({ vendors });
}
