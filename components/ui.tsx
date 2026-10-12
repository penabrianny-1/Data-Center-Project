import Link from "next/link";
import type { ReactNode } from "react";
import type { Source } from "@/lib/schema";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Layout

export function Page({ title, subtitle, actions, children }: { title: string; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="px-6 py-5 max-w-[1500px]">
      <header className="mb-5 flex items-end justify-between gap-4 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}

export function Section({ title, aside, children, id, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; id?: string; className?: string }) {
  return (
    <section id={id} className={cx("mb-6", className)}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-slate-600">{title}</h2>
        {aside && <div className="text-xs text-slate-500">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-lg border border-slate-200 bg-white", className)}>{children}</div>;
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-slate-900">{v ?? <Missing />}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Evidence & provenance

const EVIDENCE: Record<string, { label: string; cls: string; title: string }> = {
  fact: { label: "Fact", cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", title: "Supported by an official record" },
  reported: { label: "Reported", cls: "bg-sky-50 text-sky-800 ring-sky-200", title: "Reported by credible journalism; official record not confirmed" },
  analysis: { label: "Analysis", cls: "bg-amber-50 text-amber-800 ring-amber-200", title: "Interpretation based on documented evidence" },
  forecast: { label: "Forecast", cls: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200", title: "Forward-looking; uncertain" },
  scenario: { label: "Scenario", cls: "bg-violet-50 text-violet-800 ring-violet-200", title: "Conditional what-if, not a prediction" },
};

export function Evidence({ type }: { type: keyof typeof EVIDENCE | string }) {
  const e = EVIDENCE[type] ?? EVIDENCE.analysis;
  return (
    <span title={e.title} className={cx("inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset", e.cls)}>
      {e.label}
    </span>
  );
}

export function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" | null | undefined }) {
  if (!level) return null;
  const cls = { high: "text-emerald-700", medium: "text-amber-700", low: "text-rose-700" }[level];
  const dots = { high: "●●●", medium: "●●○", low: "●○○" }[level];
  return (
    <span className={cx("text-[11px] whitespace-nowrap", cls)} title={`${level} confidence`}>
      {dots} <span className="text-slate-500">{level}</span>
    </span>
  );
}

const KIND_LABEL: Record<Source["kind"], string> = {
  official: "Official",
  data: "Official data",
  journalism: "News",
  research: "Research",
  aggregator: "Aggregator",
};
const KIND_ORDER: Source["kind"][] = ["official", "data", "journalism", "research", "aggregator"];

export function SourceKindTag({ kind }: { kind: Source["kind"] }) {
  const cls = {
    official: "bg-slate-900 text-white",
    data: "bg-slate-700 text-white",
    journalism: "bg-slate-200 text-slate-800",
    research: "bg-slate-100 text-slate-700",
    aggregator: "bg-white text-slate-500 ring-1 ring-inset ring-slate-200",
  }[kind];
  return <span className={cx("rounded px-1 py-px text-[10px] font-medium", cls)}>{KIND_LABEL[kind]}</span>;
}

export function Sources({ sources, compact = false, max }: { sources: Source[]; compact?: boolean; max?: number }) {
  if (!sources?.length) return <span className="text-xs text-rose-700">No source on record</span>;
  const sorted = [...sources].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  const shown = max ? sorted.slice(0, max) : sorted;
  if (compact) {
    return (
      <span className="text-xs text-slate-500">
        {shown.map((s, i) => (
          <span key={s.url + i}>
            {i > 0 && " · "}
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline decoration-slate-300 hover:text-slate-900" title={s.title}>
              {s.publisher}
            </a>
          </span>
        ))}
        {max && sorted.length > max && <span> +{sorted.length - max}</span>}
      </span>
    );
  }
  return (
    <ul className="space-y-1">
      {shown.map((s, i) => (
        <li key={s.url + i} className="flex items-start gap-2 text-xs">
          <SourceKindTag kind={s.kind} />
          <span className="min-w-0">
            <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-slate-800 underline decoration-slate-300 hover:decoration-slate-700">
              {s.title}
            </a>
            <span className="text-slate-500">
              {" "}— {s.publisher}
              {s.published && `, ${s.published}`}
              {s.docId && ` · ${s.docId}`}
            </span>
            {s.excerpt && <span className="block text-slate-500 italic">“{s.excerpt}”</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Collapsible provenance block: sources, verification date, confidence, caveats. */
export function Provenance({
  sources, verifiedAt, confidence, caveats, retrievedAt,
}: { sources: Source[]; verifiedAt?: string | null; confidence?: "high" | "medium" | "low" | null; caveats?: string; retrievedAt?: string }) {
  return (
    <details className="group mt-2 text-xs">
      <summary className="cursor-pointer select-none list-none text-slate-500 hover:text-slate-800">
        <span className="group-open:hidden">▸</span>
        <span className="hidden group-open:inline">▾</span> Sources ({sources.length})
        {verifiedAt && <> · verified {verifiedAt}</>}
        {confidence && <> · <ConfidenceBadge level={confidence} /></>}
        {caveats && <> · <span className="text-amber-700">caveats</span></>}
      </summary>
      <div className="mt-2 space-y-2 rounded border border-slate-200 bg-slate-50 p-2">
        <Sources sources={sources} />
        {caveats && <p className="text-amber-800"><span className="font-semibold">Caveats:</span> {caveats}</p>}
        {retrievedAt && <p className="text-slate-500">Retrieved {retrievedAt.slice(0, 16).replace("T", " ")} UTC</p>}
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Small atoms

export function Missing({ children = "Not researched" }: { children?: ReactNode }) {
  return <span className="text-slate-400 italic">{children}</span>;
}

export function Party({ party }: { party?: string | null }) {
  if (!party) return null;
  const cls = party === "D" ? "bg-blue-600" : party === "R" ? "bg-red-600" : "bg-slate-500";
  return <span className={cx("inline-block rounded px-1 text-[10px] font-bold leading-4 text-white", cls)}>{party}</span>;
}

export function Pill({ children, tone = "slate" }: { children: ReactNode; tone?: "slate" | "red" | "amber" | "green" | "blue" | "violet" }) {
  const cls = {
    slate: "bg-slate-100 text-slate-700",
    red: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-800",
    green: "bg-emerald-100 text-emerald-800",
    blue: "bg-sky-100 text-sky-800",
    violet: "bg-violet-100 text-violet-800",
  }[tone];
  return <span className={cx("inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium whitespace-nowrap", cls)}>{children}</span>;
}

export const IMPACT_TONE = { restrictive: "red", permissive: "green", mixed: "amber", neutral: "slate", unclear: "slate" } as const;

export function Impact({ impact }: { impact: keyof typeof IMPACT_TONE }) {
  const label = { restrictive: "↓ Restrictive", permissive: "↑ Permissive", mixed: "↕ Mixed", neutral: "Neutral", unclear: "Unclear" }[impact];
  return <Pill tone={IMPACT_TONE[impact]}>{label}</Pill>;
}

export function Severity({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-px" title={`Severity ${level}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={cx("h-2.5 w-1.5 rounded-sm", i <= level ? (level >= 4 ? "bg-rose-600" : level === 3 ? "bg-amber-500" : "bg-slate-500") : "bg-slate-200")} />
      ))}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-xs text-slate-500">{children}</div>}
    </div>
  );
}

export function Freshness({ at, label = "Updated" }: { at: string | null | undefined; label?: string }) {
  if (!at) return <span className="text-xs text-slate-400">{label}: never</span>;
  return (
    <time dateTime={at} className="text-xs text-slate-500" title={at}>
      {label} {at.slice(0, 16).replace("T", " ")}
      {at.length > 10 && " UTC"}
    </time>
  );
}

export function StateLink({ code, children }: { code: string; children?: ReactNode }) {
  if (code === "US") return <span>{children ?? "Federal"}</span>;
  return (
    <Link href={`/states/${code}`} className="font-medium text-slate-900 underline decoration-slate-300 hover:decoration-slate-700">
      {children ?? code}
    </Link>
  );
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "");
