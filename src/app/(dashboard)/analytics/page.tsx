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
    <div className="space-y-5">
      <div className="grid gap-4 grid-cols-5">
        {Object.entries(totals).map(([key, value]) => (
          <section key={key} className="border p-4 border-border bg-surface">
            <div className="text-xs uppercase tracking-[0.24em] mb-3 text-muted">{key}</div>
            <div className="text-2xl font-semibold tabular-nums text-accent">{value}</div>
          </section>
        ))}
      </div>
      <section className="border p-4 border-border bg-surface">
        <div className="text-xs uppercase tracking-[0.24em] mb-4 text-muted">snapshots</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: 640 }}>
            <thead>
              <tr className="border-b border-border">
                {["date", "impressions", "likes", "replies", "shares", "clicks"].map((h) => (
                  <th key={h} className="text-left text-xs uppercase tracking-[0.2em] pb-3 pr-6 font-medium text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.id} className="border-b border-border-sub">
                  <td className="py-2.5 pr-6 tabular-nums">{new Date(snapshot.capturedAt).toLocaleDateString()}</td>
                  <td className="py-2.5 pr-6 tabular-nums">{snapshot.impressions}</td>
                  <td className="py-2.5 pr-6 tabular-nums">{snapshot.likes}</td>
                  <td className="py-2.5 pr-6 tabular-nums">{snapshot.replies}</td>
                  <td className="py-2.5 pr-6 tabular-nums">{snapshot.shares}</td>
                  <td className="py-2.5 pr-6 tabular-nums">{snapshot.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
