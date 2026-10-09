// Freezes what Market Context (LEAN) and COT show for one instrument right now, as facts with their own
// as-of dates. Reuses the exact cached fetchers of those pages (no new network source). Never a forecast.
import { getMarketLeanResults } from "@/lib/lean/data";
import { INSTRUMENTS } from "@/lib/lean/config";
import { getCotSnapshot, cotContract, cotCategory, cotSnapshotMeta } from "@/lib/cot";
import { normalizeSymbol, type ContextSnapshot } from "@/lib/tradePlan";

export const CONTEXT_NOTE = "Frozen copy of what Market Context and COT showed at takenAt, each with its own as-of date. Facts, not a forecast or a signal. COT is weekly (positions as of Tuesday).";

export function instrumentForSymbol(symbol: string) {
  const n = normalizeSymbol(symbol);
  return INSTRUMENTS.find((i) => normalizeSymbol(i.id) === n || normalizeSymbol(i.short) === n);
}

export async function buildContextSnapshot(symbol: string): Promise<ContextSnapshot> {
  const inst = instrumentForSymbol(symbol);
  const takenAt = new Date().toISOString();
  if (!inst) {
    const reason = `No Market Context or COT mapping for "${symbol}".`;
    return { takenAt, symbol, market: { available: false, reason }, cot: { available: false, reason }, note: CONTEXT_NOTE };
  }

  // Both fetches are attempted independently so one failure doesn't hide the other; failures are stored as reasons.
  const [leanRes, cotRes] = await Promise.allSettled([getMarketLeanResults(), getCotSnapshot()]);

  let market: ContextSnapshot["market"];
  if (leanRes.status === "rejected") {
    market = { available: false, reason: `Market Context failed to load: ${(leanRes.reason as Error).message}` };
  } else {
    const r = leanRes.value.results.find((x) => x.instrumentId === inst.id);
    market = !r || r.label === "No data"
      ? { available: false, reason: `Market Context has no data for ${inst.id} right now.` }
      : {
          available: true, instrumentId: inst.id, backdrop: r.label, backdropName: r.backdropName,
          composite: r.composite, driverAgreement: r.driverAgreement, asOf: r.freshness.ownLastBar,
          drivers: r.drivers.map((d) => ({ id: d.id, label: d.label, direction: d.direction, score: d.score, weight: d.weight })),
          warnings: r.warnings,
        };
  }

  let cot: ContextSnapshot["cot"];
  if (!inst.cot) cot = { available: false, reason: `No COT contract is mapped to ${inst.id}.` };
  else if (cotRes.status === "rejected") cot = { available: false, reason: `COT failed to load: ${(cotRes.reason as Error).message}` };
  else {
    const c = cotContract(cotRes.value, inst.cot.contractKey);
    if (!c) cot = { available: false, reason: `Contract "${inst.cot.contractKey}" is not in the COT snapshot.` };
    else if (!c.available) cot = { available: false, reason: c.reason };
    else {
      const cat = cotCategory(c, inst.cot.groupId);
      cot = {
        available: true, contractKey: c.key, contractName: c.name, groupLabel: cat.label, positionsAsOf: c.asOf,
        net: cat.net, changeNet: cat.changeNet, pct3y: cat.pct3y, pct5y: cat.pct5y, source: cotSnapshotMeta(cotRes.value).source,
      };
    }
  }
  return { takenAt, symbol, market, cot, note: CONTEXT_NOTE };
}
