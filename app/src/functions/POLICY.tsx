import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { CURRENCIES, INSTITUTIONS, POLICY_NOTE } from "@/lib/policy/config";
import { usePolicyFeed, REFRESH_MS } from "@/lib/policy/client";
import { filterItems, isNew } from "@/lib/policy/filter";
import type { ContentType, Currency, FeedHealth, InstitutionType, PolicyItem } from "@/lib/policy/types";
import { dateLabel } from "@/lib/macro/math";
import { DataNote, EmptyBlock } from "./research/shared";

const inputCls = "bg-term-panel border border-term-border px-2 py-1 text-term-text focus:outline-none focus:border-term-amber";
const VISIT_KEY = "bbterminal-policy-lastvisit";
const PAGE = 100;

function readVisit(): string | null { try { return localStorage.getItem(VISIT_KEY); } catch { return null; } }
function writeVisit(iso: string) { try { localStorage.setItem(VISIT_KEY, iso); } catch { /* storage may be blocked: markers just stay off */ } }

const stamp = (iso: string | null) => {
  if (!iso) return "date n/a";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
};

export function POLICY() {
  const q = usePolicyFeed();
  const snap = q.data;
  // The previous visit is read once on mount; the new visit time is written when the page is left.
  const [prevVisit] = useState<string | null>(readVisit);
  const openedAt = useRef(new Date().toISOString());
  useEffect(() => {
    const save = () => writeVisit(new Date().toISOString());
    window.addEventListener("pagehide", save);
    return () => { window.removeEventListener("pagehide", save); save(); };
  }, []);

  const [institution, setInstitution] = useState("");
  const [institutionType, setInstitutionType] = useState<InstitutionType | "">("");
  const [contentType, setContentType] = useState<ContentType | "">("");
  const [currency, setCurrency] = useState<Currency | "none" | "">("");
  const [query, setQuery] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const items = useMemo(() => filterItems(snap?.items ?? [], {
    institution: institution || undefined, institutionType: institutionType || undefined, contentType: contentType || undefined,
    currency: currency || undefined, query, since: onlyNew && prevVisit ? prevVisit : undefined,
  }), [snap, institution, institutionType, contentType, currency, query, onlyNew, prevVisit]);
  const newCount = useMemo(() => (snap?.items ?? []).filter((i) => isNew(i, prevVisit)).length, [snap, prevVisit]);
  const reachable = snap?.feeds.filter((f) => f.ok).length ?? 0;

  return (
    <div className="h-full overflow-auto scroll-thin flex flex-col gap-3 p-3 text-[12px] [&>*]:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-term-amber text-[11px] tracking-[0.25em] font-bold">POLICY FEED</span>
            <span className="text-term-muted text-[11px]">official central-bank and multilateral publications · as published · not a signal</span>
          </div>
          {snap && (
            <div className="text-[11px] num text-term-text" data-testid="policy-status">
              Fetched {stamp(snap.fetchedAt)} · {reachable} of {snap.feeds.length} feeds readable · {snap.items.length} items · server cache {snap.cacheState} · refreshes every {REFRESH_MS / 60_000} min
              {prevVisit ? <> · previous visit {stamp(prevVisit)}</> : <> · first visit on this browser: nothing is marked new yet</>}
            </div>
          )}
        </div>
        <button onClick={() => q.refetch()} title="Refresh" className="text-term-muted hover:text-term-amber shrink-0 mt-0.5" data-testid="policy-refresh">
          <RefreshCw size={13} className={cn(q.isFetching && "animate-spin")} />
        </button>
      </div>

      {q.isPending && <div className="p-3 text-term-muted uppercase tracking-widest text-[11px]" data-testid="policy-loading">Loading official feeds…</div>}
      {q.isError && !q.isPending && (
        <div className="p-3 text-term-red flex flex-col items-start gap-2 text-[12px]" role="alert" data-testid="policy-error">
          <div><span className="sub-header text-term-red mr-1">ERROR</span>{(q.error as Error).message}</div>
          <button onClick={() => q.refetch()} className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
            <RefreshCw size={11} className={cn(q.isFetching && "animate-spin")} /> Retry
          </button>
        </div>
      )}

      {snap && (
        <>
          <HealthStrip feeds={snap.feeds} />

          <div className="flex items-center gap-2 flex-wrap" data-testid="policy-filters">
            <select value={institution} onChange={(e) => { setInstitution(e.target.value); setShown(PAGE); }} className={inputCls} aria-label="Institution" data-testid="policy-f-institution">
              <option value="">All institutions</option>{INSTITUTIONS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <select value={institutionType} onChange={(e) => { setInstitutionType(e.target.value as InstitutionType | ""); setShown(PAGE); }} className={inputCls} aria-label="Institution type" data-testid="policy-f-itype">
              <option value="">All institution types</option><option value="central bank">Central banks</option><option value="multilateral">Multilateral</option><option value="government">Government</option>
            </select>
            <select value={contentType} onChange={(e) => { setContentType(e.target.value as ContentType | ""); setShown(PAGE); }} className={inputCls} aria-label="Content type" data-testid="policy-f-ctype">
              <option value="">All content types</option><option value="press release">Press releases</option><option value="speech">Speeches</option><option value="research">Research</option><option value="statistics">Statistics</option>
            </select>
            <select value={currency} onChange={(e) => { setCurrency(e.target.value as Currency | "none" | ""); setShown(PAGE); }} className={inputCls} aria-label="Currency" data-testid="policy-f-currency">
              <option value="">All currencies</option>{CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}<option value="none">No currency (BIS, IMF)</option>
            </select>
            <input value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE); }} placeholder="Search titles and excerpts" className={cn(inputCls, "w-64")} aria-label="Search" data-testid="policy-search" />
            <label className="flex items-center gap-1.5 text-term-muted text-[11px] cursor-pointer select-none">
              <input type="checkbox" checked={onlyNew} onChange={(e) => { setOnlyNew(e.target.checked); setShown(PAGE); }} disabled={!prevVisit} data-testid="policy-only-new" />
              Only new since my last visit{prevVisit ? ` (${newCount})` : ""}
            </label>
            <span className="text-term-muted text-[11px]" data-testid="policy-count">{items.length} items</span>
          </div>

          {items.length === 0 ? (
            <EmptyBlock>{snap.items.length === 0 ? "No feed returned items." : "No item matches these filters."}</EmptyBlock>
          ) : (
            <div className="border border-term-borderSoft" data-testid="policy-list">
              {items.slice(0, shown).map((it) => <Row key={it.id} it={it} fresh={isNew(it, prevVisit)} />)}
            </div>
          )}
          {items.length > shown && (
            <button onClick={() => setShown((n) => n + PAGE)} className="self-start px-2 py-1 border border-term-border text-term-muted hover:text-term-amber text-[11px] uppercase tracking-wider" data-testid="policy-more">Show more ({items.length - shown} left)</button>
          )}
          <div className="text-[10px] text-term-muted">Opened {stamp(openedAt.current)}. Dates are the feed's own publication times shown in your local time zone. Click a title to open the institution's own page.</div>
        </>
      )}

      <DataNote>
        <p className="mb-1.5"><b>What this is.</b> {POLICY_NOTE}</p>
        <p className="mb-1.5"><b>Feeds and health.</b> Each institution's feeds are read directly (keyless, honest User-Agent, no scraping) and refreshed at most every 15 minutes, with at least a second between requests to the same site. If a feed cannot be read, the health strip says why (for example HTTP 403 when a site refuses automated readers, which is never worked around) and the other feeds keep working. A feed that failed after working keeps showing its older items marked stale.</p>
        <p><b>Reading the labels.</b> Content type is the feed's category (a Bank of England "news" feed is shown as press release; the BIS "central bankers' speeches" feed carries speeches by many central banks and is attributed to the BIS). The currency comes from the issuing central bank, never from the words in a title. "New" means published after your previous visit on this browser. The date shown is the feed's publication date; the institution's own page can show a different date for the event itself (for example an interview given on 23 September and posted on 8 October).</p>
      </DataNote>
    </div>
  );
}

