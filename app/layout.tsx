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
      <body className="flex min-h-screen bg-[#f9f9f7] font-sans text-slate-900">
        <Suspense fallback={<div className="sticky top-0 h-screen w-56 shrink-0 border-r border-slate-200 bg-slate-50" />}>
          <Sidebar />
        </Suspense>
        <main className="min-w-0 flex-1">
          <Suspense fallback={<div className="px-6 py-5 text-sm text-slate-400">Loading…</div>}>{children}</Suspense>
        </main>
      </body>
    </html>
  );
}
