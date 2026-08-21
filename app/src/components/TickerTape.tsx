import { useQueries, useQuery } from "@tanstack/react-query";
import { type Candle, type SpotQuote, SPOT_GOLD_SYMBOL } from "@/lib/api";
import {
  intradayStats, intradayQueryOptions, spotQueryOptions,
  TICKER_INSTRUMENTS, TICKER_FUTURES, type FxKind,
} from "@/lib/forex";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/cn";

interface TapeItem { pair: string; symbol: string; digits: number; kind: FxKind }

// FX/silver reuse the board's shared cache; index futures price the same way
// (intraday close), routed through the equity endpoint via kind "metal".
// Gold is NOT in this list — it's sourced separately from the Twelve Data
// spot feed (real XAU/USD, matching GP's chart) and prepended below.
const ITEMS: TapeItem[] = [
  ...TICKER_INSTRUMENTS.map((i) => ({ pair: i.pair, symbol: i.symbol, digits: i.digits, kind: i.kind })),
  ...TICKER_FUTURES.map((f) => ({ pair: f.pair, symbol: f.symbol, digits: f.digits, kind: "metal" as FxKind })),
];
// De-dupe by symbol so a pair listed twice shares one query.
const UNIQUE: TapeItem[] = Array.from(new Map(ITEMS.map((i) => [i.symbol, i])).values());

export function TickerTape() {
  const results = useQueries({ queries: UNIQUE.map((i) => intradayQueryOptions(i)) });
  const gold = useQuery(spotQueryOptions(SPOT_GOLD_SYMBOL));

  const bySym = new Map<string, ReturnType<typeof buildRow>>();
  UNIQUE.forEach((it, i) => {
    bySym.set(it.symbol, buildRow(it, results[i].data as Candle[] | undefined));
  });
  const cells = [buildSpotRow("GOLD", gold.data), ...ITEMS.map((it) => bySym.get(it.symbol)!)];
  const anyData = results.some((r) => r.data) || !!gold.data;

  if (!anyData) {
    return (
      <div className="h-6 flex items-center px-3 border-t border-term-border bg-term-bg2 text-[11px] text-term-muted uppercase tracking-widest">
        Loading tape…
      </div>
    );
  }

  return (
    <div className="marquee-viewport h-6 overflow-hidden border-t border-term-border bg-term-bg2 flex items-center">
      <div className="marquee-track">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex items-center" aria-hidden={dup === 1}>
            {cells.map((c, i) => (
              <span key={dup + "-" + i} className="flex items-center gap-2 px-4 text-[11px] num border-r border-term-borderSoft">
                <span className="text-term-amber font-semibold">{c.pair}</span>
                <span className="text-term-text">{c.priceStr}</span>
                <span className={cn(c.dir === "up" && "up", c.dir === "down" && "down", c.dir === "flat" && "text-term-muted")}>
                  {c.dir === "up" ? "▲" : c.dir === "down" ? "▼" : "·"} {fmtPct(c.chgPct)}
                </span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function buildRow(it: TapeItem, candles?: Candle[]) {
  const s = intradayStats(candles);
  const last = s.last, prev = s.prevClose;
  const chgPct = last != null && prev ? ((last - prev) / prev) * 100 : undefined;
  const dir: "up" | "down" | "flat" = chgPct == null ? "flat" : chgPct >= 0 ? "up" : "down";
  const priceStr = last != null
    ? last.toLocaleString(undefined, { minimumFractionDigits: it.digits, maximumFractionDigits: it.digits })
    : "—";
  return { pair: it.pair, priceStr, chgPct, dir };
}

function buildSpotRow(pair: string, q?: SpotQuote) {
  const last = q?.last, prev = q?.prevClose;
  const chgPct = last != null && prev ? ((last - prev) / prev) * 100 : undefined;
  const dir: "up" | "down" | "flat" = chgPct == null ? "flat" : chgPct >= 0 ? "up" : "down";
  const priceStr = last != null ? last.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
  return { pair, priceStr, chgPct, dir };
}
