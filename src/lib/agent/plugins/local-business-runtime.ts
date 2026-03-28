import { db } from "@/lib/db";
import {
  createGoogleBusinessPost,
  getGoogleBusinessDashboard,
  isGoogleBusinessConfigured,
  replyToGoogleBusinessReview,
  syncGoogleBusinessPosts,
  syncGoogleBusinessReviews,
  updateGoogleBusinessHours,
} from "@/lib/google-business/service";

type LocalBusinessPluginDeps = {
  isConfigured: typeof isGoogleBusinessConfigured;
  getDashboard: typeof getGoogleBusinessDashboard;
  syncReviews: typeof syncGoogleBusinessReviews;
  syncPosts: typeof syncGoogleBusinessPosts;
  listReviews: typeof db.googleBusinessReview.findMany;
  replyReview: typeof replyToGoogleBusinessReview;
  createPost: typeof createGoogleBusinessPost;
  updateHours: typeof updateGoogleBusinessHours;
};

const defaultDeps: LocalBusinessPluginDeps = {
  isConfigured: isGoogleBusinessConfigured,
  getDashboard: getGoogleBusinessDashboard,
  syncReviews: syncGoogleBusinessReviews,
  syncPosts: syncGoogleBusinessPosts,
  listReviews: db.googleBusinessReview.findMany.bind(db.googleBusinessReview),
  replyReview: replyToGoogleBusinessReview,
  createPost: createGoogleBusinessPost,
  updateHours: updateGoogleBusinessHours,
};

let currentDeps: LocalBusinessPluginDeps = defaultDeps;

export function getLocalBusinessPluginDeps(): LocalBusinessPluginDeps {
  return currentDeps;
}

export function setLocalBusinessPluginTestDeps(overrides: Partial<LocalBusinessPluginDeps>): void {
  currentDeps = { ...defaultDeps, ...overrides };
}

export function resetLocalBusinessPluginTestDeps(): void {
  currentDeps = defaultDeps;
}