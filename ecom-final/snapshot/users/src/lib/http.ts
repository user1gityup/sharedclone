/**
 * HTTP response helpers shared by route handlers.
 */
import { NextResponse } from "next/server";
import { authError, type AuthErrorCode } from "./errorCodes";

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function jsonError(error: string, status: number, description?: string): NextResponse {
  return NextResponse.json({ error, error_description: description }, { status });
}

export function authErrorResponse(code: AuthErrorCode): NextResponse {
  const e = authError(code);
  return NextResponse.json(
    { error: e.code, error_description: e.message },
    { status: e.httpStatus },
  );
}
