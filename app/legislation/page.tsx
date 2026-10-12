import { connection } from "next/server";
import { Suspense } from "react";
import BillBrowser from "@/components/BillBrowser";
import { Empty, Freshness, Page, Section } from "@/components/ui";
import DiscoveredBills from "@/components/DiscoveredBills";
import { getAdapter, getBills, getDiscoveredBills, getOfficialBillRecord } from "@/lib/repo";

export const metadata = { title: "Legislation" };

export default async function LegislationPage() {
  await connection();
  const bills = getBills().map((b) => {
    const official = getOfficialBillRecord(b.id);
    return { id: b.id, data: b.data, official: official ? { date: official.data.latestAction?.actionDate ?? null, text: official.data.latestAction?.text ?? null, retrievedAt: official.retrievedAt } : null };
  });
  const discovered = getDiscoveredBills();
  const os = getAdapter("openstates");
  return (
    <Page
      title="Legislation"
      subtitle="Data-center bills in Congress and the states, each linked to the official bill page."
    >
      {bills.length ? (
        <Suspense fallback={<div className="h-96 animate-pulse rounded-lg bg-slate-100" />}>
          <BillBrowser bills={bills} />
        </Suspense>
      ) : (
        <Empty title="Bill research in progress">The curated bill dataset hasn&apos;t been ingested yet. Federal bill status refreshes from Congress.gov once CONGRESS_GOV_API_KEY is set.</Empty>
      )}
      <Section
        title={`Discovered automatically: all 50 states (${discovered.length})`}
        aside={os?.last_status === "not_configured" ? "Needs OPENSTATES_API_KEY" : <Freshness at={os?.last_success} label="Open States refreshed" />}
      >
        <DiscoveredBills bills={discovered} />
      </Section>
    </Page>
  );
}
