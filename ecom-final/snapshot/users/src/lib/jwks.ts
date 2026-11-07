/**
 * JWKS service: publishes the public signing key(s) for storefront verification.
 */
import { jwkFromPublicKey } from "./crypto";
import { getSigningKey } from "./keys";

export interface JwksKey {
  kty: string;
  crv: string;
  x: string;
  kid: string;
  use: string;
  alg: string;
}

export interface JwksResponse {
  keys: JwksKey[];
}

export function getJwks(): JwksResponse {
  const key = getSigningKey();
  return { keys: [jwkFromPublicKey(key.publicKeyPem, key.keyId)] };
}
