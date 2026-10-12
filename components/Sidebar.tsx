"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const PRIMARY = [
  { href: "/", label: "Map" },
  { href: "/news", label: "News" },
  { href: "/states", label: "States" },
  { href: "/elections", label: "2026 Elections" },
  { href: "/predictions", label: "My Senate Ratings" },
  { href: "/legislation", label: "Legislation" },
  { href: "/utilities", label: "Utilities" },
];

const MORE = [
  { href: "/developments", label: "Key developments" },
  { href: "/local", label: "Local actions" },
  { href: "/congress", label: "Congress" },
  { href: "/money", label: "Campaign money" },
  { href: "/compare", label: "Compare states" },
  { href: "/scenarios", label: "Scenarios" },
  { href: "/indicators", label: "Gas prices" },
  { href: "/research", label: "AAF research" },
  { href: "/changes", label: "What changed" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/sources", label: "Sources" },
  { href: "/methodology", label: "How it works" },
];

/** Top navigation bar (file kept as Sidebar for import stability). */
export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  useEffect(() => {
    const close = (e: MouseEvent) => moreRef.current && !moreRef.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("click", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2.5">
        <Link href="/" className="shrink-0 text-[15px] font-bold tracking-tight text-slate-900">
          Data Center <span className="text-[#c43c3a]">Tracker</span>
        </Link>
        <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
          {PRIMARY.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${isActive(item.href) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {/* Kept outside the scrollable <nav>: an overflow container would clip the dropdown into a tiny scroll box. */}
        <div ref={moreRef} className="relative shrink-0 text-sm">
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-haspopup="menu"
            className={`whitespace-nowrap rounded-md px-3 py-1.5 font-medium ${MORE.some((m) => isActive(m.href)) ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            More ▾
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {MORE.map((m) => (
                <Link
                  key={m.href}
                  href={m.href}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={`block px-3 py-2 text-sm ${isActive(m.href) ? "font-semibold text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}
                >
                  {m.label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
          className="hidden shrink-0 md:block"
        >
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            aria-label="Search"
            className="w-44 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm outline-none focus:border-slate-500"
          />
        </form>
      </div>
    </header>
  );
}
