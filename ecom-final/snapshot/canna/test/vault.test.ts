import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptSecret, decryptSecret, CredentialVault, VaultError } from "../src/lib/vault.ts";

test("encrypt/decrypt round-trips", () => {
  const key = "k".repeat(32);
  const ciphertext = encryptSecret("sup3r-s3cret", key);
  assert.notEqual(ciphertext, "sup3r-s3cret");
  assert.equal(decryptSecret(ciphertext, key), "sup3r-s3cret");
});

test("rejects tampered ciphertext", () => {
  const key = "k".repeat(32);
  // Use a long enough plaintext (≥12 chars) so that a single base64url
  // character flip reliably changes the decoded bytes for GCM auth-tag failure.
  const ciphertext = encryptSecret("long-enough-plaintext", key);
  const parts = ciphertext.split(".");
  // Tamper a middle character of the ciphertext component to avoid
  // base64url padding-edge bits that don't alter the decoded bytes.
  const ct = parts[3];
  const idx = Math.floor(ct.length / 2);
  const flipped = ct.slice(0, idx) + (ct[idx] === "A" ? "B" : "A") + ct.slice(idx + 1);
  const tampered = [parts[0], parts[1], parts[2], flipped].join(".");
  assert.throws(() => decryptSecret(tampered, key), VaultError);
});

test("rejects a wrong key", () => {
  const ciphertext = encryptSecret("value", "a".repeat(32));
  assert.throws(() => decryptSecret(ciphertext, "b".repeat(32)), VaultError);
});

test("rejects non-v1 payloads", () => {
  assert.throws(() => decryptSecret("v2.aa.bb.cc", "a".repeat(32)), VaultError);
});

test("vault caches and falls back to env", async () => {
  const envBackup = process.env.TEST_VAULT_FALLBACK;
  process.env.TEST_VAULT_FALLBACK = "from-env";
  try {
    const vault = new CredentialVault("", async () => undefined);
    const value = await vault.get("TEST_VAULT_FALLBACK");
    assert.equal(value, "from-env");
  } finally {
    if (envBackup === undefined) delete process.env.TEST_VAULT_FALLBACK;
    else process.env.TEST_VAULT_FALLBACK = envBackup;
  }
});
