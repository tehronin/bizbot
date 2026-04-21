import {
  ExternalDataSourceStatus,
  ExternalDataSourceType,
} from "@prisma/client";
import { db } from "@/lib/db";
import {
  getCreeperEncryptionKeyVersion,
  getExternalDataSourcePassword,
  upsertExternalDataSourcePassword,
} from "@/lib/creeper/secrets";
import {
  CREEPER_POSTGRES_SSL_MODES,
  type CreeperMaskedConnectionSummary,
  type CreeperPostgresSslMode,
} from "@/lib/creeper/types";

export interface RegisterCreeperSourceInput {
  companyName?: string;
  companyProfileId?: string;
  sourceLabel: string;
  host: string;
  port?: number;
  database: string;
  username: string;
  password: string;
  sslMode?: CreeperPostgresSslMode;
  sslRejectUnauthorized?: boolean;
  allowedSchemas?: string[];
  notes?: string;
}

export interface CreeperConnectedSource {
  source: Awaited<ReturnType<typeof db.externalDataSource.findUniqueOrThrow>>;
  companyProfileId: string;
  password: string;
}

function normalizeNonEmpty(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }

  return normalized;
}

function normalizePort(port: number | undefined): number {
  if (port === undefined) {
    return 5432;
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Port must be an integer between 1 and 65535.");
  }
  return port;
}

export function normalizeSslMode(value: string | undefined): CreeperPostgresSslMode {
  if (!value) {
    return "require";
  }

  const normalized = value.trim().toLowerCase();
  if (CREEPER_POSTGRES_SSL_MODES.includes(normalized as CreeperPostgresSslMode)) {
    return normalized as CreeperPostgresSslMode;
  }

  throw new Error(`Unsupported sslMode '${value}'.`);
}

export function normalizeAllowedSchemas(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const unique = new Set<string>();
  for (const schema of input) {
    const normalized = schema.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }

  return [...unique].sort((left, right) => left.localeCompare(right));
}

function slugifyCompanyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export function buildMaskedConnectionSummary(source: {
  label: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  sslMode: string;
  sslRejectUnauthorized: boolean;
  metadata: unknown;
}): CreeperMaskedConnectionSummary {
  const metadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
    ? source.metadata as { allowedSchemas?: unknown }
    : {};

  return {
    label: source.label,
    host: source.host,
    port: source.port,
    database: source.databaseName,
    username: source.username,
    sslMode: normalizeSslMode(source.sslMode),
    sslRejectUnauthorized: source.sslRejectUnauthorized,
    allowedSchemas: normalizeAllowedSchemas(Array.isArray(metadata.allowedSchemas) ? metadata.allowedSchemas as string[] : []),
  };
}

export async function registerCreeperSource(input: RegisterCreeperSourceInput): Promise<{
  sourceId: string;
  companyProfileId: string;
  connectionSummary: CreeperMaskedConnectionSummary;
  status: ExternalDataSourceStatus;
}> {
  const sourceLabel = normalizeNonEmpty(input.sourceLabel, "sourceLabel");
  const host = normalizeNonEmpty(input.host, "host");
  const database = normalizeNonEmpty(input.database, "database");
  const username = normalizeNonEmpty(input.username, "username");
  const password = normalizeNonEmpty(input.password, "password");
  const port = normalizePort(input.port);
  const sslMode = normalizeSslMode(input.sslMode);
  const allowedSchemas = normalizeAllowedSchemas(input.allowedSchemas);

  const result = await db.$transaction(async (tx) => {
    const explicitProfileId = input.companyProfileId?.trim() || null;
    const companyName = explicitProfileId
      ? null
      : normalizeNonEmpty(input.companyName ?? "", "companyName");
    const slug = companyName ? slugifyCompanyName(companyName) : null;

    if (!explicitProfileId && !slug) {
      throw new Error("companyName must contain at least one alphanumeric character.");
    }

    const companyProfile = explicitProfileId
      ? await tx.companyProfile.findUnique({ where: { id: explicitProfileId } })
      : slug
        ? await tx.companyProfile.upsert({
          where: { slug },
          update: {
            name: companyName!,
            status: "ACTIVE",
          },
          create: {
            name: companyName!,
            slug,
            status: "ACTIVE",
          },
        })
        : null;

    if (!companyProfile) {
      throw new Error(`Unknown company profile '${explicitProfileId}'.`);
    }

    const existingBindings = await tx.companyProfileSource.findMany({
      where: { companyProfileId: companyProfile.id },
      select: { isPrimary: true },
    });

    const source = await tx.externalDataSource.create({
      data: {
        type: ExternalDataSourceType.POSTGRES,
        label: sourceLabel,
        host,
        port,
        databaseName: database,
        username,
        sslMode,
        sslRejectUnauthorized: input.sslRejectUnauthorized ?? sslMode.startsWith("verify"),
        notes: input.notes?.trim() || null,
        status: ExternalDataSourceStatus.PENDING,
        metadata: {
          allowedSchemas,
        },
      },
    });

    await tx.companyProfileSource.create({
      data: {
        companyProfileId: companyProfile.id,
        sourceId: source.id,
        isPrimary: existingBindings.length === 0,
        role: "primary",
      },
    });

    return {
      companyProfileId: companyProfile.id,
      source,
    };
  });

  await upsertExternalDataSourcePassword(result.source.id, password);

  return {
    sourceId: result.source.id,
    companyProfileId: result.companyProfileId,
    connectionSummary: buildMaskedConnectionSummary(result.source),
    status: result.source.status,
  };
}

export async function getCreeperConnectedSource(sourceId: string): Promise<CreeperConnectedSource> {
  const normalizedSourceId = normalizeNonEmpty(sourceId, "sourceId");
  const source = await db.externalDataSource.findUnique({
    where: { id: normalizedSourceId },
    include: {
      companyProfiles: {
        include: {
          companyProfile: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!source) {
    throw new Error(`Unknown source '${normalizedSourceId}'.`);
  }

  const binding = source.companyProfiles.find((entry) => entry.isPrimary) ?? source.companyProfiles[0];
  if (!binding) {
    throw new Error("Source is not attached to a company profile.");
  }

  const password = await getExternalDataSourcePassword(source.id);
  return {
    source,
    companyProfileId: binding.companyProfileId,
    password,
  };
}

export async function updateCreeperSourceStatus(
  sourceId: string,
  status: ExternalDataSourceStatus,
  timestamps?: { lastTestedAt?: Date | null; lastProfiledAt?: Date | null },
): Promise<void> {
  await db.externalDataSource.update({
    where: { id: sourceId },
    data: {
      status,
      ...(timestamps?.lastTestedAt !== undefined ? { lastTestedAt: timestamps.lastTestedAt } : {}),
      ...(timestamps?.lastProfiledAt !== undefined ? { lastProfiledAt: timestamps.lastProfiledAt } : {}),
    },
  });
}

export function getCreeperSecretKeyVersion(): number {
  return getCreeperEncryptionKeyVersion();
}
