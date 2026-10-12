import Link from "next/link";
import { money } from "./ui";

/** Share of general-election outside money helping Democrats vs Republicans. */
export function LeanBar({ proD, proR, primary = 0 }: { proD: number; proR: number; primary?: number }) {
  const total = proD + proR + primary;
  if (total <= 0) return <span className="text-xs text-slate-400">—</span>;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="w-36">
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Helping Democrats ${money(proD)}, helping Republicans ${money(proR)}, primaries ${money(primary)}`}>
        {proD > 0 && <div className="bg-[#2a78d6]" style={{ width: pct(proD) }} />}
        {primary > 0 && <div className="bg-[#b5b3ab]" style={{ width: pct(primary) }} />}
        {proR > 0 && <div className="bg-[#e34948]" style={{ width: pct(proR) }} />}
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-slate-500">
        <span>{proD > 0 ? `D ${money(proD)}` : ""}</span>
        <span>{proR > 0 ? `R ${money(proR)}` : primary > 0 ? "primaries" : ""}</span>
      </div>
    </div>
  );
}

const GROUP_STYLE: Record<string, string> = {
  super_pac: "bg-violet-100 text-violet-800",
  party: "bg-slate-800 text-white",
  corporate: "bg-amber-100 text-amber-900",
  trade: "bg-orange-100 text-orange-900",
  labor: "bg-emerald-100 text-emerald-800",
  ideological: "bg-sky-100 text-sky-800",
  leadership: "bg-slate-200 text-slate-800",
  lobbyist: "bg-rose-100 text-rose-800",
  candidate: "bg-slate-100 text-slate-700",
  other: "bg-slate-100 text-slate-600",
};

export function CategoryBadge({ category, group }: { category: string; group: string }) {
  return <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${GROUP_STYLE[group] ?? GROUP_STYLE.other}`}>{category}</span>;
}

export function SpenderName({ id, name, connectedOrg }: { id: string; name: string; connectedOrg?: string | null }) {
  return (
    <span>
      <Link href={`/money/${id}`} className="font-medium text-slate-900 hover:underline">{titleCase(name)}</Link>
      {connectedOrg && <span className="block text-[11px] text-slate-500">Sponsored by {titleCase(connectedOrg)}</span>}
    </span>
  );
}

/** FEC names are upper-case; soften them for reading without mangling acronyms. */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .replace(/\b(Pac|Llc|Inc|Usa|Us|Afl|Cio|Ibew|Seiu|Aipac|Nra|Afp|Cva|Clf|Slf|Smp|Hmp|Dccc|Nrcc|Dscc|Nrsc|Gop|Ii|Iii|Ai|Tx|Ny|Ga|Pa)\b/g, (w) => w.toUpperCase());
}
