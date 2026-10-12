"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const NAV: { group: string; items: { href: string; label: string }[] }[] = [
  {
    group: "Monitor",
    items: [
      { href: "/", label: "National overview" },
      { href: "/news", label: "Live news" },
      { href: "/changes", label: "What changed" },
      { href: "/watchlist", label: "Watchlist" },
    ],
  },
  {
    group: "Jurisdictions",
    items: [
      { href: "/states", label: "States" },
      { href: "/compare", label: "Compare & score" },
      { href: "/local", label: "Local actions" },
    ],
  },
  {
    group: "Power & politics",
    items: [
      { href: "/elections", label: "2026 elections" },
      { href: "/congress", label: "Congress & committees" },
      { href: "/utilities", label: "Utility commissions" },
      { href: "/money", label: "Campaign finance" },
    ],
  },
  {
    group: "Records",
    items: [
      { href: "/legislation", label: "Legislation" },
      { href: "/scenarios", label: "Scenarios" },
      { href: "/research", label: "AAF research" },
      { href: "/indicators", label: "Gas prices" },
    ],
  },
  {
    group: "Trust",
    items: [
      { href: "/sources", label: "Sources & coverage" },
      { href: "/methodology", label: "Methodology" },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");

  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <Link href="/" className="block border-b border-slate-200 px-4 py-3">
        <div className="text-[13px] font-bold tracking-tight text-slate-900">DATA CENTER INTEL</div>
        <div className="text-[11px] text-slate-500">Political & regulatory monitor</div>
      </Link>
      <form
        className="border-b border-slate-200 p-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search bills, people, places…"
          aria-label="Search"
          className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs outline-none focus:border-slate-500"
        />
      </form>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {NAV.map((g) => (
          <div key={g.group} className="mb-3">
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{g.group}</div>
            {g.items.map((item) => {
              const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block rounded px-2 py-1 text-[13px] ${
                    active ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
