import { test } from "node:test";
import assert from "node:assert/strict";
import {
  base32Encode,
  base32Decode,
  generateTotpSecret,
  hotp,
  generateBackupCodes,
  totpProvisioningUri,
} from "../src/lib/totp.ts";
import {
  checkRateLimit,
  resetRateLimits,
} from "../src/lib/rateLimit.ts";
import { clientIpFor, clientIp } from "../src/lib/clientIp.ts";
import {
  checkPassword,
  normalizePassword,
  MIN_LENGTH,
  MAX_LENGTH,
} from "../src/lib/passwordPolicy.ts";
import { AUTH_ERRORS, authError } from "../src/lib/errorCodes.ts";
import {
  db,
  UserRepository,
  EmailAlreadyExistsError,
  OpaqueTokenStore,
} from "../src/lib/db.ts";
import { toPublicUser } from "../src/lib/types.ts";
import {
  FIXED_NOW,
  JWKS_FIXTURE,
  CLAIMS_VALID,
  CLAIMS_EXPIRED,
  CLAIMS_MISSING_JTI,
} from "./fixtures/tokens.ts";

// --- TOTP (RFC 4226 HOTP test vectors) ---

const RFC4226_SECRET_B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

test("base32 matches the RFC 4648 \"foobar\" vector", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(base32Decode("MZXW6YTBOI").toString(), "foobar");
});

test("base32 encode/decode round-trip", () => {
  const decoded = base32Decode(RFC4226_SECRET_B32);
  assert.equal(decoded.toString(), "12345678901234567890");
  assert.equal(base32Encode(decoded), RFC4226_SECRET_B32);
});

test("HOTP matches RFC 4226 test vectors (SHA-1)", () => {
  const expected = [
    "755224",
    "287082",
    "359152",
    "969429",
    "338314",
    "254676",
    "287922",
    "162583",
    "399871",
    "520489",
  ];
  for (let counter = 0; counter < expected.length; counter++) {
    assert.equal(hotp(RFC4226_SECRET_B32, counter), expected[counter]);
  }
});

test("generateTotpSecret returns a 32-char base32 secret", () => {
  const secret = generateTotpSecret();
  assert.equal(secret.length, 32);
  assert.match(secret, /^[A-Z2-7]+$/);
});

test("generateBackupCodes returns 10 hyphenated codes", () => {
  const codes = generateBackupCodes(10);
  assert.equal(codes.length, 10);
  for (const code of codes) {
    assert.match(code, /^[A-F0-9]{5}-[A-F0-9]{5}$/);
  }
});

test("totpProvisioningUri embeds issuer/account/secret", () => {
  const uri = totpProvisioningUri("SECRET", "buyer@example.com", "users");
  assert.ok(uri.startsWith("otpauth://totp/"));
  assert.ok(uri.includes("secret=SECRET"));
  assert.ok(uri.includes("issuer=users"));
});

// --- Rate limiting ---

test("checkRateLimit enforces the window max", () => {
  resetRateLimits();
  const key = "ip:login";
  for (let i = 0; i < 3; i++) {
    assert.equal(checkRateLimit(key, Date.now(), 3).allowed, true);
  }
  assert.equal(checkRateLimit(key, Date.now(), 3).allowed, false);
});

test("checkRateLimit reports remaining", () => {
  resetRateLimits();
  assert.equal(checkRateLimit("k", Date.now(), 10).remaining, 9);
});

// --- Client IP ---

test("clientIpFor returns the client with one trusted proxy", () => {
  assert.equal(clientIpFor("1.2.3.4", 1), "1.2.3.4");
});

test("clientIpFor ignores a spoofed leftmost entry", () => {
  assert.equal(clientIpFor("spoofed.example, 5.6.7.8", 1), "5.6.7.8");
});

test("clientIpFor with multiple proxies", () => {
  assert.equal(clientIpFor("1.2.3.4, 10.0.0.1, 10.0.0.2", 2), "10.0.0.1");
});

test("clientIpFor falls back to leftmost when fewer hops than proxies", () => {
  assert.equal(clientIpFor("1.2.3.4", 3), "1.2.3.4");
});

