import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike } from "jose";

import { verifyToken, __resetJwksCacheForTests } from "../../src/lib/auth.ts";

const KID = "test-key-1";
const ISSUER = "http://localhost:3001";
const AUDIENCE = "commerce";

let server: Server;
let jwksUrl: string;
let privateKey: KeyLike;

before(async () => {
  const { publicKey, privateKey: priv } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
  privateKey = priv;

  const jwk = await exportJWK(publicKey);
  jwk.kid = KID;
  jwk.alg = "EdDSA";
  jwk.use = "sig";

  server = createServer((req, res) => {
    if (req.url === "/.well-known/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  jwksUrl = `http://127.0.0.1:${port}/.well-known/jwks.json`;

  process.env.USERS_JWKS_URL = jwksUrl;
  process.env.USERS_ISSUER = ISSUER;
  process.env.USERS_AUDIENCE = AUDIENCE;
  __resetJwksCacheForTests();
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function signValidToken(claimOverrides: Record<string, unknown> = {}) {
  return new SignJWT({ amr: ["pwd"], ...claimOverrides })
    .setProtectedHeader({ alg: "EdDSA", kid: KID })
    .setSubject("usr_123")
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti("jti_valid")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey);
}

describe("JWKS session verification (USERS-CONTRACT.md)", () => {
  it("accepts a valid EdDSA token and extracts claims", async () => {
    const token = await signValidToken();
    const result = await verifyToken(token);
    assert.strictEqual(result.sub, "usr_123");
    assert.deepStrictEqual(result.amr, ["pwd"]);
    assert.strictEqual(result.jti, "jti_valid");
  });

  it("rejects a token signed with a non-EdDSA algorithm", async () => {
    const secret = new TextEncoder().encode("test-only-placeholder-secret-value");
    const token = await new SignJWT({ amr: ["pwd"] })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("usr_123")
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setJti("jti_hs256")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(secret);

    await assert.rejects(() => verifyToken(token));
  });

  it("rejects an expired token", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ amr: ["pwd"] })
      .setProtectedHeader({ alg: "EdDSA", kid: KID })
      .setSubject("usr_123")
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setJti("jti_expired")
      .setIssuedAt(nowSeconds - 3600)
      .setExpirationTime(nowSeconds - 1800)
      .sign(privateKey);

    await assert.rejects(() => verifyToken(token), /exp/i);
  });

  it("rejects a token missing required claims (no jti)", async () => {
    const token = await new SignJWT({ amr: ["pwd"] })
      .setProtectedHeader({ alg: "EdDSA", kid: KID })
      .setSubject("usr_123")
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    await assert.rejects(() => verifyToken(token), /jti/i);
  });

  it("handles an unreachable JWKS endpoint without crashing", async () => {
    const token = await signValidToken({ jti_marker: "unreachable-case" });

    process.env.USERS_JWKS_URL = "http://127.0.0.1:1/.well-known/jwks.json";
    __resetJwksCacheForTests();

    await assert.rejects(() => verifyToken(token));

    // restore for isolation from any other test file sharing this process
    process.env.USERS_JWKS_URL = jwksUrl;
    __resetJwksCacheForTests();
  });
});
