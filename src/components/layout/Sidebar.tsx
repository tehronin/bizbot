"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useDashboardShellState } from "@/components/layout/DashboardShellStateProvider";

const BIZBOT_PLUGINS_CHANGED_EVENT = "bizbot:plugins-changed";

interface PluginCatalogResponse {
  builtin: {
    installed: Array<{ id: string }>;
  };
}

const NAV = [
  { href: "/chat", label: "Chat", icon: "💬" },
  { href: "/builder", label: "Builder", icon: "🏗️", pluginIds: ["builder"] },
  { href: "/inbox", label: "Inbox", icon: "✉️", pluginIds: ["social"] },
  { href: "/leads", label: "Leads", icon: "🧭", pluginIds: ["crm"] },
  { href: "/commerce", label: "Commerce", icon: "🧾", pluginIds: ["commerce"] },
  { href: "/posts", label: "Posts", icon: "📝", pluginIds: ["social", "schedule", "approval"] },
  { href: "/local-business", label: "Local Business", icon: "⭐", pluginIds: ["local-business"] },
  { href: "/approvals", label: "Approvals", icon: "✅", pluginIds: ["approval"] },
  { href: "/analytics", label: "Analytics", icon: "📊", pluginIds: ["social"] },
  { href: "/operations", label: "Operations", icon: "🛠", pluginIds: ["developer"] },
  { href: "/plugins", label: "Plugins", icon: "🧩" },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { pendingApprovalCount } = useDashboardShellState();
  const [enabledPlugins, setEnabledPlugins] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadPlugins = () => {
      fetch("/api/plugins")
        .then((r) => r.json() as Promise<PluginCatalogResponse>)
        .then((catalog) => {
          if (!cancelled) {
            setEnabledPlugins(new Set((catalog.builtin.installed ?? []).map((entry) => entry.id)));
          }
        })
        .catch(() => {});
    };

    loadPlugins();
    window.addEventListener(BIZBOT_PLUGINS_CHANGED_EVENT, loadPlugins);

    return () => {
      cancelled = true;
      window.removeEventListener(BIZBOT_PLUGINS_CHANGED_EVENT, loadPlugins);
    };
  }, []);

  const visibleNav = NAV.filter((entry) => {
    if (!entry.pluginIds || enabledPlugins === null) {
      return true;
    }

    return entry.pluginIds.some((pluginId) => enabledPlugins.has(pluginId));
  });

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
        {visibleNav.map(({ href, label, icon }) => {
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
              {label === "Approvals" && pendingApprovalCount > 0 && (
                <span
                  className="ml-auto text-[9px] font-bold px-1.5 py-0.5 bg-danger text-white"
                >
                  {pendingApprovalCount}
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
