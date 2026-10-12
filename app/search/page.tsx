import { connection } from "next/server";
import Link from "next/link";
import { Suspense } from "react";
import { hrefFor } from "@/lib/links";
import { Empty, Page, humanize } from "@/components/ui";
import { search } from "@/lib/repo";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  await connection();
  return (
    <Page title="Search">
      <Suspense fallback={<p className="text-sm text-slate-500">Searching…</p>}>
        <Results searchParams={searchParams} />
      </Suspense>
    </Page>
  );
}

async function Results({ searchParams }: { searchParams: PageProps<"/search">["searchParams"] }) {
  const q = String((await searchParams).q ?? "").trim();
  if (!q) return <Empty title="Type a query in the sidebar search box" />;
  const hits = search(q, 80);
  const groups = new Map<string, typeof hits>();
  for (const h of hits) groups.set(h.kind, [...(groups.get(h.kind) ?? []), h]);
  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">{hits.length} results for “{q}”</p>
      {hits.length === 0 && <Empty title="No matches">Try a bill number (HB 1234), a person, a county or a topic such as “moratorium”.</Empty>}
      <div className="grid gap-4 lg:grid-cols-2">
        {[...groups].map(([kind, rows]) => (
          <section key={kind} className="rounded-lg border border-slate-200 bg-white">
            <h2 className="border-b border-slate-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{humanize(kind)} ({rows.length})</h2>
            <ul className="divide-y divide-slate-100 text-xs">
              {rows.slice(0, 15).map((r) => {
                const href = r.kind === "article" && r.sources[0] ? r.sources[0].url : hrefFor(r.id);
                return (
                  <li key={r.id} className="px-3 py-1.5">
                    {r.state && <span className="mr-1 font-semibold">{r.state}</span>}
                    {href ? <Link href={href} className="underline decoration-slate-300">{r.title}</Link> : r.title}
                    {r.date && <span className="ml-1 text-slate-400">{r.date}</span>}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
