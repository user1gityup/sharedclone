# CONTRACT — `users` identity service

This document is the single source of truth for the cross-repo session-token
contract. `canna` and `commerce` each keep their **own** verifier implementation
(no shared package) and must implement from this document exactly. Where this
document and anything else differ, this document wins for token signing, claim
names, endpoints, key material, and verification.

---

## 1. Signing algorithm

- All signed tokens use **EdDSA over Ed25519**.
- JOSE header `alg` MUST be exactly `EdDSA`.
- JOSE header `typ` MUST be `JWT`.
- JOSE header `kid` MUST be present and equal to the `kid` of the public JWK the
  verifier selects.
- Signing input is the ASCII bytes of `base64url(header) + "." + base64url(payload)`.
- `users` holds the **private** key and is the only service that can mint a token.
- Storefronts verify with the **public** key from `users`' JWKS endpoint.
- **RS256 and any shared symmetric secret are rejected.** Verifiers MUST reject a
  token whose `alg` is not exactly `EdDSA`, and any JWK whose `kty` is not `OKP`
  with `crv` `Ed25519`.

---

## 2. Key material

### 2.1 Private key

- `users` holds exactly one active Ed25519 private key.
- Format: PKCS#8 PEM, supplied at runtime as `SESSION_PRIVATE_KEY_PEM`.
- The private key never appears in a JWT, JWKS, response body, log, repository,
  client bundle, or any file shipped to a storefront. It never leaves `users`.

### 2.2 Public key

- The public key is derived from the active private key and published only through
  the JWKS endpoint.
- Each public JWK MUST have this shape:

```json
{
  "kty": "OKP",
  "crv": "Ed25519",
  "x": "<base64url-encoded 32-byte public key>",
  "kid": "<opaque key id>",
  "use": "sig",
  "alg": "EdDSA"
}
```

- `x` is the base64url-encoded raw 32-byte Ed25519 public key.
- `kid` is an opaque string chosen by `users`; it changes when the key changes.
- The JWKS MAY return more than one key during rotation. Verifiers select the key
  whose `kid` matches the token header's `kid`.

---

## 3. Issuer and audience

- `iss` MUST be the stable URL configured for the service, supplied by
  `SESSION_ISSUER` and embedded verbatim in every signed token.
- Storefronts compare `iss` against their own configured expected issuer and reject
  on mismatch.
- `aud` MUST be a single string — the storefront/client identifier the token was
  minted for, for example `canna` or `commerce` (default `storefront`).
- A storefront rejects a token whose `aud` does not equal its registered audience.

---

## 4. Token claims

### 4.1 Required claims (every signed token)

| Claim | Type | Rule |
|---|---|---|
| `sub` | string | Opaque stable user id assigned by `users` (e.g. `usr_...`). |
| `iss` | string | Exact configured issuer URL. |
| `aud` | string | Single audience/client identifier. |
| `iat` | integer | NumericDate, seconds since epoch, issuance time. |
| `exp` | integer | NumericDate, seconds since epoch; invalid after this time. |
| `jti` | string | Opaque unique token id, used for revocation/introspection. |
| `amr` | string[] | Authentication methods satisfied (see §4.3). |

### 4.2 Optional claims

| Claim | Type | Rule |
|---|---|---|
| `email` | string | User's email address. |
| `email_verified` | boolean | True when the address has been verified. |
| `name` | string | Display name. |
| `picture` | string | HTTPS URL to the user's avatar. |
| `sid` | string | Session identifier tying access + refresh together. |
| `ver` | integer | Token/session version. |
| `scope` | string | Space-separated scopes authorized for the token. |
| `auth_time` | integer | NumericDate of the original authentication event. |
| `nonce` | string | Opaque value supplied by a storefront during OAuth. |

### 4.3 `amr` values

- `pwd` — password authentication.
- `totp` — TOTP second factor satisfied.
- `backup` — backup recovery code used.
- `oauth` — OAuth sign-in (Google/Meta).
- `email_verification` — email ownership confirmed (informational; carried only
  alongside a primary method).

---

## 5. Token types

### 5.1 Access token

