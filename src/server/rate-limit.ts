/**
 * Simple safeguard against excessive unauthenticated research runs.
 *
 * Counts are kept in memory per server instance: on Vercel, warm instances are reused,
 * so this throttles bursts from one client, but it is best-effort (separate instances and
 * cold starts have their own counters). Swap in a shared store (e.g. Upstash) for strict limits.
 */
const WINDOW_MS = 60 * 60 * 1000;
const perIpLimit = () => Number(process.env.RESEARCH_RATE_LIMIT_PER_HOUR) || 20;
const globalLimit = () => Number(process.env.RESEARCH_GLOBAL_LIMIT_PER_HOUR) || 300;

const hits = new Map<string, number[]>();
let global: number[] = [];

const recent = (list: number[] | undefined, now: number) => (list ?? []).filter((t) => now - t < WINDOW_MS);

const clientIp = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";

/** True when the request starts an agent run (REST `/agent/:id/run` or single-endpoint `agent/run`). */
async function startsRun(req: Request) {
  if (req.method !== "POST") return false;
  if (/\/agent\/[^/]+\/run\/?$/.test(new URL(req.url).pathname)) return true;
  try {
    const body = (await req.clone().json()) as { method?: string };
    return body?.method === "agent/run";
  } catch {
    return false;
  }
}

const tooMany = (message: string, retryAfterMs: number) =>
  Response.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) } },
  );

/** Returns a 429 response when the caller is over the limit, otherwise null (and records the run). */
export async function limitResearch(req: Request): Promise<Response | null> {
  if (!(await startsRun(req))) return null;
  const now = Date.now();
  const ip = clientIp(req);
  const mine = recent(hits.get(ip), now);
  global = recent(global, now);

  if (mine.length >= perIpLimit())
    return tooMany("Research limit reached for now. Please try again later.", WINDOW_MS - (now - mine[0]));
  if (global.length >= globalLimit())
    return tooMany("The service is busy. Please try again later.", WINDOW_MS - (now - global[0]));

  mine.push(now);
  global.push(now);
  hits.set(ip, mine);
  if (hits.size > 5000) for (const [k, v] of hits) if (!recent(v, now).length) hits.delete(k);
  return null;
}
