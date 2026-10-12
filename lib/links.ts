/** Best in-app page for an entity id. */
export function hrefFor(id: string): string | null {
  const [kind, ...rest] = id.split(":");
  const key = rest.join(":");
  switch (kind) {
    case "bill": return `/legislation/${key}`;
    case "race": return `/elections/${key}`;
    case "stategov": case "policy": case "commission": case "state": return `/states/${key}`;
    case "county": return `/counties/${key}`;
    case "docket": return `/utilities`;
    case "local": return `/local`;
    case "dev": return `/developments`;
    case "news": case "article": return `/news`;
    case "legislator": case "committee": return `/congress`;
    case "finance": case "ie": return `/money`;
    case "candidate": return `/elections/${key.split(":")[0]}`;
    default: return null;
  }
}