- Signed EdDSA JWT. Lifetime **15 minutes** (`SESSION_TTL_SECONDS`, default 900).
- Sent as `Authorization: Bearer <accessToken>`.
- Carries the claims in §4; short lifetime carries the ordinary authorization case.

### 5.2 ID token

- Signed EdDSA JWT, issued after login/registration/refresh/TOTP/OAuth completion.
- Carries profile claims plus `auth_time` (and `nonce` when supplied).

### 5.3 Opaque tokens (NOT signed, never verified by storefronts)

| Token | Format | Lifetime |
|---|---|---|
| Refresh token | 256-bit random bytes, base64url, no padding | 30 days, rotated on use |
| Password reset token | random one-time token | 1 hour |
| TOTP challenge token | random one-time token | 5 minutes |
| OAuth `state` | random one-time token | 10 minutes |
| Email verification token | random one-time token | 24 hours |

---

## 6. Endpoints

All request and response bodies are JSON unless stated otherwise.

| Method | Path | Purpose |
|---|---|---|
| GET | `/.well-known/jwks.json` | Public verification keys. |
| POST | `/session` | Issue a session (email/password), or return a TOTP challenge. |
| POST | `/session/refresh` | Rotate a refresh token and issue new tokens. |
| POST | `/session/revoke` | Revoke a session by refresh token. |
| GET | `/introspect` | Revocation/liveness check for a bearer token. |
| POST | `/register` | Create an account and issue tokens. |
| GET | `/me` | Current bearer token's user claims. |
| POST | `/email-verification/request` | Send a verification link. |
| POST | `/email-verification/confirm` | Confirm a verification token. |
| POST | `/password-reset/request` | Request a password reset. |
| POST | `/password-reset/confirm` | Confirm a reset token and set a new password. |
| POST | `/totp/setup` | Enroll TOTP and return secret + recovery codes. |
| POST | `/totp/verify` | Verify a TOTP/backup code for a pending login. |
| GET | `/oauth/google` | Begin Google OAuth. |
| GET | `/oauth/google/callback` | Complete Google OAuth. |
| GET | `/oauth/meta` | Begin Meta OAuth. |
| GET | `/oauth/meta/callback` | Complete Meta OAuth. |

### 6.1 `POST /session`

Request:

```json
{ "email": "buyer@example.com", "password": "user-chosen-password", "aud": "canna" }
```

`email` and `password` are required; `aud` is optional (default `storefront`).

Response `200 OK`:

```json
{
  "user": { "id": "usr_1", "email": "buyer@example.com", "email_verified": true, "name": null, "picture": null },
  "tokens": {
    "accessToken": "<eddsa-jwt>",
    "refreshToken": "<opaque>",
    "idToken": "<eddsa-jwt>",
    "expiresIn": 900,
    "tokenType": "Bearer"
  }
}
```

If the account has TOTP enabled and the password is valid, response `401`:

```json
{ "error": "totp_required", "challengeToken": "<opaque-one-time-token>" }
```

Invalid credentials: `401` `{ "error": "invalid_credentials", ... }` — never reveal
whether the email exists.

### 6.2 `POST /session/refresh`

Request `{ "refreshToken": "<opaque>" }`. Response `200 OK` with a new
`accessToken`, `idToken`, `refreshToken`, `expiresIn`, `tokenType`. The old refresh
token is revoked when rotation succeeds.

### 6.3 `POST /session/revoke`

Request `{ "refreshToken": "<opaque>" }`. Response `204 No Content`.

### 6.4 `GET /introspect`

Header `Authorization: Bearer <accessToken>`. Response `200 OK`:

```json
{ "active": true, "sub": "usr_1", "aud": "canna", "exp": 1700000000, "amr": ["pwd","totp"] }
```

An invalid, expired, or revoked token returns `{ "active": false }` (HTTP 200).

### 6.5 `POST /register`

Request `{ "email", "password", "name?", "picture?" }`. Enforces the password
policy (§10). Response `201 Created` with the same `user` + `tokens` shape as
`/session`. A duplicate email returns `409` `{ "error": "email_taken", ... }`.

