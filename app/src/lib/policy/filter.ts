import type { PolicyFilter, PolicyItem } from "./types";

/** Newest first; undated items last (stable by title). Duplicate links across feeds keep the first occurrence. */
export function mergeItems(lists: PolicyItem[][], max: number): PolicyItem[] {
  const seen = new Set<string>();
  const all: PolicyItem[] = [];
  for (const l of lists) for (const it of l) { if (seen.has(it.link)) continue; seen.add(it.link); all.push(it); }
  all.sort((a, b) => {
    if (a.publishedAt && b.publishedAt) return b.publishedAt.localeCompare(a.publishedAt) || a.title.localeCompare(b.title);
    if (a.publishedAt) return -1;
    if (b.publishedAt) return 1;
    return a.title.localeCompare(b.title);
  });
  return all.slice(0, max);
}

export function filterItems(items: PolicyItem[], f: PolicyFilter): PolicyItem[] {
  const q = f.query?.trim().toLowerCase();
  return items.filter((it) => {
    if (f.institution && it.institution !== f.institution) return false;
    if (f.institutionType && it.institutionType !== f.institutionType) return false;
    if (f.contentType && it.contentType !== f.contentType) return false;
    if (f.currency) { if (f.currency === "none" ? it.currency !== null : it.currency !== f.currency) return false; }
    if (f.since && !(it.publishedAt && it.publishedAt > f.since)) return false;
    if (q && !(`${it.title} ${it.excerpt ?? ""} ${it.institution}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

/** Items newer than the previous visit are "new". With no previous visit nothing is marked (everything would be). */
export function isNew(it: PolicyItem, lastVisit: string | null): boolean {
  return !!lastVisit && !!it.publishedAt && it.publishedAt > lastVisit;
}
