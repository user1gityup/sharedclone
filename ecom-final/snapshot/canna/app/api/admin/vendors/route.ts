import { NextResponse } from "next/server";
import {
  approveApplication,
  listApplications,
  rejectApplication,
  submitApplication,
} from "@/lib/vendorApplications";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ applications: listApplications() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json(
      { error: "validation_failed", error_description: "JSON body required" },
      { status: 400 },
    );
  }
  try {
    const application = submitApplication({
      businessName: String(body.businessName ?? ""),
      stateLicenceNumber: String(body.stateLicenceNumber ?? ""),
      issuingState: String(body.issuingState ?? ""),
      licenceExpiry: String(body.licenceExpiry ?? ""),
    });
    return NextResponse.json({ application }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: "validation_failed", error_description: err instanceof Error ? err.message : "invalid application" },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json(
      { error: "validation_failed", error_description: "JSON body required" },
      { status: 400 },
    );
  }
  const id = String(body.id ?? "");
  const action = String(body.action ?? "");
  const application =
    action === "approve" ? approveApplication(id) : action === "reject" ? rejectApplication(id) : undefined;
  if (!application) {
    return NextResponse.json({ error: "not_found", error_description: "application not found" }, { status: 404 });
  }
  return NextResponse.json({ application });
}
