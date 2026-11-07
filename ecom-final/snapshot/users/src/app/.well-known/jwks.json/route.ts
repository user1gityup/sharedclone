import { NextResponse } from "next/server";
import { getJwks } from "@/lib/jwks";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const response = NextResponse.json(getJwks());
  response.headers.set("Cache-Control", "public, max-age=300");
  return response;
}
