import { NextResponse } from "next/server";
import { listProducts, listRetailProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const includeWholesale = url.searchParams.get("wholesale") === "1";
  const products = includeWholesale ? listProducts() : listRetailProducts();
  return NextResponse.json({ products });
}
