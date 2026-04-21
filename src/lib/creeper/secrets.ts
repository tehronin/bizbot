import crypto from "node:crypto";
import { db } from "@/lib/db";
import { readEnv, writeEnv } from "@/lib/env";

const CREEPER_SECRET_MASTER_KEY_ENV = "BIZBOT_CREEPER_SECRET_MASTER_KEY";
const RUNTIME_SECRET_MASTER_KEY_ENV = "BIZBOT_SECRET_MASTER_KEY";
const CREEPER_ENCRYPTION_KEY_VERSION = 1;

interface StoredEncryptedSecret {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
}

function deriveKey(masterKey: string): Buffer {
  return crypto.createHash("sha256").update(masterKey).digest();
}

function ensureMasterKey(): string {
  const env = readEnv();
  const existing = process.env[CREEPER_SECRET_MASTER_KEY_ENV]
    ?? env[CREEPER_SECRET_MASTER_KEY_ENV]
    ?? process.env[RUNTIME_SECRET_MASTER_KEY_ENV]
    ?? env[RUNTIME_SECRET_MASTER_KEY_ENV];

  if (existing && existing.trim().length > 0) {
    process.env[CREEPER_SECRET_MASTER_KEY_ENV] = existing;
    return existing;
  }

  const generated = crypto.randomBytes(32).toString("base64url");
  writeEnv({ [CREEPER_SECRET_MASTER_KEY_ENV]: generated });
  process.env[CREEPER_SECRET_MASTER_KEY_ENV] = generated;
  return generated;
}

function encryptSourcePassword(sourceId: string, password: string): StoredEncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(ensureMasterKey()), iv);
  cipher.setAAD(Buffer.from(sourceId, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updatedAt: new Date().toISOString(),
  };
}

function decryptSourcePassword(sourceId: string, payload: StoredEncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(ensureMasterKey()),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(sourceId, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);

  return plaintext.toString("utf8");
}

export async function upsertExternalDataSourcePassword(sourceId: string, password: string): Promise<void> {
  await db.externalDataSourceSecret.upsert({
    where: { sourceId },
    update: {
      encryptedPassword: JSON.stringify(encryptSourcePassword(sourceId, password)),
      encryptionKeyVersion: CREEPER_ENCRYPTION_KEY_VERSION,
    },
    create: {
      sourceId,
      encryptedPassword: JSON.stringify(encryptSourcePassword(sourceId, password)),
      encryptionKeyVersion: CREEPER_ENCRYPTION_KEY_VERSION,
    },
  });
}

export async function getExternalDataSourcePassword(sourceId: string): Promise<string> {
  const record = await db.externalDataSourceSecret.findUnique({
    where: { sourceId },
    select: { encryptedPassword: true },
  });

  if (!record?.encryptedPassword) {
    throw new Error("Stored source credentials were not found.");
  }

  const payload = JSON.parse(record.encryptedPassword) as StoredEncryptedSecret;
  return decryptSourcePassword(sourceId, payload);
}

export function getCreeperEncryptionKeyVersion(): number {
  return CREEPER_ENCRYPTION_KEY_VERSION;
}
