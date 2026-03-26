import Link from "next/link";

export default function OnboardingWelcomePage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}>
      <section className="w-full max-w-3xl border p-8" style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}>
        <div className="text-xs uppercase tracking-[0.24em] mb-4" style={{ color: "var(--text-muted)" }}>onboarding</div>
        <h1 className="text-4xl mb-4">BizBot local control plane</h1>
        <p className="text-sm max-w-2xl mb-8" style={{ color: "var(--text-dim)" }}>
          Configure providers, platform credentials, posting policies, and the local workspace before enabling autonomous drafting and review.
        </p>
        <Link href="/onboarding/llm" className="inline-flex px-4 py-3 border text-sm uppercase tracking-[0.2em]" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
          begin setup
        </Link>
      </section>
    </main>
  );
}
