"use client";

import { Suspense, useEffect, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

const FIRST_RUN_AUTO_OPEN_KEY = "bizbot:first-run-setup-auto-opened";

interface AgenticSetupBootResponse {
  state: {
    isFirstRun: boolean;
  };
}

function ChatPageContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const setupOpen = searchParams.get("setup") === "1";
  const closeSetupHref = useMemo(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("setup");
    return params.toString() ? `${pathname}?${params.toString()}` : pathname;
  }, [pathname, searchParams]);

  useEffect(() => {
    if (setupOpen) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    if (window.sessionStorage.getItem(FIRST_RUN_AUTO_OPEN_KEY) === "1") {
      return;
    }

    fetch("/api/agentic-setup")
      .then((response) => response.json() as Promise<AgenticSetupBootResponse>)
      .then((data) => {
        if (!data.state.isFirstRun) {
          return;
        }

        window.sessionStorage.setItem(FIRST_RUN_AUTO_OPEN_KEY, "1");
        const params = new URLSearchParams(searchParams.toString());
        params.set("setup", "1");
        const nextPath = params.toString() ? `${pathname}?${params.toString()}` : `${pathname}?setup=1`;
        window.location.replace(nextPath);
      })
      .catch(() => {});
  }, [pathname, searchParams, setupOpen]);

  return <ChatWorkspace setupOpen={setupOpen} closeSetupHref={closeSetupHref} />;
}

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="h-full" />}>
      <ChatPageContent />
    </Suspense>
  );
}
