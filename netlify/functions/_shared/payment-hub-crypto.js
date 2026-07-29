import crypto from "node:crypto";

function encryptionKey(keyMaterial) {
  if (!keyMaterial) return null;
  return crypto.createHash("sha256").update(String(keyMaterial)).digest();
}

/** Encrypt provider OAuth/access tokens — never store raw PAN/card data. */
export function encryptProviderToken(plaintext, keyMaterial) {
  if (!plaintext || !keyMaterial) return null;
  const key = encryptionKey(keyMaterial);
  if (!key) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decryptProviderToken(ciphertext, keyMaterial) {
  if (!ciphertext || !keyMaterial) return "";
  const buffer = Buffer.isBuffer(ciphertext) ? ciphertext : Buffer.from(ciphertext);
  if (buffer.length < 29) return "";
  const key = encryptionKey(keyMaterial);
  if (!key) return "";
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

export function tokenKeyMaterial(env = process.env) {
  return env.PAYMENT_HUB_TOKEN_KEY || env.MARKETPLACE_TAX_ENCRYPTION_KEY || null;
}
