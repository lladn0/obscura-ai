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

async function search(query: string): Promise<ImageFields | null> {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    origin: "*",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap|drawing`,
    gsrnamespace: "6",
    gsrlimit: "6",
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
    return {
      imageUrl: info.thumburl ?? info.url,
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
export async function findImage(query: string): Promise<ImageFields | null> {
  const words = query.split(/\s+/).filter(Boolean).slice(0, 10);
  const lengths = [...new Set([words.length, words.length - 2, 4, 3])].filter((n) => n > 0 && n <= words.length)
    .sort((a, b) => b - a);
  for (const n of lengths) {
    const hit = await search(words.slice(0, n).join(" ")).catch(() => null);
    if (hit) return hit;
  }
  return null;
}
