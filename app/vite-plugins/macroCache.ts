import fs from "node:fs";
import path from "node:path";
import type { SeriesDef } from "../src/lib/macro/types";

// ────────────────────────────────────────────────────────────
// Disk cache for the Macro Hub, so a server restart does not refetch every series (FRED in particular: its budget is
// 120 requests/minute per key and a cold start used to cost ~75 of them). One JSON file per entry:
//   { v, source, seriesId, fetchedAt, value }
// `value` is what the upstream answered, already normalized (observations, dates, provider, public source URL). Never a
// key: entries are built from parsed answers, never from request URLs, and `set` refuses to write any text that
// contains a configured secret.
//
// Directory: MACRO_CACHE_DIR (absolute, or relative to the working directory), default `.macro-cache` next to the
// server (app/.macro-cache in dev, /srv/.macro-cache in the gateway image; gitignored). MACRO_CACHE_DIR=off disables
// it (memory only, as before). If the directory cannot be written (read-only filesystem, no volume) the cache logs one
// warning and the server keeps working from memory.
//
// Freshness is decided when an entry is READ (fetchedAt + TTL), so changing a TTL below applies to entries on disk.
// ────────────────────────────────────────────────────────────

/**
 * How long a series is reused before it is asked for again, by publication frequency.
 *   daily     6 h: market rates and the daily Treasury statement change every business day; 6 h keeps the value at
 *                  most one print behind during the day and matches the cache the daily sources already used.
 *   weekly   12 h: one release a week (claims, H.4.1, H.8); 12 h bounds the delay after release day to half a day.
 *   monthly  24 h: one release a month; showing a new print up to a day late costs little, and it halves the
 *                  requests compared with the previous 12 h.
 *   quarterly 48 h: at most one release a month (advance, second, third estimate); two days late is acceptable for
 *                  data this slow, and these series are the most numerous on the slow end.
 * Older entries are still served (marked STALE, up to 7 days) when the source is down or the FRED breaker is open.
 */
export const FREQ_TTL_MS: Record<SeriesDef["frequency"], number> = {
  daily: 6 * 3_600_000,
  weekly: 12 * 3_600_000,
  monthly: 24 * 3_600_000,
  quarterly: 48 * 3_600_000,
};

export interface DiskEntry<T> { v: 1; source: string; seriesId: string; fetchedAt: string; value: T }

export interface MacroDiskCache {
  dir: string;
  get<T>(key: string): DiskEntry<T> | null;
  set<T>(key: string, e: { source: string; seriesId: string; fetchedAt: string; value: T }): void;
  /** removes every entry (dev outage-simulation switch with clear=1) */
  clear(): void;
}

/** The configured cache directory, or null when disabled. */
export function resolveCacheDir(env: Record<string, string | undefined>): string | null {
  const raw = (env.MACRO_CACHE_DIR ?? process.env.MACRO_CACHE_DIR)?.trim();
  if (raw === "off") return null;
  return path.resolve(process.cwd(), raw || ".macro-cache");
}

export function createDiskCache(dir: string, secrets: Array<string | undefined>): MacroDiskCache {
  const fileOf = (key: string) => path.join(dir, `${encodeURIComponent(key)}.json`);
  const guard = secrets.filter((s): s is string => !!s && s.trim().length >= 4).map((s) => s.trim());
  let warned = false;
  const warnOnce = (why: string) => { if (!warned) { warned = true; console.warn(`[macro-proxy] disk cache at ${dir} not writable (${why}); caching in memory only.`); } };
  return {
    dir,
    get<T>(key: string) {
      try {
        const e = JSON.parse(fs.readFileSync(fileOf(key), "utf8")) as DiskEntry<T>;
        return e?.v === 1 && typeof e.fetchedAt === "string" && Number.isFinite(Date.parse(e.fetchedAt)) && e.value !== undefined ? e : null;
      } catch { return null; }
    },
    set(key, e) {
      const text = JSON.stringify({ v: 1, ...e });
      if (guard.some((s) => text.includes(s))) { console.warn(`[macro-proxy] disk cache: entry ${key} not written (it contained a configured secret).`); return; }
      try {
        fs.mkdirSync(dir, { recursive: true });
        const file = fileOf(key), tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, text);
        fs.renameSync(tmp, file);
      } catch (err) { warnOnce((err as NodeJS.ErrnoException).code ?? String(err)); }
    },
    clear() {
      try { for (const f of fs.readdirSync(dir)) if (f.endsWith(".json")) fs.rmSync(path.join(dir, f), { force: true }); } catch { /* nothing to clear */ }
    },
  };
}
