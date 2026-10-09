import { EXCERPT_MAX } from "./config";
import type { FeedDef, PolicyItem } from "./types";

// Pure RSS 2.0 / RSS 1.0 (RDF) / Atom parsing with regular expressions (the feeds are simple and machine-generated).
// No network, no clock. Anything unreadable is left out or null, never invented.

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…", euro: "€", pound: "£", yen: "¥", copy: "©", reg: "®", deg: "°", bull: "•", middot: "·", laquo: "«", raquo: "»", szlig: "ß", times: "×", sect: "§", para: "¶" };
// HTML 4 Latin-1 letters (the feeds are written by humans with names like Türkiye, Sørensen, Çelik).
const LATIN1 = "AElig:Æ Aacute:Á Acirc:Â Agrave:À Aring:Å Atilde:Ã Auml:Ä Ccedil:Ç ETH:Ð Eacute:É Ecirc:Ê Egrave:È Euml:Ë Iacute:Í Icirc:Î Igrave:Ì Iuml:Ï Ntilde:Ñ Oacute:Ó Ocirc:Ô Ograve:Ò Oslash:Ø Otilde:Õ Ouml:Ö THORN:Þ Uacute:Ú Ucirc:Û Ugrave:Ù Uuml:Ü Yacute:Ý aacute:á acirc:â aelig:æ agrave:à aring:å atilde:ã auml:ä ccedil:ç eacute:é ecirc:ê egrave:è eth:ð euml:ë iacute:í icirc:î igrave:ì iuml:ï ntilde:ñ oacute:ó ocirc:ô ograve:ò oslash:ø otilde:õ ouml:ö thorn:þ uacute:ú ucirc:û ugrave:ù uuml:ü yacute:ý yuml:ÿ";
for (const kv of LATIN1.split(" ")) { const [k, v] = kv.split(":"); NAMED[k] = v; }

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? m;
  });
}

/** Text of a field: CDATA unwrapped, tags removed, entities decoded (twice for feeds that double-escape HTML), whitespace collapsed. */
export function cleanText(raw: string): string {
  let s = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decodeEntities(s);
  s = s.replace(/<[^>]*>/g, " ");
  s = decodeEntities(s);
  return s.replace(/\s+/g, " ").trim();
}

function tag(block: string, names: string[]): string | null {
  for (const n of names) {
    const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i");
    const m = re.exec(block);
    if (m) return m[1];
  }
  return null;
}

function linkOf(block: string): string | null {
  const t = tag(block, ["link"]);
  if (t) { const c = cleanText(t); if (/^https?:\/\//i.test(c)) return c; }
  const atom = /<link\b[^>]*\bhref="([^"]+)"[^>]*>/i.exec(block);
  if (atom && /^https?:\/\//i.test(atom[1])) return decodeEntities(atom[1]);
  const about = /<item\b[^>]*\brdf:about="([^"]+)"/i.exec(block);
  if (about && /^https?:\/\//i.test(about[1])) return decodeEntities(about[1]);
  const g = tag(block, ["guid"]);
  if (g) { const c = cleanText(g); if (/^https?:\/\//i.test(c)) return c; }
  return null;
}

export function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = cleanText(raw);
  const t = Date.parse(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(/^(\w{3}, )(\d) /, "$10$2 "));
  const t2 = Number.isFinite(t) ? t : Date.parse(s);
  return Number.isFinite(t2) ? new Date(t2).toISOString() : null;
}

export function excerptOf(desc: string | null, title: string): string | null {
  if (!desc) return null;
  const c = cleanText(desc);
  if (!c) return null;
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (norm(c) === norm(title)) return null;           // a description that merely repeats the title is not an excerpt
  if (c.length <= EXCERPT_MAX) return c;
  const cut = c.slice(0, EXCERPT_MAX - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), EXCERPT_MAX - 40)).trimEnd()}…`;
}

/** Items of one feed. Entries without a title or without a usable link are skipped. */
export function parseFeed(xml: string, def: FeedDef): PolicyItem[] {
  const blocks = xml.match(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi) ?? [];
  const out: PolicyItem[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    const titleRaw = tag(b, ["title"]);
    const title = titleRaw ? cleanText(titleRaw) : "";
    const link = linkOf(b);
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);
    out.push({
      id: `${def.id}|${link}`, feedId: def.id, title, link,
      publishedAt: parseDate(tag(b, ["pubDate", "dc:date", "published", "updated", "a10:updated", "cb:occurrenceDate"])),
      excerpt: excerptOf(tag(b, ["description", "summary"]), title),
      institution: def.institution, institutionType: def.institutionType, contentType: def.contentType, currency: def.currency,
    });
  }
  return out;
}

/** True when the body looks like an RSS/Atom/RDF document (not an HTML error or challenge page). */
export const looksLikeFeed = (body: string) => /<(rss|feed|rdf:RDF)\b/i.test(body.slice(0, 4000));
