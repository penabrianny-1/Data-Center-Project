import { connection } from "next/server";
import WatchlistView from "@/components/WatchlistView";
import { Page } from "@/components/ui";
import { getChanges } from "@/lib/repo";

export const metadata = { title: "Watchlist" };

export default async function WatchlistPage() {
  await connection();
  return (
    <Page
      title="Watchlist"
      subtitle="States, counties, races and bills you're monitoring, with changes since your last check. Use ☆ Watch on any profile to add it. Saved in this browser."
    >
      <WatchlistView changes={getChanges(1000)} />
    </Page>
  );
}
