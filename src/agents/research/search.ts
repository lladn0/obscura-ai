import Firecrawl from "@mendable/firecrawl-js";

/** A real web page returned by Firecrawl. `content` is untrusted text. */
export type WebSource = { id: string; url: string; title: string; content: string };

/** Per-page cap so a handful of long pages fits comfortably in one prompt. */
const MAX_PAGE_CHARS = 5000;

let client: Firecrawl | null = null;
const firecrawl = () => (client ??= new Firecrawl()); // reads FIRECRAWL_API_KEY server-side

/** Researcher: search the web and return readable page content with real URLs. */
export async function searchWeb(query: string, limit = 5): Promise<WebSource[]> {
  const data = await firecrawl().search(query, {
    limit,
    scrapeOptions: { formats: ["markdown"], onlyMainContent: true },
  });
  const sources: WebSource[] = [];
  for (const item of data.web ?? []) {
    const doc = item as { url?: string; title?: string; description?: string; markdown?: string; metadata?: { url?: string; sourceURL?: string; title?: string } };
    const url = doc.url ?? doc.metadata?.url ?? doc.metadata?.sourceURL;
    if (!url || !/^https?:\/\//.test(url) || sources.some((s) => s.url === url)) continue;
    const content = (doc.markdown ?? doc.description ?? "").slice(0, MAX_PAGE_CHARS);
    if (!content.trim()) continue;
    sources.push({
      id: `S${sources.length + 1}`,
      url,
      title: (doc.title ?? doc.metadata?.title ?? new URL(url).hostname).slice(0, 140),
      content,
    });
  }
  return sources;
}