### 6.6 `GET /me`

Bearer access token required. Returns the token's user claims (§4), for example
`{ "sub", "email", "email_verified", "name", "picture" }`.

### 6.7 `GET /.well-known/jwks.json`

Public. Response `200 OK`:

```json
{ "keys": [ { "kty": "OKP", "crv": "Ed25519", "x": "<base64url>", "kid": "<kid>", "use": "sig", "alg": "EdDSA" } ] }
```

With `Cache-Control: public, max-age=300`.

### 6.8 Email verification / password reset

- `POST /email-verification/request` — `{ "email" }`; always `202 Accepted` (no
  account enumeration).
- `POST /email-verification/confirm` — `{ "token" }`; `204` on success, `400`/`410`
  on invalid/expired.
- `POST /password-reset/request` — `{ "email" }`; always `202 Accepted`.
- `POST /password-reset/confirm` — `{ "token", "newPassword" }`; `204` on success,
  `400`/`410` on invalid/expired. Enforces the password policy.

### 6.9 `POST /totp/setup`

Bearer access token required. Response `200 OK`:

```json
{ "secret": "<base32>", "otpauthUrl": "otpauth://totp/users:usr_1?secret=...&issuer=users", "recoveryCodes": ["XXXXX-XXXXX", "..."] }
```

Recovery codes are shown once and stored only as irreversible hashes.

### 6.10 `POST /totp/verify`

Request `{ "challengeToken": "<opaque-from-login>", "code": "123456" }` (a six-digit
TOTP code, or a recovery code). Response `200 OK` with the `user` + `tokens` shape.
Invalid challenge/code: `401`.

### 6.11 OAuth

- `GET /oauth/google` and `GET /oauth/meta` build the provider authorization URL
  with a fresh `state` and `302` redirect to it (or `503` if the provider is not
  configured).
- `GET /oauth/google/callback` and `GET /oauth/meta/callback` validate `state`,
  exchange the `code`, resolve-or-create the user (match by verified email, else
  create), and issue tokens (`302` redirect carrying tokens in the URL fragment when
  a `redirect_uri` is registered, else `200` JSON).

---

## 7. Storefront verification procedure

1. Fetch the JWKS from `GET /.well-known/jwks.json` over HTTPS and cache it.
2. Decode the JWT header and payload without trusting them.
3. Require header `alg: "EdDSA"`, `typ: "JWT"`, and a present `kid`.
4. Select the JWK whose `kid` matches; reject if absent.
5. Reject if the JWK is not `OKP`/`Ed25519`.
6. Base64url-decode `x` to the raw 32-byte public key.
7. Verify the Ed25519 signature over `base64url(header) + "." + base64url(payload)`.
8. Reject on signature failure.
9. Validate claims: `iss` equals configured issuer; `aud` equals the storefront's
   audience; `exp > now`; `iat <= now + 60s` leeway; `jti` present and non-empty;
   `amr` present (array); if `nonce` present it equals the supplied nonce.
10. For sensitive actions, call `GET /introspect` to confirm the token is not revoked.

---

## 8. Error shape

Non-success JSON responses use:

```json
{ "error": "machine-readable-code", "error_description": "Human-readable explanation." }
```

Machine-readable codes are frozen in `src/lib/errorCodes.ts` (e.g.
`invalid_credentials`, `totp_required`, `rate_limited`, `oauth_state_mismatch`).

---

## 9. Prohibitions and clock skew

- The only allowed JWT signing algorithm is EdDSA Ed25519.
- Storefronts need no secret material; they trust only the public JWKS.
- `users` exposes no private key material through any endpoint.
- Verifiers SHOULD allow a maximum clock skew of 60 seconds for `exp`, `iat`.

---

## 10. Password policy (frozen)

`MIN_LENGTH = 12`, `MAX_LENGTH = 256`. A password is rejected when it is too short,
too long, whitespace-only, contains the email local part, uses a single character
class, contains a 4+ sequential run (`abcd`, `4321`), or a 4+ repeated run. Passwords
are NFKC-normalized before checks. See `src/lib/passwordPolicy.ts`.
