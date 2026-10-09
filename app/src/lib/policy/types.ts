// ────────────────────────────────────────────────────────────
// Policy Feed (POLICY) — shared types. Source: official RSS/Atom feeds of central banks and multilateral
// institutions. The terminal shows title, institution, type, date and a link back to the institution's own page;
// an excerpt only when the feed itself provides a description. Descriptive only.
// ────────────────────────────────────────────────────────────

export type InstitutionType = "central bank" | "multilateral" | "government";
export type ContentType = "press release" | "speech" | "research" | "statistics";
export type Currency = "USD" | "EUR" | "GBP" | "JPY" | "CHF" | "CAD" | "AUD" | "NZD" | "SEK";

export interface FeedDef {
  id: string;
  institution: string;
  institutionType: InstitutionType;
  /** derived from the institution, never from guessing text; null for multilateral bodies */
  currency: Currency | null;
  contentType: ContentType;
  /** short feed label shown in the health strip */
  label: string;
  url: string;
  /** provider-appropriate minimum time between fetches of this feed */
  cacheMs: number;
}

export interface PolicyItem {
  id: string;              // stable: feed id + link
  feedId: string;
  title: string;
  link: string;
  /** ISO timestamp, null when the feed gave no readable date (the item is kept, never dated by guess) */
  publishedAt: string | null;
  excerpt: string | null;
  institution: string;
  institutionType: InstitutionType;
  contentType: ContentType;
  currency: Currency | null;
}

export interface FeedHealth {
  id: string;
  institution: string;
  label: string;
  contentType: ContentType;
  url: string;
  ok: boolean;
  /** real cause when !ok */
  error?: string;
  items: number;
  newest: string | null;
  fetchedAt: string | null;
  /** true when the items shown come from an earlier successful fetch because the latest one failed */
  stale: boolean;
}

export interface PolicySnapshot {
  fetchedAt: string;
  cacheState: "HIT" | "MISS" | "STALE";
  feeds: FeedHealth[];
  items: PolicyItem[];
}

export interface PolicyFilter {
  institution?: string;
  institutionType?: InstitutionType;
  contentType?: ContentType;
  /** a currency code, or "none" for institutions without one (multilateral) */
  currency?: Currency | "none";
  query?: string;
  /** only items published strictly after this ISO timestamp */
  since?: string;
}
