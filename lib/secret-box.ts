import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "./config";

/**
 * 通用密文盒子:与 lib/api-keys.ts 同款 aes-256-gcm + sha256(AUTH_SECRET) 派生密钥,
 * 用于把单条敏感字符串(如提示词优化的独立 API Key)加密存进 app_settings。
 * 注意:AUTH_SECRET 变更会导致旧密文无法解密。
 */
const CIPHER_ALGORITHM = "aes-256-gcm";

export type SecretCipher = {
  iv: string;
  tag: string;
  ciphertext: string;
};

function encryptionKey() {
  return createHash("sha256").update(config.authSecret).digest();
}

export function encryptSecret(value: string): SecretCipher {
  const iv = randomBytes(12);
  const cipher = createCipheriv(CIPHER_ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: encrypted.toString("base64url")
  };
}

export function decryptSecret(value: SecretCipher): string {
  const decipher = createDecipheriv(CIPHER_ALGORITHM, encryptionKey(), Buffer.from(value.iv, "base64url"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

export function isSecretCipher(value: unknown): value is SecretCipher {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.iv === "string" && typeof record.tag === "string" && typeof record.ciphertext === "string";
}

export function previewSecret(value: string): string {
  if (value.length <= 8) return "****";
  return `${value.slice(0, 3)}...${value.slice(-4)}`;
}
