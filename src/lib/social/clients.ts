import { PlatformType } from "@prisma/client";
import { TwitterClient } from "@/lib/social/twitter";
import { FacebookClient, InstagramClient } from "@/lib/social/meta";
import type { SocialClient } from "@/lib/social/types";

export type SupportedPlatformName = "twitter" | "facebook" | "instagram";

export function getSocialClient(platform: SupportedPlatformName): SocialClient {
  switch (platform) {
    case "twitter":
      return new TwitterClient();
    case "facebook":
      return new FacebookClient();
    case "instagram":
      return new InstagramClient();
  }
}

export function getSocialClientForPlatformType(platformType: PlatformType): SocialClient {
  switch (platformType) {
    case PlatformType.TWITTER:
      return new TwitterClient();
    case PlatformType.FACEBOOK:
      return new FacebookClient();
    case PlatformType.INSTAGRAM:
      return new InstagramClient();
  }
}

export function getPlatformNameForType(platformType: PlatformType): SupportedPlatformName {
  switch (platformType) {
    case PlatformType.TWITTER:
      return "twitter";
    case PlatformType.FACEBOOK:
      return "facebook";
    case PlatformType.INSTAGRAM:
      return "instagram";
  }
}