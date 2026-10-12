import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Data Center Intel — U.S. political & regulatory monitor", template: "%s · Data Center Intel" },
  description:
    "How elections, legislatures, utility commissions and local land-use decisions are changing where U.S. data centers can be built. Every claim is sourced.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} antialiased`}>
      <body className="min-h-screen bg-white font-sans text-slate-900">
        <Suspense fallback={<div className="h-[49px] border-b border-slate-200" />}>
          <Sidebar />
        </Suspense>
        <main>
          <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-8 text-sm text-slate-400">Loading…</div>}>{children}</Suspense>
        </main>
        <footer className="mt-12 border-t border-slate-200 py-6 text-center text-xs text-slate-400">
          Every claim links to its source · <a href="/sources" className="underline">Sources</a> · <a href="/methodology" className="underline">How it works</a>
        </footer>
      </body>
    </html>
  );
}
