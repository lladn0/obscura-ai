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

/** Words that describe the kind of picture (or are too common to identify it), not its subject. */
const GENERIC = new Set(
  ("the a an of and or in on with for to from by at its their showing shows show view views image images photo photograph " +
    "photography picture diagram diagrams illustration illustrated labeled labelled label anatomical anatomy schematic drawing " +
    "map close up closeup detail details side front back top bottom lateral medial anterior posterior superior inferior " +
    "overview example human structure structures cross section real actual official historical").split(" "),
);
const subjectTerms = (text: string) =>
  [...new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter((w) => !GENERIC.has(w));

/**
 * The file's title and description must name the subject that was searched
 * for: both terms of a two-word subject, most terms of a longer one.
 */
function matchesSubject(terms: string[], title: string, description: string) {
  const have = `${title} ${description}`.toLowerCase().replace(/[_-]/g, " ");
  const hits = terms.filter((w) => have.includes(w.replace(/(es|s)$/, ""))).length;
  return hits >= (terms.length <= 2 ? terms.length : Math.max(2, Math.ceil(terms.length * 0.6)));
}

async function search(terms: string[], exclude: ReadonlySet<string>): Promise<ImageFields | null> {
  const query = terms.join(" ");
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
    if (!info || !/^image\/(jpeg|png|svg\+xml|webp)$/.test(info.mime)) continue;
    const meta = info.extmetadata ?? {};
    const artist = stripHtml(meta.Artist?.value).slice(0, 80);
    const licence = stripHtml(meta.LicenseShortName?.value);
    const description = stripHtml(meta.ImageDescription?.value).slice(0, 200);
    const url = info.thumburl ?? info.url;
    if (exclude.has(url) || !matchesSubject(terms, page.title, description)) continue;
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
 * Commons search requires every word to match, so descriptive queries
 * ("temporal bone lateral view diagram showing the inner ear") find nothing.
 * Search the subject words only, dropping trailing ones down to two, so the
 * result stays specific. At most 4 requests per image.
 */
export async function findImage(query: string, exclude: ReadonlySet<string> = new Set()): Promise<ImageFields | null> {
  const core = subjectTerms(query).slice(0, 6);
  if (!core.length) return null;
  const attempts: string[][] = [];
  for (let n = core.length; n >= Math.min(2, core.length) && attempts.length < 4; n--) attempts.push(core.slice(0, n));
  for (const terms of attempts) {
    const hit = await search(terms, exclude).catch(() => null);
    if (hit) return hit;
  }
  return null;
}
