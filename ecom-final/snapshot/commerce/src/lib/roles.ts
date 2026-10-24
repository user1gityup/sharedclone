import { prisma } from "./prisma.ts";
import { getSessionUser } from "./auth.ts";

// Commerce's own role-based authorization, independent of the users service.
// roles are CUSTOMER, VENDOR, ADMIN — stored here, unknown to users.

export type CommerceRole = "CUSTOMER" | "VENDOR" | "ADMIN";

export async function getUserRole(usersId: string): Promise<CommerceRole> {
  const user = await prisma.user.findUnique({
    where: { usersId },
    select: { role: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") return "CUSTOMER";
  return user.role as CommerceRole;
}

// Requires at least one of the given roles from the request's Bearer token.
// Returns the validated usersId and role.
export async function requireRole(request: Request, ...roles: CommerceRole[]): Promise<{ usersId: string; role: CommerceRole }> {
  const session = await getSessionUser(request);
  if (!session) {
    throw new AuthError("Authentication required", 401);
  }
  const role = await getUserRole(session.sub);
  if (roles.length > 0 && !roles.includes(role)) {
    throw new AuthError("Insufficient permissions", 403);
  }
  return { usersId: session.sub, role };
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "AuthError";
  }
}
