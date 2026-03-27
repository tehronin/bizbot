import axios, { type AxiosRequestConfig } from "axios";
import { GoogleBusinessPostStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const GOOGLE_MY_BUSINESS_BASE_URL = "https://mybusiness.googleapis.com";
const GOOGLE_BUSINESS_INFO_BASE_URL = "https://mybusinessbusinessinformation.googleapis.com";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

interface GoogleBusinessConfig {
  oauthClientId: string;
  oauthClientSecret: string;
  refreshToken: string;
  accountName: string;
  locationName: string;
  infoLocationName: string | null;
}

interface AccessTokenCache {
  accessToken: string;
  expiresAt: number;
}

const globalForGoogleBusiness = globalThis as typeof globalThis & {
  googleBusinessAccessTokenCache?: AccessTokenCache;
};

interface GoogleReviewPayload {
  name: string;
  reviewId: string;
  reviewer?: {
    displayName?: string;
    profilePhotoUrl?: string;
  };
  starRating?: "ONE" | "TWO" | "THREE" | "FOUR" | "FIVE" | "STAR_RATING_UNSPECIFIED";
  comment?: string;
  reviewReply?: {
    comment?: string;
    updateTime?: string;
  };
  createTime?: string;
  updateTime?: string;
}

interface GoogleLocalPostPayload {
  name?: string;
  summary?: string;
  searchUrl?: string;
  topicType?: string;
  state?: "LIVE" | "PROCESSING" | "REJECTED" | "LOCAL_POST_STATE_UNSPECIFIED";
  callToAction?: {
    actionType?: string;
    url?: string;
  };
  event?: object;
  offer?: object;
  createTime?: string;
  updateTime?: string;
}

interface GoogleHoursInput {
  periods: Array<{
    openDay: string;
    openTime: string;
    closeDay: string;
    closeTime: string;
  }>;
}

export interface GoogleBusinessPostInput {
  summary: string;
  topicType?: string;
  actionType?: string;
  callToActionUrl?: string;
  eventData?: object;
  offerData?: object;
}

function getGoogleBusinessConfig(): GoogleBusinessConfig | null {
  const oauthClientId = process.env.GOOGLE_BUSINESS_CLIENT_ID?.trim();
  const oauthClientSecret = process.env.GOOGLE_BUSINESS_CLIENT_SECRET?.trim();
  const refreshToken = process.env.GOOGLE_BUSINESS_REFRESH_TOKEN?.trim();
  const accountName = process.env.GOOGLE_BUSINESS_ACCOUNT_NAME?.trim();
  const locationName = process.env.GOOGLE_BUSINESS_LOCATION_NAME?.trim();
  const infoLocationName = process.env.GOOGLE_BUSINESS_INFO_LOCATION_NAME?.trim() ?? null;

  if (!oauthClientId || !oauthClientSecret || !refreshToken || !accountName || !locationName) {
    return null;
  }

  return {
    oauthClientId,
    oauthClientSecret,
    refreshToken,
    accountName,
    locationName,
    infoLocationName,
  };
}

function assertConfig(): GoogleBusinessConfig {
  const config = getGoogleBusinessConfig();
  if (!config) {
    throw new Error("Google Business Profile is not configured. Set GOOGLE_BUSINESS_CLIENT_ID, GOOGLE_BUSINESS_CLIENT_SECRET, GOOGLE_BUSINESS_REFRESH_TOKEN, GOOGLE_BUSINESS_ACCOUNT_NAME, and GOOGLE_BUSINESS_LOCATION_NAME.");
  }

  return config;
}

async function getGoogleBusinessAccessToken(config: GoogleBusinessConfig): Promise<string> {
  const cached = globalForGoogleBusiness.googleBusinessAccessTokenCache;
  const now = Date.now();
  if (cached && cached.expiresAt > now + 60_000) {
    return cached.accessToken;
  }

  const payload = new URLSearchParams({
    client_id: config.oauthClientId,
    client_secret: config.oauthClientSecret,
    refresh_token: config.refreshToken,
    grant_type: "refresh_token",
  });

  const response = await axios.post<{
    access_token: string;
    expires_in?: number;
  }>(GOOGLE_OAUTH_TOKEN_URL, payload.toString(), {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const accessToken = response.data.access_token;
  const expiresInSeconds = response.data.expires_in ?? 3600;
  globalForGoogleBusiness.googleBusinessAccessTokenCache = {
    accessToken,
    expiresAt: now + expiresInSeconds * 1000,
  };

  return accessToken;
}

async function toAuthConfig(config: GoogleBusinessConfig): Promise<AxiosRequestConfig> {
  const accessToken = await getGoogleBusinessAccessToken(config);
  return {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  };
}

function starRatingToNumber(value: GoogleReviewPayload["starRating"]): number {
  switch (value) {
    case "ONE":
      return 1;
    case "TWO":
      return 2;
    case "THREE":
      return 3;
    case "FOUR":
      return 4;
    case "FIVE":
      return 5;
    default:
      return 0;
  }
}

async function ensureLocation(config: GoogleBusinessConfig) {
  return db.googleBusinessLocation.upsert({
    where: { locationName: config.locationName },
    update: {
      accountName: config.accountName,
      infoLocationName: config.infoLocationName,
      syncEnabled: true,
    },
    create: {
      accountName: config.accountName,
      locationName: config.locationName,
      infoLocationName: config.infoLocationName,
      title: config.locationName,
      syncEnabled: true,
    },
  });
}

export function isGoogleBusinessConfigured(): boolean {
  return getGoogleBusinessConfig() !== null;
}

export async function syncGoogleBusinessReviews() {
  const config = assertConfig();
  const location = await ensureLocation(config);
  const authConfig = await toAuthConfig(config);
  const response = await axios.get<{ reviews?: GoogleReviewPayload[] }>(
    `${GOOGLE_MY_BUSINESS_BASE_URL}/v4/${config.locationName}/reviews`,
    authConfig,
  );

  const reviews = response.data.reviews ?? [];
  await Promise.all(
    reviews.map((review) =>
      db.googleBusinessReview.upsert({
        where: {
          locationId_reviewId: {
            locationId: location.id,
            reviewId: review.reviewId,
          },
        },
        update: {
          resourceName: review.name,
          reviewerName: review.reviewer?.displayName ?? null,
          reviewerPhotoUrl: review.reviewer?.profilePhotoUrl ?? null,
          starRating: starRatingToNumber(review.starRating),
          comment: review.comment ?? null,
          reviewReply: review.reviewReply?.comment ?? null,
          reviewReplyUpdatedAt: review.reviewReply?.updateTime ? new Date(review.reviewReply.updateTime) : null,
          createTime: review.createTime ? new Date(review.createTime) : new Date(),
          updateTime: review.updateTime ? new Date(review.updateTime) : new Date(),
          syncedAt: new Date(),
          needsResponse: !review.reviewReply?.comment && starRatingToNumber(review.starRating) < 5,
        },
        create: {
          locationId: location.id,
          resourceName: review.name,
          reviewId: review.reviewId,
          reviewerName: review.reviewer?.displayName ?? null,
          reviewerPhotoUrl: review.reviewer?.profilePhotoUrl ?? null,
          starRating: starRatingToNumber(review.starRating),
          comment: review.comment ?? null,
          reviewReply: review.reviewReply?.comment ?? null,
          reviewReplyUpdatedAt: review.reviewReply?.updateTime ? new Date(review.reviewReply.updateTime) : null,
          createTime: review.createTime ? new Date(review.createTime) : new Date(),
          updateTime: review.updateTime ? new Date(review.updateTime) : new Date(),
          syncedAt: new Date(),
          needsResponse: !review.reviewReply?.comment && starRatingToNumber(review.starRating) < 5,
        },
      }),
    ),
  );

  await db.googleBusinessLocation.update({
    where: { id: location.id },
    data: { lastSyncAt: new Date() },
  });

  return db.googleBusinessReview.findMany({
    where: { locationId: location.id },
    orderBy: { updateTime: "desc" },
  });
}

export async function syncGoogleBusinessPosts() {
  const config = assertConfig();
  const location = await ensureLocation(config);
  const authConfig = await toAuthConfig(config);
  const response = await axios.get<{ localPosts?: GoogleLocalPostPayload[] }>(
    `${GOOGLE_MY_BUSINESS_BASE_URL}/v4/${config.locationName}/localPosts`,
    authConfig,
  );

  const posts = response.data.localPosts ?? [];
  await Promise.all(
    posts.map((post) =>
      db.googleBusinessPost.upsert({
        where: { resourceName: post.name ?? `${location.id}-${post.summary ?? "post"}` },
        update: {
          summary: post.summary ?? "",
          topicType: post.topicType ?? "STANDARD",
          actionType: post.callToAction?.actionType ?? null,
          callToActionUrl: post.callToAction?.url ?? null,
          searchUrl: post.searchUrl ?? null,
          ...(post.event ? { eventData: post.event } : { eventData: Prisma.DbNull }),
          ...(post.offer ? { offerData: post.offer } : { offerData: Prisma.DbNull }),
          status:
            post.state === "LIVE"
              ? GoogleBusinessPostStatus.PUBLISHED
              : post.state === "REJECTED"
                ? GoogleBusinessPostStatus.FAILED
                : GoogleBusinessPostStatus.DRAFT,
          publishedAt: post.createTime ? new Date(post.createTime) : null,
          error: post.state === "REJECTED" ? "Rejected by Google Business Profile." : null,
        },
        create: {
          locationId: location.id,
          resourceName: post.name ?? `${location.id}-${post.summary ?? "post"}`,
          summary: post.summary ?? "",
          topicType: post.topicType ?? "STANDARD",
          actionType: post.callToAction?.actionType ?? null,
          callToActionUrl: post.callToAction?.url ?? null,
          searchUrl: post.searchUrl ?? null,
          ...(post.event ? { eventData: post.event } : {}),
          ...(post.offer ? { offerData: post.offer } : {}),
          status:
            post.state === "LIVE"
              ? GoogleBusinessPostStatus.PUBLISHED
              : post.state === "REJECTED"
                ? GoogleBusinessPostStatus.FAILED
                : GoogleBusinessPostStatus.DRAFT,
          publishedAt: post.createTime ? new Date(post.createTime) : null,
          error: post.state === "REJECTED" ? "Rejected by Google Business Profile." : null,
        },
      }),
    ),
  );

  await db.googleBusinessLocation.update({
    where: { id: location.id },
    data: { lastSyncAt: new Date() },
  });

  return db.googleBusinessPost.findMany({
    where: { locationId: location.id },
    orderBy: { createdAt: "desc" },
  });
}

export async function getGoogleBusinessDashboard(syncRemote = false) {
  if (syncRemote && isGoogleBusinessConfigured()) {
    await Promise.all([syncGoogleBusinessReviews(), syncGoogleBusinessPosts()]);
  }

  const location = await db.googleBusinessLocation.findFirst({
    orderBy: { updatedAt: "desc" },
    include: {
      reviews: {
        orderBy: { updateTime: "desc" },
        take: 25,
      },
      posts: {
        orderBy: { createdAt: "desc" },
        take: 25,
      },
    },
  });

  return {
    configured: isGoogleBusinessConfigured(),
    location,
  };
}

export async function replyToGoogleBusinessReview(id: string, comment: string) {
  const config = assertConfig();
  const authConfig = await toAuthConfig(config);
  const review = await db.googleBusinessReview.findUnique({
    where: { id },
    include: { location: true },
  });

  if (!review) {
    throw new Error(`Google business review not found: ${id}`);
  }

  await axios.put(
    `${GOOGLE_MY_BUSINESS_BASE_URL}/v4/${review.resourceName}/reply`,
    { comment },
    authConfig,
  );

  return db.googleBusinessReview.update({
    where: { id },
    data: {
      reviewReply: comment,
      reviewReplyUpdatedAt: new Date(),
      needsResponse: false,
      syncedAt: new Date(),
    },
  });
}

export async function createGoogleBusinessPost(input: GoogleBusinessPostInput) {
  const config = assertConfig();
  const location = await ensureLocation(config);
  const authConfig = await toAuthConfig(config);
  const payload = {
    languageCode: "en",
    summary: input.summary,
    topicType: input.topicType ?? "STANDARD",
    ...(input.actionType || input.callToActionUrl
      ? {
          callToAction: {
            actionType: input.actionType ?? "LEARN_MORE",
            ...(input.callToActionUrl ? { url: input.callToActionUrl } : {}),
          },
        }
      : {}),
    ...(input.eventData ? { event: input.eventData } : {}),
    ...(input.offerData ? { offer: input.offerData } : {}),
  };

  const response = await axios.post<GoogleLocalPostPayload>(
    `${GOOGLE_MY_BUSINESS_BASE_URL}/v4/${config.locationName}/localPosts`,
    payload,
    authConfig,
  );

  const created = response.data;
  return db.googleBusinessPost.create({
    data: {
      locationId: location.id,
      resourceName: created.name ?? null,
      summary: created.summary ?? input.summary,
      topicType: created.topicType ?? input.topicType ?? "STANDARD",
      actionType: created.callToAction?.actionType ?? input.actionType ?? null,
      callToActionUrl: created.callToAction?.url ?? input.callToActionUrl ?? null,
      searchUrl: created.searchUrl ?? null,
      ...(input.eventData ? { eventData: input.eventData } : {}),
      ...(input.offerData ? { offerData: input.offerData } : {}),
      status: created.state === "LIVE" ? GoogleBusinessPostStatus.PUBLISHED : GoogleBusinessPostStatus.DRAFT,
      publishedAt: created.createTime ? new Date(created.createTime) : new Date(),
    },
  });
}

export async function updateGoogleBusinessHours(hours: GoogleHoursInput) {
  const config = assertConfig();
  const authConfig = await toAuthConfig(config);
  if (!config.infoLocationName) {
    throw new Error("GOOGLE_BUSINESS_INFO_LOCATION_NAME is required to update business hours.");
  }

  const location = await ensureLocation(config);
  await axios.patch(
    `${GOOGLE_BUSINESS_INFO_BASE_URL}/v1/${config.infoLocationName}?updateMask=regularHours`,
    {
      name: config.infoLocationName,
      regularHours: {
        periods: hours.periods,
      },
    },
    authConfig,
  );

  return db.googleBusinessLocation.update({
    where: { id: location.id },
    data: {
      regularHours: {
        periods: hours.periods.map((period) => ({
          openDay: period.openDay,
          openTime: period.openTime,
          closeDay: period.closeDay,
          closeTime: period.closeTime,
        })),
      },
      lastSyncAt: new Date(),
    },
  });
}