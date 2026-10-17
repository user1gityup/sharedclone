export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, AuthError } from "@/lib/roles";

// GET /api/admin/vendors — list pending vendor applications (admin only)
export async function GET(request: NextRequest) {
  try {
    await requireRole(request, "ADMIN");
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "PENDING";

  const vendors = await prisma.vendor.findMany({
    where: { status: status as any },
    include: { user: { select: { id: true, email: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ vendors });
}

// PATCH /api/admin/vendors — approve or reject a vendor application
export async function PATCH(request: NextRequest) {
  try {
    await requireRole(request, "ADMIN");
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const body = await request.json();
  const { vendorId, action } = body; // action: "approve" | "reject"

  if (!vendorId || !action) {
    return NextResponse.json({ error: "vendorId and action are required" }, { status: 400 });
  }

  const newStatus = action === "approve" ? "ACTIVE" : "SUSPENDED";
  const vendor = await prisma.vendor.update({
    where: { id: vendorId },
    data: { status: newStatus },
  });

  return NextResponse.json({ vendor });
}
