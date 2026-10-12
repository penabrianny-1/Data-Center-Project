/** Today's date (YYYY-MM-DD, UTC). Call only in request-time (dynamic) rendering. */
export const today = () => new Date().toISOString().slice(0, 10);

/** Date `n` days from today (negative for the past), YYYY-MM-DD. */
export const addDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** True when the last success is older than `factor` × the refresh interval. */
export const isStale = (lastSuccess: string | null, intervalMinutes: number, factor = 3) =>
  Boolean(lastSuccess) && Date.now() - Date.parse(lastSuccess!) > intervalMinutes * 60_000 * factor;
