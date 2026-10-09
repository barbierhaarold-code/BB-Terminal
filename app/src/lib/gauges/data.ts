import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { fetchHistorical } from "@/lib/api";
import { PAIRS, VOL_INDICES } from "./config";
import { strengthBoard, volReading } from "./math";
import type { Bar, StrengthBoard, VolFailure, VolReading } from "./types";

// ────────────────────────────────────────────────────────────
// GAUGES data layer. TWO requests in total, run in parallel (the browser allows 6 connections per origin and the rest
// of the terminal needs most of them): one for the 7 USD pairs (≈90 days), one for the 5 volatility indices (≈5 years).
// Both go through the existing server-cached /api proxy (Yahoo via OpenBB); no new source and no Twelve Data credits.
// Each series fails on its own: a missing index or pair is reported with its cause and the rest still shows.
// ────────────────────────────────────────────────────────────

const FX_DAYS = 90;
const VOL_DAYS = 5 * 365 + 20;
const STALE_MS = 15 * 60_000;

export interface GaugesBundle {
  vol: VolReading[];
  volFailures: VolFailure[];
  strength: StrengthBoard;
  fxError: string | null;
  fetchedAt: string;
  loadMs: number;
}

type Row = { date: string; close: number | null; symbol?: string };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const startDate = (days: number) => new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);

function group(rows: unknown, byYahoo: Map<string, string>): Record<string, Bar[]> {
  const out: Record<string, Bar[]> = {};
  for (const r of Array.isArray(rows) ? (rows as Row[]) : []) {
    const id = r.symbol ? byYahoo.get(r.symbol) : undefined;
    if (!id || r.close == null) continue;
    (out[id] ??= []).push({ date: String(r.date).slice(0, 10), close: Number(r.close) });
  }
  return out;
}

export async function fetchGaugesBundle(): Promise<GaugesBundle> {
  const t0 = performance.now();
  const fxMap = new Map(PAIRS.map((p) => [p.yahoo, p.id]));
  const volMap = new Map(VOL_INDICES.map((v) => [v.yahoo, v.id]));
  const [fx, vol] = await Promise.allSettled([
    fetchHistorical(PAIRS.map((p) => p.yahoo).join(","), { interval: "1d", start_date: startDate(FX_DAYS) }),
    fetchHistorical(VOL_INDICES.map((v) => v.yahoo).join(","), { interval: "1d", start_date: startDate(VOL_DAYS) }),
  ]);

  const volReadings: VolReading[] = [];
  const volFailures: VolFailure[] = [];
  const volBars = vol.status === "fulfilled" ? group(vol.value, volMap) : {};
  for (const d of VOL_INDICES) {
    if (vol.status === "rejected") { volFailures.push({ id: d.id, label: d.label, error: errText(vol.reason) }); continue; }
    if (!volBars[d.id]?.length) { volFailures.push({ id: d.id, label: d.label, error: `Yahoo returned no rows for ${d.yahoo}` }); continue; }
    const r = volReading(d, volBars[d.id]);
    if ("error" in r) volFailures.push({ id: d.id, label: d.label, error: r.error }); else volReadings.push(r);
  }
  const fxBars = fx.status === "fulfilled" ? group(fx.value, fxMap) : {};
  const strength = strengthBoard(fxBars);
  const fxError = fx.status === "rejected" ? errText(fx.reason) : null;

  if (volReadings.length === 0 && strength.pairsUsed.length === 0) {
    throw new Error(`No volatility or currency history could be loaded: ${[fxError, ...volFailures.map((f) => f.error)].filter(Boolean).slice(0, 2).join(" · ") || "empty answers"}.`);
  }
  return { vol: volReadings, volFailures, strength, fxError, fetchedAt: new Date().toISOString(), loadMs: Math.round(performance.now() - t0) };
}

export const gaugesQuery = { queryKey: ["gauges", "bundle"] as const, queryFn: fetchGaugesBundle, staleTime: STALE_MS, retry: 0 };
export const useGauges = () => useQuery(gaugesQuery);
export const getGauges = () => queryClient.fetchQuery(gaugesQuery);
