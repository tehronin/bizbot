import Link from "next/link";

export default function OnboardingWelcomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="w-full max-w-3xl border p-8" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>onboarding</div>
        <h1 className="text-4xl mb-4">BizBot local control plane</h1>
        <p className="text-sm max-w-2xl mb-8" style={{ color: "var(--text-dim)" }}>
          Configure providers, platform credentials, Meta webhook behavior, Google Business Profile access, autonomy rules, the local workspace, and the stable facts BizBot should carry forward as explicit user memory.
        </p>
        <div className="grid gap-3 md:grid-cols-3 text-xs leading-6 mb-8" style={{ color: "var(--text-dim)" }}>
          <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>1. Choose chat + embedding providers and save the keys you actually need.</div>
          <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>2. Connect social account IDs, webhook verify token, Google Business location names, and inbox-processing behavior.</div>
          <div className="border p-3" style={{ borderColor: "var(--border-sub)", background: "var(--bg-raised)" }}>3. Set autonomy, heartbeat, and knowledge/workspace paths so the runtime rules are in place before you seed stable user memory facts in the final setup step.</div>
        </div>
        <Link href="/onboarding/llm" className="inline-flex px-4 py-3 border text-sm uppercase tracking-[0.2em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
          begin setup
        </Link>
      </section>
    </main>
  );
}
