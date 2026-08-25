import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { fetchHistorical } from "@/lib/api";
import { alignByDate, pctReturns, correlation } from "@/lib/correlation";
import { cn } from "@/lib/cn";

const DEFAULT_BASKET = ["AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA"];
const LOOKBACKS = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

/** Green at +1, red at -1, transparent near 0 — reuses the up/down palette
 * everywhere else in the app instead of introducing a new color scale. */
function cellStyle(r: number | undefined) {
  if (r == null) return {};
  const alpha = Math.min(1, Math.abs(r)) * 0.55;
  const color = r >= 0 ? `rgba(34,238,34,${alpha})` : `rgba(255,59,59,${alpha})`;
  return { backgroundColor: color };
}

export function CorrelationMatrixPanel() {
  const [basketInput, setBasketInput] = useState(DEFAULT_BASKET.join(", "));
  const [basket, setBasket] = useState<string[]>(DEFAULT_BASKET);
  const [lookback, setLookback] = useState(LOOKBACKS[1]);

  const startDate = useMemo(
    () => new Date(Date.now() - lookback.days * 864e5).toISOString().slice(0, 10),
    [lookback.days]
  );
  const queries = useQueries({
    queries: basket.map((s) => ({
      queryKey: ["quant-corr-closes", s, lookback.days],
      queryFn: () => fetchHistorical(s, { interval: "1d", start_date: startDate }),
      staleTime: 60_000,
    })),
  });

  const anyLoading = queries.some((q) => q.isLoading);
  const anyError = queries.some((q) => q.isError);

  const matrix = useMemo(() => {
    return basket.map((_, i) =>
      basket.map((_, j) => {
        if (i === j) return 1;
        const a = queries[i].data, b = queries[j].data;
        if (!a || !b) return undefined;
        const [ac, bc] = alignByDate(a, b);
        return correlation(pctReturns(ac), pctReturns(bc));
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basket, queries.map((q) => q.dataUpdatedAt).join(",")]);

  function applyBasket() {
    const parsed = Array.from(new Set(
      basketInput.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    )).slice(0, 12);
    if (parsed.length >= 2) setBasket(parsed);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-3 h-8 px-3 border-b border-term-border bg-term-panel2 text-[10px] uppercase tracking-wider">
        <input
          value={basketInput}
          onChange={(e) => setBasketInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && applyBasket()}
          placeholder="AAPL, MSFT, GOOGL…"
          className="bg-term-panel border border-term-border px-2 py-0.5 text-term-text placeholder:text-term-muted focus:outline-none focus:border-term-amber text-[11px] normal-case tracking-normal w-72"
        />
        <button onClick={applyBasket} className="px-2 py-0.5 border border-term-border text-term-muted hover:text-term-amber hover:border-term-amber">
          Apply
        </button>
        <div className="flex items-center gap-1 ml-auto">
          {LOOKBACKS.map((l) => (
            <button key={l.label} onClick={() => setLookback(l)}
              className={cn("px-1.5 py-0.5 border",
                l.label === lookback.label ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text")}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scroll-thin p-2">
        {anyError && <div className="text-term-red text-[11px] p-2">Failed to load one or more symbols' price history.</div>}
        <table className="grid-data w-full border-collapse text-[11px]">
          <thead>
            <tr>
              <th></th>
              {basket.map((s) => <th key={s} className="text-center">{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {basket.map((row, i) => (
              <tr key={row}>
                <th className="text-left">{row}</th>
                {basket.map((col, j) => {
                  const r = matrix[i]?.[j];
                  return (
                    <td key={col} className="num text-center" style={cellStyle(r)}>
                      {anyLoading && r == null ? "…" : r != null ? r.toFixed(2) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
