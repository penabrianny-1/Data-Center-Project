"use client";

import { useMemo, useState } from "react";
import ArticleCard from "@/components/ArticleCard";
import type { Article } from "@/lib/types";

export default function ResearchList({ articles }: { articles: Article[] }) {
  const [primaryOnly, setPrimaryOnly] = useState(true);
  const [type, setType] = useState<string>("all");
  const [query, setQuery] = useState("");

  const types = useMemo(() => [...new Set(articles.map((a) => a.type))].sort(), [articles]);

  const visible = articles.filter(
    (a) =>
      (!primaryOnly || a.relevance === "primary") &&
      (type === "all" || a.type === type) &&
      (!query || `${a.title} ${a.excerpt} ${a.author ?? ""}`.toLowerCase().includes(query.toLowerCase())),
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search titles, authors…"
          className="flex-1 min-w-48 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1 text-sm">
          {[
            { value: true, label: "Focused" },
            { value: false, label: "All mentions" },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              onClick={() => setPrimaryOnly(opt.value)}
              className={`px-3 py-1 rounded-md font-medium transition-all ${
                primaryOnly === opt.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-sm text-slate-500">
        {visible.length} {visible.length === 1 ? "article" : "articles"}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((a) => (
          <ArticleCard key={a.id} article={a} />
        ))}
      </div>
    </>
  );
}
