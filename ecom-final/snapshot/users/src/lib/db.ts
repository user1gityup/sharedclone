/**
 * In-memory data store for the users identity service.
 *
 * This is the build-time/dev runtime store: it runs with no database so
 * `next build` and the test suite succeed without one. A production deployment
 * replaces it with a Prisma/Postgres-backed implementation of the same shapes
 * (see prisma/schema.prisma). Token stores keep only irreversible hashes.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { SessionRecord, User } from "./types";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class EmailAlreadyExistsError extends Error {
  constructor(email: string) {
    super(`A user with email ${email} already exists`);
    this.name = "EmailAlreadyExistsError";
  }
}

export interface CreateUserInput {
  email: string;
  passwordHash: string | null;
  name?: string | null;
  picture?: string | null;
  emailVerified?: boolean;
  totpSecret?: string | null;
}

export interface UpdateUserPatch {
  email?: string;
  passwordHash?: string | null;
  name?: string | null;
  picture?: string | null;
  emailVerified?: boolean;
  totpSecret?: string | null;
}

export class UserRepository {
  private readonly usersById = new Map<string, User>();
  private readonly idsByEmail = new Map<string, string>();

  async findByEmail(email: string): Promise<User | null> {
    const id = this.idsByEmail.get(normalizeEmail(email));
    return id ? (this.usersById.get(id) ?? null) : null;
  }

  async findById(id: string): Promise<User | null> {
    return this.usersById.get(id) ?? null;
  }

  async create(input: CreateUserInput): Promise<User> {
    const email = normalizeEmail(input.email);
    if (this.idsByEmail.has(email)) throw new EmailAlreadyExistsError(email);
    const now = Date.now();
    const user: User = {
      id: `usr_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
      email,
      name: input.name ?? null,
      picture: input.picture ?? null,
      passwordHash: input.passwordHash ?? null,
      emailVerified: input.emailVerified ?? false,
      totpSecret: input.totpSecret ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.usersById.set(user.id, user);
    this.idsByEmail.set(email, user.id);
    return user;
  }

  async update(id: string, patch: UpdateUserPatch): Promise<User | null> {
    const user = this.usersById.get(id);
    if (!user) return null;

    if (patch.email !== undefined) {
      const email = normalizeEmail(patch.email);
      const existingId = this.idsByEmail.get(email);
      if (existingId && existingId !== id) throw new EmailAlreadyExistsError(email);
      this.idsByEmail.delete(user.email);
      user.email = email;
      this.idsByEmail.set(email, id);
    }
    if (patch.passwordHash !== undefined) user.passwordHash = patch.passwordHash;
    if (patch.name !== undefined) user.name = patch.name;
    if (patch.picture !== undefined) user.picture = patch.picture;
    if (patch.emailVerified !== undefined) user.emailVerified = patch.emailVerified;
    if (patch.totpSecret !== undefined) user.totpSecret = patch.totpSecret;
    user.updatedAt = Date.now();
    return user;
  }
}

/** Single-use opaque token store (password reset, TOTP challenge, OAuth state, email verification). */
export class OpaqueTokenStore {
  private readonly tokens = new Map<string, { value: string; expiresAt: number }>();
  private readonly purpose: string;

  constructor(purpose: string) {
    this.purpose = purpose;
  }

  issue(value: string, ttlSeconds: number): string {
    const token = `${this.purpose}_${randomBytes(32).toString("base64url")}`;
    this.tokens.set(sha256Hex(token), {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    return token;
  }

  /** Look up without consuming; null when missing or expired. */
  peek(token: string): string | null {
    const entry = this.tokens.get(sha256Hex(token));
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) return null;
    return entry.value;
  }

  /** Look up and consume; null when missing, expired, or already used. */
  consume(token: string): string | null {
    const key = sha256Hex(token);
    const entry = this.tokens.get(key);
    if (!entry) return null;
    this.tokens.delete(key);
    if (entry.expiresAt < Date.now()) return null;
    return entry.value;
  }
}

/** Single-use backup recovery codes, stored only as hashes. */
export class BackupCodeStore {
  private readonly byUser = new Map<string, Map<string, { spentAt: number | null }>>();

  set(userId: string, codes: string[]): void {
    const map = new Map<string, { spentAt: number | null }>();
    for (const code of codes) {
      map.set(sha256Hex(code.toUpperCase().replace(/\s/g, "")), { spentAt: null });
    }
    this.byUser.set(userId, map);
  }

  consume(userId: string, code: string): boolean {
    const map = this.byUser.get(userId);
    if (!map) return false;
    const entry = map.get(sha256Hex(code.toUpperCase().replace(/\s/g, "")));
    if (!entry || entry.spentAt !== null) return false;
    entry.spentAt = Date.now();
    return true;
  }
}

export interface SessionCreateInput {
  sid: string;
  userId: string;
  amr: string[];
  device?: string | null;
  ttlSeconds: number;
}

export class SessionStore {
  private readonly bySid = new Map<string, SessionRecord>();

  create(input: SessionCreateInput): SessionRecord {
    const now = Date.now();
    const record: SessionRecord = {
      jti: randomUUID(),
      sid: input.sid,
      userId: input.userId,
      refreshTokenHash: null,
      device: input.device ?? null,
      issuedAt: now,
      expiresAt: now + input.ttlSeconds * 1000,
      revokedAt: null,
      amr: input.amr,
    };
    this.bySid.set(record.sid, record);
    return record;
  }

  findBySid(sid: string): SessionRecord | null {
    return this.bySid.get(sid) ?? null;
  }

  attachRefreshToken(sid: string, refreshToken: string): void {
    const record = this.bySid.get(sid);
    if (record) record.refreshTokenHash = sha256Hex(refreshToken);
  }

  findByRefreshToken(refreshToken: string): SessionRecord | null {
    const hash = sha256Hex(refreshToken);
    for (const record of this.bySid.values()) {
      if (record.refreshTokenHash === hash) return record;
    }
    return null;
  }

  revokeBySid(sid: string): boolean {
    const record = this.bySid.get(sid);
    if (!record) return false;
    record.revokedAt = Date.now();
    record.refreshTokenHash = null;
    return true;
  }

  revokeByRefreshToken(refreshToken: string): boolean {
    const record = this.findByRefreshToken(refreshToken);
    if (!record) return false;
    record.revokedAt = Date.now();
    record.refreshTokenHash = null;
    return true;
  }

  isActive(record: SessionRecord | null): record is SessionRecord {
    if (!record) return false;
    if (record.revokedAt !== null) return false;
    if (record.expiresAt < Date.now()) return false;
    return true;
  }
}

export const db = {
  users: new UserRepository(),
  sessions: new SessionStore(),
  backupCodes: new BackupCodeStore(),
  passwordResets: new OpaqueTokenStore("pwreset"),
  totpChallenges: new OpaqueTokenStore("totp"),
  oauthStates: new OpaqueTokenStore("oauth"),
  emailVerifications: new OpaqueTokenStore("verify"),
};
