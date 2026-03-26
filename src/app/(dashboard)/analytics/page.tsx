"use client";

import { useEffect, useState } from "react";

interface Snapshot {
  id: string;
  likes: number;
  replies: number;
  shares: number;
  impressions: number;
  clicks: number;
  capturedAt: string;
}

export default function AnalyticsPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);

  useEffect(() => {
    fetch("/api/analytics")
      .then((res) => res.json() as Promise<{ snapshots: Snapshot[] }>)
      .then((data) => setSnapshots(data.snapshots ?? []))
      .catch(() => {});
  }, []);

  const totals = snapshots.reduce(
    (acc, snapshot) => ({
      likes: acc.likes + snapshot.likes,
      replies: acc.replies + snapshot.replies,
      shares: acc.shares + snapshot.shares,
      impressions: acc.impressions + snapshot.impressions,
      clicks: acc.clicks + snapshot.clicks,
    }),
    { likes: 0, replies: 0, shares: 0, impressions: 0, clicks: 0 },
  );

  return (
    <div className="grid gap-4 md:grid-cols-5">
      {Object.entries(totals).map(([key, value]) => (
        <section key={key} className="border p-4" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
          <div className="text-[10px] uppercase tracking-[0.24em] mb-3" style={{ color: "var(--text-muted)" }}>{key}</div>
          <div className="text-2xl" style={{ color: "var(--accent)" }}>{value}</div>
        </section>
      ))}
      <section className="border p-4 md:col-span-5" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>snapshots</div>
        <div className="space-y-2 text-sm">
          {snapshots.map((snapshot) => (
            <div key={snapshot.id} className="grid grid-cols-6 gap-2 border-b pb-2" style={{ borderColor: "var(--border-sub)" }}>
              <span>{new Date(snapshot.capturedAt).toLocaleDateString()}</span>
              <span>{snapshot.impressions} imp</span>
              <span>{snapshot.likes} likes</span>
              <span>{snapshot.replies} replies</span>
              <span>{snapshot.shares} shares</span>
              <span>{snapshot.clicks} clicks</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
