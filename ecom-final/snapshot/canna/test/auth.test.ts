import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import {
  verifyEdDsaToken,
  TokenVerificationError,
  hasTwoFactor,
} from "../src/lib/auth.ts";

async function makeFixture() {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  const jwks = { keys: [{ ...jwk, use: "sig", alg: "EdDSA" }] };
  const sign = (payload: Record<string, unknown>, opts: { alg?: string; kid?: string } = {}) =>
    new SignJWT(payload)
      .setProtectedHeader({
        alg: opts.alg ?? "EdDSA",
        typ: "JWT",
        kid: opts.kid ?? "test-key-1",
      })
      .setIssuer("https://users.example")
      .setAudience("canna")
      .setIssuedAt()
      .setExpirationTime("15m")
      .sign(privateKey);
  return { jwks, sign };
}

test("verifies a valid EdDSA token and returns claims", async () => {
  const { jwks, sign } = await makeFixture();
  const token = await sign({ sub: "usr_1", amr: ["pwd", "totp"], jti: "jti_1" });
  const claims = await verifyEdDsaToken(token, jwks, {
    issuer: "https://users.example",
    audience: "canna",
  });
  assert.equal(claims.sub, "usr_1");
  assert.equal(claims.jti, "jti_1");
  assert.equal(hasTwoFactor(claims), true);
});

test("rejects any alg other than EdDSA", async () => {
  const { jwks } = await makeFixture();
  // Sign a structurally-valid token with an RSA key and alg RS256; the verifier
  // must reject it on the header alg before ever attempting signature checks.
  const { privateKey } = await generateKeyPair("RS256");
  const token = await new SignJWT({ sub: "usr_1", amr: ["pwd"], jti: "jti_1" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: "test-key-1" })
    .setIssuer("https://users.example")
    .setAudience("canna")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(privateKey);
  await assert.rejects(
    () => verifyEdDsaToken(token, jwks, { issuer: "https://users.example", audience: "canna" }),
    (err: unknown) => err instanceof TokenVerificationError && err.code === "unsupported_alg",
  );
});

test("rejects a wrong audience", async () => {
  const { jwks, sign } = await makeFixture();
  const token = await sign({ sub: "usr_1", amr: ["pwd"], jti: "jti_1" });
  await assert.rejects(
    () => verifyEdDsaToken(token, jwks, { issuer: "https://users.example", audience: "commerce" }),
    TokenVerificationError,
  );
});

test("rejects a token signed by a different key", async () => {
  const { jwks, sign } = await makeFixture();
  const other = await generateKeyPair("EdDSA");
  const forged = await new SignJWT({ sub: "usr_1", amr: ["pwd"], jti: "jti_1" })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: "test-key-1" })
    .setIssuer("https://users.example")
    .setAudience("canna")
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(other.privateKey);
  await assert.rejects(
    () => verifyEdDsaToken(forged, jwks, { issuer: "https://users.example", audience: "canna" }),
    TokenVerificationError,
  );
});

test("rejects an expired token", async () => {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA");
  const jwk = await exportJWK(publicKey);
  jwk.kid = "test-key-1";
  const jwks = { keys: [{ ...jwk, use: "sig", alg: "EdDSA" }] };
  const token = await new SignJWT({ sub: "usr_1", amr: ["pwd"], jti: "jti_1" })
    .setProtectedHeader({ alg: "EdDSA", typ: "JWT", kid: "test-key-1" })
    .setIssuer("https://users.example")
    .setAudience("canna")
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
    .sign(privateKey);
  await assert.rejects(
    () => verifyEdDsaToken(token, jwks, { issuer: "https://users.example", audience: "canna" }),
    TokenVerificationError,
  );
});
