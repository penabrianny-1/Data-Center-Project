export const USER_AGENT = "DataCenterIntel/0.2 (research aggregator; low-volume scheduled refresh)";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Per-host politeness: minimum gap between requests to the same host (slots are reserved, so concurrent callers queue). */
const nextSlot = new Map<string, number>();
const HOST_DELAY_MS: Record<string, number> = {
  "gasprices.aaa.com": 10_000, // robots.txt Crawl-delay: 10
  "www.americanactionforum.org": 500,
  "v3.openstates.org": 6_500, // free tier is rate-limited per minute
  "news.google.com": 2_000,
  "api.open.fec.gov": 1_500,
  "lda.gov": 1_200,
  "api.elections.kalshi.com": 300,
  "gamma-api.polymarket.com": 400,
  "adimpact.com": 1_500,
  "blox-cms": 15_000, // BLOX/TownNews papers share one rate limit across sites
};

/** Rate-limit bucket: usually the host, but platforms that throttle across sites share one bucket. */
function rateBucket(url: string): string {
  const u = new URL(url);
  if (u.pathname.startsWith("/search/") && u.searchParams.get("f") === "rss") return "blox-cms";
  return u.host;
}

/**
 * fetch with timeout, per-host politeness delay and exponential-backoff
 * retries on network errors, 429 and 5xx. Non-retryable HTTP errors throw.
 */
export async function politeFetch(
  url: string,
  { retries = 3, ...init }: RequestInit & { retries?: number } = {},
): Promise<Response> {
  const host = rateBucket(url);
  const gap = HOST_DELAY_MS[host] ?? 250;

  for (let attempt = 0; ; attempt++) {
    const slot = Math.max(Date.now(), nextSlot.get(host) ?? 0);
    nextSlot.set(host, slot + gap);
    if (slot > Date.now()) await sleep(slot - Date.now());

    try {
      const res = await fetch(url, {
        ...init,
        headers: { "User-Agent": USER_AGENT, ...init.headers },
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= retries) {
        throw new HttpError(res.status, `${res.status} ${res.statusText} for ${redact(url)}`);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
    } catch (err) {
      if (err instanceof HttpError || attempt >= retries) throw err;
      await sleep(1000 * 2 ** attempt);
    }
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Strip API keys from URLs before they reach logs. */
export function redact(url: string): string {
  return url.replace(/(api_key|apikey|key)=[^&]+/gi, "$1=***");
}
