import type { ImageFields } from "@/graph/types";

/**
 * Contextual images from Wikimedia Commons: real, freely licensed files with
 * a stable description page for attribution. Runs in the browser (the API
 * allows anonymous CORS requests), independently of the research stream.
 */

const API = "https://commons.wikimedia.org/w/api.php";
const THUMB_WIDTH = 640;

type CommonsPage = {
  index?: number;
  title: string;
  imageinfo?: {
    thumburl?: string;
    url: string;
    descriptionurl: string;
    mime: string;
    extmetadata?: Record<string, { value: string } | undefined>;
  }[];
};

const stripHtml = (html = "") =>
  html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();

/** Words that describe the kind of picture, not its subject. */
const GENERIC = new Set(
  "the a an of and or in on with for to from by at view views image images photo photograph picture diagram diagrams illustration labeled labelled anatomical schematic drawing map close up closeup detail side front top lateral medial overview example".split(" "),
);
const subjectTerms = (text: string) =>
  [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter((w) => !GENERIC.has(w));

/**
 * The file's title and description must name the subject the node asked for;
 * otherwise a loosely related picture is worse than none.
 */
function matchesSubject(query: string, title: string, description: string) {
  const wanted = subjectTerms(query);
  if (!wanted.length) return false;
  const have = `${title} ${description}`.toLowerCase();
  const hits = wanted.filter((w) => have.includes(w.replace(/s$/, ""))).length;
  return hits >= Math.min(wanted.length, Math.max(2, Math.ceil(wanted.length * 0.5)));
}

async function search(query: string, fullQuery: string, exclude: ReadonlySet<string>): Promise<ImageFields | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap|drawing`,
    gsrnamespace: "6",
    gsrlimit: "10",
    prop: "imageinfo",
    iiprop: "url|mime|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
  });
  const res = await fetch(`${API}?${params}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { query?: { pages?: Record<string, CommonsPage> } };
  const pages = Object.values(json.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  for (const page of pages) {
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png|svg\+xml|webp|gif)$/.test(info.mime)) continue;
    const meta = info.extmetadata ?? {};
    const artist = stripHtml(meta.Artist?.value).slice(0, 80);
    const licence = stripHtml(meta.LicenseShortName?.value);
    const description = stripHtml(meta.ImageDescription?.value).slice(0, 200);
    const url = info.thumburl ?? info.url;
    if (exclude.has(url) || !matchesSubject(fullQuery, page.title, description)) continue;
    return {
      imageUrl: url,
      imageSourceUrl: info.descriptionurl,
      imageAlt: description || page.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
      imageCredit: [artist, licence].filter(Boolean).join(" · ") || "Wikimedia Commons",
    };
  }
  return null;
}

/**
 * Specific queries ("human temporal bone lateral view labeled diagram") often
 * match nothing in full; drop trailing qualifiers until something matches,
 * but never below the first three words, so results stay specific.
 */
export async function findImage(query: string, exclude: ReadonlySet<string> = new Set()): Promise<ImageFields | null> {
  const words = query.split(/\s+/).filter(Boolean).slice(0, 10);
  const lengths = [...new Set([words.length, words.length - 2, 4, 3])].filter((n) => n > 0 && n <= words.length)
    .sort((a, b) => b - a);
  for (const n of lengths) {
    const hit = await search(words.slice(0, n).join(" "), query, exclude).catch(() => null);
    if (hit) return hit;
  }
  return null;
}
