"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface ApprovalsResponse {
  approvals?: Array<{ id: string }>;
}

const NAV = [
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/builder", label: "Builder", icon: "🏗️" },
  { href: "/inbox", label: "Inbox", icon: "✉️" },
  { href: "/leads", label: "Leads", icon: "🧭" },
  { href: "/commerce", label: "Commerce", icon: "🧾" },
  { href: "/posts", label: "Posts", icon: "📝" },
  { href: "/local-business", label: "Local Business", icon: "⭐" },
  { href: "/approvals", label: "Approvals", icon: "✅" },
  { href: "/analytics", label: "Analytics", icon: "📊" },
  { href: "/operations", label: "Operations", icon: "🛠" },
  { href: "/plugins", label: "Plugins", icon: "🧩" },
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
      className="w-48 shrink-0 flex flex-col h-screen sticky top-0 bg-surface border-r border-border"
    >
      <div className="h-14 flex items-center px-5 border-b border-border">
        <span className="font-black text-sm tracking-tight text-accent">
          BIZBOT
        </span>
      </div>
      <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
        {NAV.map(({ href, label, icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 font-mono text-[10px] tracking-widest uppercase transition-colors border-l-2 ${
                active
                  ? "bg-accent-glow text-accent border-accent"
                  : "text-dim border-transparent hover:bg-hover hover:text-primary"
              }`}
            >
              <span className="opacity-60 text-[10px]">{icon}</span>
              <span className="flex-1">{label}</span>
              {label === "Approvals" && pendingCount > 0 && (
                <span
                  className="ml-auto text-[9px] font-bold px-1.5 py-0.5 bg-danger text-white"
                >
                  {pendingCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-3 font-mono text-[9px] uppercase tracking-widest border-t border-border text-muted">
        local agent
      </div>
    </aside>
  );
}
