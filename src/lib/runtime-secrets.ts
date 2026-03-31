import crypto from "node:crypto";
import { db } from "@/lib/db";
import { readEnv, writeEnv } from "@/lib/env";

const SECRET_STORE_PREFIX = "secret_store:";
const SECRET_MASTER_KEY_ENV = "BIZBOT_SECRET_MASTER_KEY";

interface StoredEncryptedSecret {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
}

const MANAGED_SECRET_ENV_KEYS = [
  "GOOGLE_AI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "MINIMAX_API_KEY",
  "GOOGLE_BUSINESS_CLIENT_ID",
  "GOOGLE_BUSINESS_CLIENT_SECRET",
  "GOOGLE_BUSINESS_REFRESH_TOKEN",
  "META_ACCESS_TOKEN",
  "META_WEBHOOK_VERIFY_TOKEN",
  "TWITTER_APP_KEY",
  "TWITTER_APP_SECRET",
  "TWITTER_CLIENT_ID",
  "TWITTER_CLIENT_SECRET",
  "TWITTER_ACCESS_TOKEN",
  "TWITTER_ACCESS_TOKEN_SECRET",
  "HUBSPOT_PRIVATE_APP_TOKEN",
  "MCP_AUTH_TOKEN",
  "MEMGRAPH_PASSWORD",
] as const;

export type ManagedSecretEnvKey = typeof MANAGED_SECRET_ENV_KEYS[number];

const globalForRuntimeSecrets = globalThis as typeof globalThis & {
  bizbotRuntimeSecretCache?: Map<string, string>;
};

function getSecretCache(): Map<string, string> {
  if (!globalForRuntimeSecrets.bizbotRuntimeSecretCache) {
    globalForRuntimeSecrets.bizbotRuntimeSecretCache = new Map<string, string>();
  }
  return globalForRuntimeSecrets.bizbotRuntimeSecretCache;
}

function getSecretSettingKey(key: string): string {
  return `${SECRET_STORE_PREFIX}${key}`;
}

function getEnvSnapshot(): Record<string, string> {
  const fileEnv = readEnv();
  const processEnv = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  return { ...fileEnv, ...processEnv };
}

function deriveKey(masterKey: string): Buffer {
  return crypto.createHash("sha256").update(masterKey).digest();
}

function ensureSecretMasterKey(): string {
  const existing = process.env[SECRET_MASTER_KEY_ENV] ?? readEnv()[SECRET_MASTER_KEY_ENV];
  if (existing && existing.trim().length > 0) {
    process.env[SECRET_MASTER_KEY_ENV] = existing;
    return existing;
  }

  const generated = crypto.randomBytes(32).toString("base64url");
  writeEnv({ [SECRET_MASTER_KEY_ENV]: generated });
  process.env[SECRET_MASTER_KEY_ENV] = generated;
  return generated;
}

function encryptSecret(key: string, value: string): StoredEncryptedSecret {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey(ensureSecretMasterKey()), iv);
  cipher.setAAD(Buffer.from(key, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updatedAt: new Date().toISOString(),
  };
}

function decryptSecret(key: string, payload: StoredEncryptedSecret): string {
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    deriveKey(ensureSecretMasterKey()),
    Buffer.from(payload.iv, "base64"),
  );
  decipher.setAAD(Buffer.from(key, "utf8"));
  decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

export function isManagedSecretEnvKey(key: string): key is ManagedSecretEnvKey {
  return MANAGED_SECRET_ENV_KEYS.includes(key as ManagedSecretEnvKey);
}

export function isEncryptedSecretSettingKey(key: string): boolean {
  return key.startsWith(SECRET_STORE_PREFIX);
}

export function filterVisibleSettings<T extends { key: string }>(settings: T[]): T[] {
  return settings.filter((setting) => !isEncryptedSecretSettingKey(setting.key));
}

export async function saveEncryptedSecrets(env: Record<string, string>): Promise<void> {
  const cache = getSecretCache();
  const entries = Object.entries(env).filter(
    (entry): entry is [ManagedSecretEnvKey, string] => isManagedSecretEnvKey(entry[0]) && entry[1].trim().length > 0,
  );

  if (entries.length === 0) {
    return;
  }

  await Promise.all(
    entries.map(([key, value]) =>
      db.setting.upsert({
        where: { key: getSecretSettingKey(key) },
        update: { value: JSON.stringify(encryptSecret(key, value)) },
        create: { key: getSecretSettingKey(key), value: JSON.stringify(encryptSecret(key, value)) },
      }).then(() => {
        cache.set(key, value);
      }),
    ),
  );
}

export async function getSecretValue(key: ManagedSecretEnvKey): Promise<string | undefined> {
  const snapshot = getEnvSnapshot();
  const direct = snapshot[key]?.trim();
  if (direct) {
    getSecretCache().set(key, direct);
    return direct;
  }

  const cache = getSecretCache();
  if (cache.has(key)) {
    return cache.get(key);
  }

  const record = await db.setting.findUnique({ where: { key: getSecretSettingKey(key) }, select: { value: true } });
  if (!record?.value) {
    return undefined;
  }

  try {
    const payload = JSON.parse(record.value) as StoredEncryptedSecret;
    const decrypted = decryptSecret(key, payload);
    cache.set(key, decrypted);
    return decrypted;
  } catch {
    return undefined;
  }
}

export async function hasSecretValue(key: ManagedSecretEnvKey): Promise<boolean> {
  const value = await getSecretValue(key);
  return typeof value === "string" && value.trim().length > 0;
}

export function getSecretValueSync(key: ManagedSecretEnvKey): string | undefined {
  const snapshot = getEnvSnapshot();
  const direct = snapshot[key]?.trim();
  if (direct) {
    getSecretCache().set(key, direct);
    return direct;
  }

  return getSecretCache().get(key);
}

export function hasSecretValueSync(key: ManagedSecretEnvKey): boolean {
  const value = getSecretValueSync(key);
  return typeof value === "string" && value.trim().length > 0;
}