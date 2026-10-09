import { POLICY_NOTE } from "./config";
import { filterItems } from "./filter";
import type { Currency, ContentType, InstitutionType, PolicySnapshot } from "./types";

export interface PolicyToolInput { limit?: unknown; institution?: unknown; institution_type?: unknown; content_type?: unknown; currency?: unknown; query?: unknown; since_days?: unknown }

const ITYPES: InstitutionType[] = ["central bank", "multilateral", "government"];
const CTYPES: ContentType[] = ["press release", "speech", "research", "statistics"];

/** Read-only Copilot payload: last N items with filters, the same snapshot as the page, plus feed health. */
export function summarisePolicy(snap: PolicySnapshot, input: PolicyToolInput, nowMs: number) {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(input.limit ?? 20)) || 20));
  const str = (v: unknown) => (v == null || String(v).trim() === "" ? undefined : String(v).trim());
  const inst = str(input.institution)?.toLowerCase();
  const institution = inst ? [...new Set(snap.items.map((i) => i.institution).concat(snap.feeds.map((f) => f.institution)))].find((n) => n.toLowerCase().includes(inst)) : undefined;
  if (inst && !institution) return { available: false as const, error: `No institution matches "${str(input.institution)}". Feeds: ${[...new Set(snap.feeds.map((f) => f.institution))].join("; ")}.` };
  const it = str(input.institution_type)?.toLowerCase() as InstitutionType | undefined;
  if (it && !ITYPES.includes(it)) return { available: false as const, error: `institution_type must be one of ${ITYPES.join(", ")}.` };
  const ct = str(input.content_type)?.toLowerCase() as ContentType | undefined;
  if (ct && !CTYPES.includes(ct)) return { available: false as const, error: `content_type must be one of ${CTYPES.join(", ")}.` };
  const cur = str(input.currency)?.toUpperCase();
  const days = Number(input.since_days);
  const since = Number.isFinite(days) && days > 0 ? new Date(nowMs - days * 86_400_000).toISOString() : undefined;
  const items = filterItems(snap.items, { institution, institutionType: it, contentType: ct, currency: cur === "NONE" ? "none" : (cur as Currency | undefined), query: str(input.query), since });
  return {
    available: true as const,
    fetchedAt: snap.fetchedAt,
    matching: items.length,
    items: items.slice(0, limit).map((i) => ({ publishedAt: i.publishedAt, institution: i.institution, institutionType: i.institutionType, contentType: i.contentType, currency: i.currency, title: i.title, excerptFromFeed: i.excerpt, link: i.link })),
    feedHealth: { reachable: snap.feeds.filter((f) => f.ok).length, unavailable: snap.feeds.filter((f) => !f.ok).map((f) => ({ feed: `${f.institution} — ${f.label}`, reason: f.error, showingOlderItems: f.stale })) },
    meta: { note: POLICY_NOTE, instruction: "Quote the title, institution and date, and give the link. These are official publications as listed; do not summarise content you have not read, do not infer a policy stance from a title, and never present an item as a signal or advice. Say which feeds are unavailable instead of assuming nothing was published there." },
  };
}
