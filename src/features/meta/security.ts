import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function encryptionKey(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("INTEGRATION_ENCRYPTION_KEY must be 64 hexadecimal characters.");
  return Buffer.from(value, "hex");
}

/** Context authenticates both the secret's purpose and the page it belongs to. */
export function encryptSecret(secret: string, key: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(key), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptSecret(envelope: string, key: string, context: string) {
  const [version, iv, tag, data, extra] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !data || extra) throw new Error("Invalid encrypted credential.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(key), Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

export function constantTimeEqual(value: string, expected: string) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyMetaSignature(body: Uint8Array, signature: string | null, appSecret: string) {
  if (!signature || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = createHmac("sha256", appSecret).update(body).digest("hex");
  return constantTimeEqual(signature.slice(7), expected);
}
