import { db } from "@/lib/db";

export interface CreeperCompanyProfileSummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  sourceCount: number;
  planCount: number;
  runCount: number;
  latestRunAt: string | null;
}

export interface UpsertCreeperCompanyBriefInput {
  companyProfileId?: string;
  companyName?: string;
  businessDescription: string;
  desiredOutcomes?: string[];
  includeDomains?: string[];
  excludeDomains?: string[];
  timeHorizon?: string | null;
  importantConcepts?: string[];
  notes?: string | null;
}

function normalizeNonEmpty(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new Error(`${field} is required.`);
  }

  return normalized;
}

function normalizeOptionalList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function slugifyCompanyName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function buildSummary(input: {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  _count: { sources: number; ingestionPlans: number; retrievalAudits: number };
  ingestionRuns: Array<{ createdAt: Date }>;
}): CreeperCompanyProfileSummary {
  return {
    id: input.id,
    name: input.name,
    slug: input.slug,
    description: input.description,
    status: input.status,
    sourceCount: input._count.sources,
    planCount: input._count.ingestionPlans,
    runCount: input._count.retrievalAudits,
    latestRunAt: input.ingestionRuns[0]?.createdAt?.toISOString() ?? null,
  };
}

function getCompanyProfileDelegate(): {
  findMany: typeof db.companyProfile.findMany;
  findUnique: typeof db.companyProfile.findUnique;
  update: typeof db.companyProfile.update;
  upsert: typeof db.companyProfile.upsert;
} | null {
  const delegate = (db as typeof db & {
    companyProfile?: {
      findMany?: typeof db.companyProfile.findMany;
      findUnique?: typeof db.companyProfile.findUnique;
      update?: typeof db.companyProfile.update;
      upsert?: typeof db.companyProfile.upsert;
    };
  }).companyProfile;

  if (!delegate?.findMany || !delegate.findUnique || !delegate.update || !delegate.upsert) {
    return null;
  }

  return {
    findMany: delegate.findMany,
    findUnique: delegate.findUnique,
    update: delegate.update,
    upsert: delegate.upsert,
  };
}

export async function listCreeperCompanyProfiles(limit = 24): Promise<CreeperCompanyProfileSummary[]> {
  const companyProfile = getCompanyProfileDelegate();
  if (!companyProfile) {
    return [];
  }

  const rows = await companyProfile.findMany({
    orderBy: [
      { updatedAt: "desc" },
      { createdAt: "desc" },
    ],
    take: Math.max(1, Math.min(limit, 24)),
    include: {
      _count: {
        select: {
          sources: true,
          ingestionPlans: true,
          retrievalAudits: true,
        },
      },
      ingestionPlans: {
        select: {
          runs: {
            select: {
              createdAt: true,
            },
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 1,
      },
    },
  });

  return rows.map((row) => buildSummary({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    _count: row._count,
    ingestionRuns: row.ingestionPlans.flatMap((plan) => plan.runs),
  }));
}

export async function getCreeperCompanyProfile(profileId: string) {
  const normalizedProfileId = normalizeNonEmpty(profileId, "companyProfileId");
  const companyProfile = getCompanyProfileDelegate();
  if (!companyProfile) {
    throw new Error("Creeper company profiles are unavailable in the current runtime.");
  }

  const profile = await companyProfile.findUnique({
    where: { id: normalizedProfileId },
    include: {
      sources: {
        include: {
          source: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      ingestionPlans: {
        orderBy: [
          { updatedAt: "desc" },
          { createdAt: "desc" },
        ],
        take: 5,
      },
    },
  });

  if (!profile) {
    throw new Error(`Unknown company profile '${normalizedProfileId}'.`);
  }

  return profile;
}

export async function upsertCreeperCompanyBrief(input: UpsertCreeperCompanyBriefInput) {
  const companyProfile = getCompanyProfileDelegate();
  if (!companyProfile) {
    throw new Error("Creeper company profiles are unavailable in the current runtime.");
  }

  const businessDescription = normalizeNonEmpty(input.businessDescription, "businessDescription");
  const desiredOutcomes = normalizeOptionalList(input.desiredOutcomes);
  const includeDomains = normalizeOptionalList(input.includeDomains);
  const excludeDomains = normalizeOptionalList(input.excludeDomains);
  const importantConcepts = normalizeOptionalList(input.importantConcepts);
  const timeHorizon = input.timeHorizon?.trim() || null;
  const notes = input.notes?.trim() || null;

  const existingProfile = input.companyProfileId
    ? await companyProfile.findUnique({ where: { id: input.companyProfileId } })
    : null;

  const companyName = existingProfile?.name
    ?? normalizeNonEmpty(input.companyName, "companyName");
  const slug = existingProfile?.slug ?? slugifyCompanyName(companyName);

  if (!slug) {
    throw new Error("companyName must contain at least one alphanumeric character.");
  }

  const retrievalConfig = {
    onboardingStatus: "brief_defined",
    desiredOutcomes,
    includeDomains,
    excludeDomains,
    timeHorizon,
    notes,
  };

  const ontologyConfig = {
    businessDescription,
    importantConcepts,
  };

  const profile = existingProfile
    ? await companyProfile.update({
      where: { id: existingProfile.id },
      data: {
        name: companyName,
        description: businessDescription,
        status: "ONBOARDING",
        retrievalConfig,
        ontologyConfig,
      },
    })
    : await companyProfile.upsert({
      where: { slug },
      update: {
        name: companyName,
        description: businessDescription,
        status: "ONBOARDING",
        retrievalConfig,
        ontologyConfig,
      },
      create: {
        name: companyName,
        slug,
        description: businessDescription,
        status: "ONBOARDING",
        retrievalConfig,
        ontologyConfig,
      },
    });

  return profile;
}
