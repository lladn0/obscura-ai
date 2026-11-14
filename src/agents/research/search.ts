import Firecrawl from "@mendable/firecrawl-js";

/**
 * A real web page returned by Firecrawl. `content` (untrusted) stays on the
 * server for quote verification; only `snippets` are sent to the model.
 */
export type WebSource = { id: string; url: string; title: string; content: string; snippets: string };
export type SearchResult = { sources: WebSource[]; credits: number; cached: boolean };

const PAGES_PER_SEARCH = 4;
/** Firecrawl bills search per 10 results, plus each scraped page. Used when a page doesn't report credits. */
const SEARCH_BASE_CREDITS = 2;
const SNIPPETS_PER_SOURCE = 3;
const MAX_SNIPPET_CHARS = 420;

let client: Firecrawl | null = null;
const firecrawl = () => (client ??= new Firecrawl()); // reads FIRECRAWL_API_KEY server-side

const STOPWORDS = new Set(
  "the a an and or of to in on for with by from at as is are was were be been how why what which who does do did that this these those its it their there about into than more most".split(" "),
);
const terms = (text: string) =>
  new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter((t) => !STOPWORDS.has(t)) ?? []);

/** The few paragraphs of a page most related to the query, in page order. */
export function relevantSnippets(markdown: string, query: string): string {
  const wanted = terms(query);
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((p) => p.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[#>*_`|]+/g, " ").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 80 && p.split(" ").length > 12); // skip nav, headings, link lists
  const scored = paragraphs.map((p, i) => {
    const words = terms(p);
    let hits = 0;
    for (const w of wanted) if (words.has(w)) hits++;
    return { p, i, score: hits / Math.sqrt(words.size || 1) };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, SNIPPETS_PER_SOURCE)
    .sort((a, b) => a.i - b.i)
    .map((s) => (s.p.length > MAX_SNIPPET_CHARS ? `${s.p.slice(0, MAX_SNIPPET_CHARS)}…` : s.p))
    .join("\n…\n");
}

/**
 * Researcher: one Firecrawl search per distinct query per run. Identical
 * queries from different branches share the same request and results.
 */
export function createSearch() {
  const cache = new Map<string, Promise<SearchResult>>();

  return (query: string, focus: string): Promise<SearchResult> => {
    const key = query.trim().toLowerCase().replace(/\s+/g, " ");
    const hit = cache.get(key);
    if (hit) return hit.then((r) => ({ ...r, credits: 0, cached: true }));

    const request = firecrawl()
      .search(query, { limit: PAGES_PER_SEARCH, scrapeOptions: { formats: ["markdown"], onlyMainContent: true } })
      .then((data): SearchResult => {
        const sources: WebSource[] = [];
        let credits = SEARCH_BASE_CREDITS;
        for (const item of data.web ?? []) {
          const doc = item as {
            url?: string;
            title?: string;
            description?: string;
            markdown?: string;
            metadata?: { url?: string; sourceURL?: string; title?: string; creditsUsed?: number };
          };
          if (doc.markdown !== undefined) credits += doc.metadata?.creditsUsed ?? 1;
          const url = doc.url ?? doc.metadata?.url ?? doc.metadata?.sourceURL;
          if (!url || !/^https?:\/\//.test(url) || sources.some((s) => s.url === url)) continue;
          const content = doc.markdown ?? doc.description ?? "";
          const snippets = relevantSnippets(content, `${query} ${focus}`) || (doc.description ?? "").slice(0, MAX_SNIPPET_CHARS);
          if (!snippets.trim()) continue;
          sources.push({
            id: `S${sources.length + 1}`,
            url,
            title: (doc.title ?? doc.metadata?.title ?? new URL(url).hostname).slice(0, 140),
            content,
            snippets,
          });
        }
        return { sources, credits, cached: false };
      });
    cache.set(key, request);
    request.catch(() => cache.delete(key));
    return request;
  };
}
