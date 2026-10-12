import { connection } from "next/server";
import { LocalActionTable } from "@/components/records";
import { Page, Pill } from "@/components/ui";
import { getLocalActions } from "@/lib/repo";
import { addDays, today } from "@/lib/time";

export const metadata = { title: "Local actions" };

export default async function LocalPage() {
  await connection();
  const all = getLocalActions().sort((a, b) => a.data.state.localeCompare(b.data.state) || (b.date ?? "").localeCompare(a.date ?? ""));
  const inEffect = all.filter((a) => a.data.status === "in_effect");
  const expiring = inEffect
    .filter((a) => a.data.expires && a.data.expires >= today() && a.data.expires <= addDays(110))
    .sort((a, b) => a.data.expires!.localeCompare(b.data.expires!));
  return (
    <Page
      title="Local actions"
      subtitle={`County, municipal, township and tribal actions on data centers: a curated, sourced sample of ${all.length} records across ${new Set(all.map((a) => a.state)).size} states. A missing jurisdiction means not yet researched, not that no rules exist.`}
    >
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Pill tone="red">{inEffect.filter((a) => a.data.kind === "moratorium").length} moratoriums in effect</Pill>
        <Pill tone="red">{inEffect.filter((a) => a.data.kind === "ban").length} bans in effect</Pill>
        <Pill tone="amber">{expiring.length} expire within ~3½ months (renewal votes likely)</Pill>
        <Pill>{all.filter((a) => a.data.kind === "lawsuit").length} lawsuits</Pill>
      </div>
      {expiring.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <span className="font-semibold">Watch: expiring soon.</span>{" "}
          {expiring.map((a, i) => <span key={a.id}>{i > 0 && " · "}{a.data.jurisdiction}, {a.data.state} ({a.data.expires})</span>)}
        </div>
      )}
      <LocalActionTable actions={all} showState />
    </Page>
  );
}
