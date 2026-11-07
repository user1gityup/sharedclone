import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { clientIpFor } from "@/lib/clientIp";
import { checkRateLimit } from "@/lib/rateLimit";

const AUTH_SENSITIVE_PATHS = new Set(["/api/session", "/api/register"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/")) {
    const ip = clientIpFor(request);
    const maxRequests = AUTH_SENSITIVE_PATHS.has(pathname) ? 10 : undefined;
    const { allowed, remaining } = checkRateLimit(`${ip}:${pathname}`, undefined, maxRequests);
    if (!allowed) {
      return NextResponse.json(
        { error: "rate_limited", error_description: "Too many requests." },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
    const response = NextResponse.next();
    response.headers.set("X-RateLimit-Remaining", String(remaining));
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
