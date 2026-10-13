import type { PolicyItem } from "../policy/types";

/**
 * Policy Feed items relevant to an indicator: from the named institutions, title matching the pattern, newest first.
 * Reuses the Policy Feed's own items (no second feed reader). Items without a date sort last and are never dated by guess.
 */
export function docItems(items: PolicyItem[], feed: { institutions: string[]; match: RegExp } | undefined, max: number): PolicyItem[] {
  if (!feed) return [];
  const inst = new Set(feed.institutions);
  return items
    .filter((it) => inst.has(it.institution) && feed.match.test(it.title))
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
    .slice(0, max);
}
