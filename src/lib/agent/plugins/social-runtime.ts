import { TwitterClient } from "@/lib/social/twitter";
import { FacebookClient, InstagramClient } from "@/lib/social/meta";
import type { SocialClient } from "@/lib/social/types";

type PlatformName = "twitter" | "facebook" | "instagram";

type SocialPluginDeps = {
  getClient: (platform: PlatformName) => SocialClient;
};

const defaultDeps: SocialPluginDeps = {
  getClient(platform) {
    switch (platform) {
      case "twitter":
        return new TwitterClient();
      case "facebook":
        return new FacebookClient();
      case "instagram":
        return new InstagramClient();
    }
  },
};

let currentDeps: SocialPluginDeps = defaultDeps;

export function getSocialPluginDeps(): SocialPluginDeps {
  return currentDeps;
}

export function setSocialPluginTestDeps(overrides: Partial<SocialPluginDeps>): void {
  currentDeps = { ...defaultDeps, ...overrides };
}

export function resetSocialPluginTestDeps(): void {
  currentDeps = defaultDeps;
}