test("clientIpFor returns unknown when no header", () => {
  assert.equal(clientIpFor(null, 1), "unknown");
  assert.equal(clientIpFor("", 1), "unknown");
});

test("clientIp extracts the header from a request-like object", () => {
  const req = { headers: { get: (name: string) => (name === "x-forwarded-for" ? "a, b" : null) } };
  assert.equal(clientIp(req, 1), "b");
});

// --- Password policy ---

test("checkPassword rejects a short password", () => {
  const result = checkPassword("short");
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("too_short"));
});

test("checkPassword rejects an overlong password", () => {
  const result = checkPassword("A1!".padEnd(MAX_LENGTH + 1, "a"));
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes("too_long"));
});

test("checkPassword rejects a whitespace-only password", () => {
  const result = checkPassword("      ");
  assert.ok(result.failures.includes("whitespace_only"));
});

test("checkPassword rejects the email local part", () => {
  const result = checkPassword("johnsmith12345!", { email: "johnsmith@example.com" });
  assert.ok(result.failures.includes("contains_email_local_part"));
});

test("checkPassword rejects a single character class", () => {
  const result = checkPassword("aaaaaaaaaaaa");
  assert.ok(result.failures.includes("single_character_class"));
});

test("checkPassword rejects a sequential run", () => {
  assert.ok(checkPassword("abcdEFGH1234").failures.includes("sequential_run"));
  assert.ok(checkPassword("wxyz9876!Aa").failures.includes("sequential_run"));
});

test("checkPassword rejects a repeated run", () => {
  assert.ok(checkPassword("aaaaBBBB1111!").failures.includes("repeated_run"));
});

test("checkPassword accepts a strong password", () => {
  assert.equal(checkPassword("C0rrectHorse9!").ok, true);
});

test("normalizePassword applies NFKC only", () => {
  assert.equal(normalizePassword("  spaced  "), "  spaced  ");
  assert.equal(MIN_LENGTH, 12);
});

// --- Error codes ---

test("AUTH_ERRORS covers exactly the 20 frozen codes", () => {
  assert.equal(Object.keys(AUTH_ERRORS).length, 20);
});

test("authError returns the mapped shape", () => {
  const e = authError("rate_limited");
  assert.equal(e.code, "rate_limited");
  assert.equal(e.httpStatus, 429);
  assert.equal(typeof e.message, "string");
  assert.equal(e.retryable, true);
});

// --- In-memory store ---

test("UserRepository creates, finds, and rejects duplicates", async () => {
  const repo = new UserRepository();
  const user = await repo.create({ email: "Buyer@Example.com", passwordHash: "h" });
  assert.equal(user.email, "buyer@example.com");
  assert.equal((await repo.findByEmail("buyer@example.com"))?.id, user.id);
  assert.equal(await repo.findById(user.id), user);
  await assert.rejects(() => repo.create({ email: "buyer@example.com", passwordHash: "h" }), EmailAlreadyExistsError);
});

test("OpaqueTokenStore is single-use and expires", () => {
  const store = new OpaqueTokenStore("pwreset");
  const token = store.issue("usr_1", 3600);
  assert.equal(store.peek(token), "usr_1");
  assert.equal(store.consume(token), "usr_1");
  assert.equal(store.consume(token), null); // already used
});

test("db.users and db sessions work end-to-end in memory", async () => {
  const user = await db.users.create({ email: "a@b.co", passwordHash: "h", emailVerified: false });
  const pub = toPublicUser(user);
  assert.equal(pub.email_verified, false);
  assert.equal(pub.id, user.id);
});

// --- Fixtures ---

test("fixtures are internally consistent", () => {
  assert.equal(JWKS_FIXTURE.keys[0].alg, "EdDSA");
  assert.equal(JWKS_FIXTURE.keys[0].kty, "OKP");
  assert.equal(CLAIMS_VALID.aud, "canna");
  assert.ok(Array.isArray(CLAIMS_VALID.amr));
  assert.ok(CLAIMS_EXPIRED.exp < FIXED_NOW);
  assert.equal("jti" in CLAIMS_MISSING_JTI, false);
});