function Row({ it, fresh }: { it: PolicyItem; fresh: boolean }) {
  return (
    <div className="px-3 py-2 border-b border-term-borderSoft last:border-b-0 flex gap-3" data-testid="policy-row">
      <div className="w-[120px] shrink-0 text-term-muted text-[11px] num leading-snug">
        {stamp(it.publishedAt)}
        {fresh && <div><span data-testid="policy-new" className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-term-amber text-term-amber">NEW</span></div>}
      </div>
      <div className="min-w-0 flex-1">
        <a href={it.link} target="_blank" rel="noreferrer noopener" className="text-term-heading hover:text-term-amber underline-offset-2 hover:underline break-words">{it.title}</a>
        <div className="text-[10px] text-term-muted mt-0.5">
          {it.institution} · {it.institutionType} · {it.contentType}{it.currency ? ` · ${it.currency}` : ""}
        </div>
        {it.excerpt && <div className="text-[11px] text-term-text mt-1 leading-snug break-words" data-testid="policy-excerpt">{it.excerpt}</div>}
      </div>
    </div>
  );
}

function HealthStrip({ feeds }: { feeds: FeedHealth[] }) {
  const by = new Map<string, FeedHealth[]>();
  for (const f of feeds) by.set(f.institution, [...(by.get(f.institution) ?? []), f]);
  return (
    <details open className="border border-term-borderSoft" data-testid="policy-health">
      <summary className="px-3 py-1.5 cursor-pointer sub-header select-none">Feed health — {feeds.filter((f) => f.ok).length} of {feeds.length} readable</summary>
      <div className="px-3 pb-2 grid gap-1 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
        {[...by].map(([inst, list]) => (
          <div key={inst} className="min-w-0">
            <div className="text-term-heading">{inst}</div>
            {list.map((f) => (
              <div key={f.id} className="text-term-muted leading-snug" data-testid={`policy-feed-${f.id}`}>
                {f.ok
                  ? <>{f.label}: {f.items} {f.items === 1 ? "item" : "items"} · newest {f.newest ? dateLabel(f.newest) : "n/a"}</>
                  : <span className="text-term-text">{f.label}: <b>unavailable</b> ({f.error}){f.stale ? ` · showing ${f.items} older items` : ""}</span>}
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}
