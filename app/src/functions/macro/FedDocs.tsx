import { useMemo } from "react";
import { usePolicyFeed } from "@/lib/policy/client";
import { useUsCalendar } from "@/lib/macro/client";
import { ALL_BY_ID, seriesName } from "@/lib/macro/catalog";
import { INDICATOR_NAME } from "@/lib/macro/config";
import { docItems } from "@/lib/macro/docs";
import { dateLabel } from "@/lib/macro/math";
import type { PolicyItem } from "@/lib/policy/types";

// Fed and US official documents: the latest items from the official feeds the Policy Feed already reads (titles,
// dates, links; an excerpt only where the feed gives one), static links where no feed exists (said so), and the next
// release dates from FRED's machine-readable release calendar. Nothing here is summarised or reproduced.

interface Row { label: string; feed?: { institutions: string[]; match: RegExp }; link: { title: string; url: string }; noFeed?: string }

const ROWS: Row[] = [
  { label: "FOMC statement", feed: { institutions: ["Federal Reserve"], match: /FOMC statement/i }, link: { title: "FOMC meeting calendars, statements and minutes", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" } },
  { label: "FOMC minutes", feed: { institutions: ["Federal Reserve"], match: /^Minutes of the Federal Open Market Committee/i }, link: { title: "FOMC meeting calendars, statements and minutes", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" } },
  { label: "Summary of Economic Projections", feed: { institutions: ["Federal Reserve"], match: /economic projections/i }, link: { title: "FOMC calendar (projection materials are linked per meeting)", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" } },
  { label: "Monetary Policy Report", feed: { institutions: ["Federal Reserve"], match: /Semiannual Monetary Policy Report/i }, link: { title: "Monetary Policy Report", url: "https://www.federalreserve.gov/monetarypolicy/publications/mpr_default.htm" } },
  { label: "Beige Book", link: { title: "Beige Book", url: "https://www.federalreserve.gov/monetarypolicy/publications/beige-book-default.htm" }, noFeed: "The Federal Reserve publishes no feed for the Beige Book; see its page." },
  { label: "H.4.1 balance sheet", link: { title: "H.4.1 Factors Affecting Reserve Balances (weekly, Thursdays 4:30 p.m. ET)", url: "https://www.federalreserve.gov/releases/h41/" }, noFeed: "The Fed's H.4.1 feed carries only notices, not the weekly release; see the release page." },
  { label: "CPI (BLS)", link: { title: "BLS Consumer Price Index", url: "https://www.bls.gov/cpi/" }, noFeed: "BLS refuses automated feed readers (HTTP 403, checked 2026-10-13); not worked around." },
  { label: "Employment Situation (BLS)", link: { title: "BLS Employment Situation", url: "https://www.bls.gov/news.release/empsit.nr0.htm" }, noFeed: "BLS refuses automated feed readers (HTTP 403); not worked around." },
  { label: "GDP (BEA)", feed: { institutions: ["U.S. Bureau of Economic Analysis"], match: /\bGDP\b|Gross Domestic Product/i }, link: { title: "BEA Gross Domestic Product", url: "https://www.bea.gov/data/gdp/gross-domestic-product" } },
  { label: "Personal Income and Outlays, PCE (BEA)", feed: { institutions: ["U.S. Bureau of Economic Analysis"], match: /Personal Income and Outlays/i }, link: { title: "BEA Personal Income and Outlays", url: "https://www.bea.gov/data/income-saving/personal-income" } },
  { label: "Census economic indicators", feed: { institutions: ["U.S. Census Bureau"], match: /./ }, link: { title: "Census Bureau economic indicators", url: "https://www.census.gov/economic-indicators/" } },
];

function Item({ it }: { it: PolicyItem }) {
  return (
    <div className="leading-snug">
      <a href={it.link} target="_blank" rel="noreferrer noopener" className="underline hover:text-term-amber text-term-heading">{it.title}</a>
      <span className="text-term-muted"> · {it.publishedAt ? dateLabel(it.publishedAt) : "date not given by the feed"}</span>
      {it.excerpt && <div className="text-term-text text-[11px]">{it.excerpt} <span className="text-term-muted">(feed excerpt)</span></div>}
    </div>
  );
}

export function FedDocs({ onOpen }: { onOpen: (id: string) => void }) {
  const feed = usePolicyFeed();
  const cal = useUsCalendar();
  const rows = useMemo(() => ROWS.map((r) => ({ r, items: r.feed ? docItems(feed.data?.items ?? [], r.feed, r.label.startsWith("Census") ? 3 : 1) : [] })), [feed.data]);
  return (
    <div className="flex flex-col gap-2" data-testid="macro-fed-docs">
      <span className="sub-header">Fed and US official documents</span>
      <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
        <table className="w-full min-w-[760px] text-[12px]"><tbody>
          {rows.map(({ r, items }) => (
            <tr key={r.label} className="border-b border-term-borderSoft align-top">
              <td className="px-2 py-1.5 w-[220px] text-term-heading">{r.label}</td>
              <td className="px-2 py-1.5 text-[11px]">
                {r.feed ? (
                  feed.isPending ? <span className="text-term-muted">Loading official feeds…</span>
                    : feed.isError ? <span className="text-term-red">Policy Feed unavailable: {(feed.error as Error).message}</span>
                    : items.length ? <div className="grid gap-1">{items.map((it) => <Item key={it.id} it={it} />)}</div>
                    : <span className="text-term-muted">No item in the feed's current window.</span>
                ) : <span className="text-term-muted">{r.noFeed}</span>}
                <div className="text-[10px] mt-0.5"><a href={r.link.url} target="_blank" rel="noreferrer noopener" className="underline text-term-muted hover:text-term-amber">{r.link.title}</a></div>
              </td>
            </tr>
          ))}
        </tbody></table>
      </div>

      <div className="flex flex-col gap-1" data-testid="macro-us-calendar">
        <div className="text-term-heading text-[11px]">Next scheduled US releases</div>
        <div className="text-[10px] text-term-muted">
          From FRED's release calendar, which carries the agencies' published schedules (machine-readable). The FOMC meeting calendar is published only as a web page, not in machine-readable form: <a className="underline hover:text-term-amber" href="https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" target="_blank" rel="noreferrer noopener">FOMC meeting calendar</a>.
        </div>
        {cal.isPending ? <div className="text-term-muted text-[11px]" data-testid="macro-calendar-loading">Loading release calendar…</div>
          : cal.isError ? <div className="text-term-red text-[11px]" role="alert">Release calendar unavailable: {(cal.error as Error).message} <button onClick={() => cal.refetch()} className="underline">Retry</button></div>
          : cal.data.releases.length === 0 ? <div className="text-term-muted text-[11px]">No upcoming dates were returned.</div>
          : (
            <div className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 text-[11px] num">
              {cal.data.releases.map((r) => (
                <div key={r.releaseId} className="flex gap-2">
                  <span className="w-[92px] shrink-0 text-term-heading">{r.next ? dateLabel(r.next) : "not listed"}</span>
                  <span className="min-w-0">
                    {r.name}
                    {r.series.filter((s) => ALL_BY_ID[s]).map((s) => <button key={s} onClick={() => onOpen(s)} className="ml-1 underline text-term-muted hover:text-term-amber text-[10px]">{seriesName(ALL_BY_ID[s], INDICATOR_NAME)}</button>)}
                    {r.error && <span className="text-term-red"> ({r.error})</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}
