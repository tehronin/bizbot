"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface ApprovalsResponse {
  approvals?: Array<{ id: string }>;
}

const NAV = [
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/posts", label: "Posts", icon: "📝" },
  { href: "/approvals", label: "Approvals", icon: "✅" },
  { href: "/analytics", label: "Analytics", icon: "📊" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((d: ApprovalsResponse) => setPendingCount(d.approvals?.length ?? 0))
      .catch(() => {});
  }, [pathname]);

  return (
    <aside
      className="w-52 shrink-0 flex flex-col h-screen sticky top-0"
      style={{ background: "var(--bg-surface)", borderRight: "1px solid var(--border)" }}
    >
      <div className="px-5 py-4" style={{ borderBottom: "1px solid var(--border-sub)" }}>
        <span className="text-sm font-semibold tracking-widest uppercase" style={{ color: "var(--accent)" }}>
          BizBot
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
        {NAV.map(({ href, label, icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors"
              style={
                active
                  ? { background: "var(--accent-glow)", color: "var(--accent)", borderLeft: "2px solid var(--accent)" }
                  : { color: "var(--text-muted)", borderLeft: "2px solid transparent" }
              }
              onMouseEnter={(e) => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!active) (e.currentTarget as HTMLAnchorElement).style.background = "";
              }}
            >
              <span className="opacity-60 text-xs">{icon}</span>
              <span className="flex-1 tracking-wide">{label}</span>
              {label === "Approvals" && pendingCount > 0 && (
                <span
                  className="ml-auto text-xs font-bold px-1.5 py-0.5"
                  style={{ background: "var(--danger)", color: "#f0f0f0" }}
                >
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3" style={{ borderTop: "1px solid var(--border-sub)", color: "var(--text-muted)", fontSize: "11px", letterSpacing: "0.05em" }}>
        local agent
      </div>
    </aside>
  );
}
