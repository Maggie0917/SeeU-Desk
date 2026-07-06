import "server-only";

import crypto from "node:crypto";

function getEncryptionKey() {
  const secret = process.env.APP_ENCRYPTION_SECRET || process.env.AUTH_SECRET || "dev-encryption-secret-change-me";
  // TODO: 生产环境必须设置独立且足够长的 APP_ENCRYPTION_SECRET，不能依赖开发默认值。
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptSecret(plainText: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(payload: string) {
  const [version, ivText, tagText, encryptedText] = payload.split(".");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("不支持的加密密文格式");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}
