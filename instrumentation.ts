/**
 * Autonomous refresh: while the Next.js server runs, check every 10 minutes
 * which sources are due (each adapter declares refreshMinutes) and refresh
 * them in a separate process. Disable with AUTO_REFRESH=0.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.AUTO_REFRESH === "0") return;
  const { startScheduler } = await import("./lib/scheduler");
  startScheduler();
}
