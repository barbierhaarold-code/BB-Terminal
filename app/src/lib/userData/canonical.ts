// Canonical form + SHA-256 for before/after evidence. Key order and array order
// of trades/plans/setups (sorted by id) can differ after a server round trip;
// the canonical form removes that, so equal data ⇒ equal hash.
// pricesHidden is excluded: it is a per-device preference, not account data.

import type { Setup, Trade } from "@/lib/journal";
import type { TradePlan } from "@/lib/tradePlan";

export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : canonicalJson(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function canonicalData(d: { trades: Trade[]; setups: Setup[]; baseCapital: number | null; plans: TradePlan[] }): string {
  return canonicalJson({
    trades: [...d.trades].sort(byId), setups: [...d.setups].sort(byId), baseCapital: d.baseCapital, plans: [...d.plans].sort(byId),
  });
}

export const hashData = (d: Parameters<typeof canonicalData>[0]): Promise<string> => sha256Hex(canonicalData(d));
