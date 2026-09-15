import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function decodeBase64Url(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`Encrypted secret ${label} is invalid`);
  }

  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value) {
    throw new Error(`Encrypted secret ${label} is invalid`);
  }
  return decoded;
}

export class SecretBox {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("Creator encryption key must be exactly 32 bytes");
    }
  }

  encrypt(plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [
      VERSION,
      nonce.toString("base64url"),
      tag.toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(value: string): string {
    const parts = value.split(".");
    if (parts.length !== 4) {
      throw new Error("Encrypted secret is invalid");
    }

    const [version, nonceValue, tagValue, ciphertextValue] = parts;
    if (
      version !== VERSION ||
      !nonceValue ||
      !tagValue ||
      !ciphertextValue
    ) {
      throw new Error("Encrypted secret is invalid");
    }

    const nonce = decodeBase64Url(nonceValue, "nonce");
    const tag = decodeBase64Url(tagValue, "tag");
    const ciphertext = decodeBase64Url(ciphertextValue, "ciphertext");
    if (nonce.length !== 12 || tag.length !== 16 || ciphertext.length === 0) {
      throw new Error("Encrypted secret is invalid");
    }

    const decipher = createDecipheriv(
      ALGORITHM,
      this.key,
      nonce,
    );
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
  }
}

export function decodeEncryptionKey(encoded: string): Buffer {
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error(
      "CREATOR_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
    );
  }
  return key;
}
