"use client";

import { useEffect } from "react";

export default function AgentHeartbeatServiceBoot() {
  useEffect(() => {
    let cancelled = false;

    async function ensureService(): Promise<void> {
      try {
        await fetch("/api/agent/heartbeat/service", {
          method: "POST",
          cache: "no-store",
        });
      } catch {
        if (cancelled) {
          return;
        }
      }
    }

    void ensureService();
    const intervalId = window.setInterval(() => {
      void ensureService();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return null;
}