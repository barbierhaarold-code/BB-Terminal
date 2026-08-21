import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Trade, NewTrade, Setup } from "@/lib/journal";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Default account base capital (USD — the currency trade results are
 * already recorded in). Purely a display baseline for capital-relative
 * stats; never validated against or synced to anything. */
export const DEFAULT_BASE_CAPITAL = 43_000;

interface JournalState {
  trades: Trade[];
  setups: Setup[];
  baseCapital: number;
  /** Privacy toggle — masks dollar figures across Track Record. Ratios and
   * percentages stay visible since they don't reveal exact dollar amounts. */
  pricesHidden: boolean;
  addTrade: (t: NewTrade) => void;
  updateTrade: (id: string, patch: Partial<Trade>) => void;
  deleteTrade: (id: string) => void;
  bulkAddTrades: (ts: NewTrade[]) => number;
  addSetup: (name: string) => Setup;
  renameSetup: (id: string, name: string) => void;
  deleteSetup: (id: string) => void;
  assignSetup: (tradeIds: string[], setupId: string | undefined) => void;
  setBaseCapital: (n: number) => void;
  togglePricesHidden: () => void;
}

/**
 * Trade journal — closed-trade history/log, local-only (localStorage,
 * `persist` middleware, same pattern as favoritesStore/workspaceStore).
 * Never broker-synced: every row here came from the manual entry form or
 * the bulk paste-import, nothing here talks to a live account. Overlaps in
 * spirit with the *planned* Portfolio tracker (open positions, live) — that
 * one should reuse this same local-persistence pattern when built, not
 * duplicate it, but its data (open, broker-linked) is different in kind
 * from this (closed, manual/imported) and the two stores shouldn't merge.
 */
export const useJournal = create<JournalState>()(
  persist(
    (set, get) => ({
      trades: [],
      setups: [],
      baseCapital: DEFAULT_BASE_CAPITAL,
      pricesHidden: false,

      addTrade: (t) => set({ trades: [...get().trades, { ...t, id: newId(), createdAt: new Date().toISOString() }] }),

      updateTrade: (id, patch) => set({
        trades: get().trades.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }),

      deleteTrade: (id) => set({ trades: get().trades.filter((t) => t.id !== id) }),

      bulkAddTrades: (ts) => {
        const now = new Date().toISOString();
        const rows: Trade[] = ts.map((t) => ({ ...t, id: newId(), createdAt: now }));
        set({ trades: [...get().trades, ...rows] });
        return rows.length;
      },

      addSetup: (name) => {
        const trimmed = name.trim();
        const existing = get().setups.find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing;
        const s: Setup = { id: newId(), name: trimmed };
        set({ setups: [...get().setups, s] });
        return s;
      },

      renameSetup: (id, name) => set({
        setups: get().setups.map((s) => (s.id === id ? { ...s, name: name.trim() } : s)),
      }),

      deleteSetup: (id) => set({
        setups: get().setups.filter((s) => s.id !== id),
        trades: get().trades.map((t) => (t.setupId === id ? { ...t, setupId: undefined } : t)),
      }),

      assignSetup: (tradeIds, setupId) => set({
        trades: get().trades.map((t) => (tradeIds.includes(t.id) ? { ...t, setupId } : t)),
      }),

      setBaseCapital: (n) => set({ baseCapital: Number.isFinite(n) && n > 0 ? n : get().baseCapital }),
      togglePricesHidden: () => set({ pricesHidden: !get().pricesHidden }),
    }),
    { name: "bbterminal-journal" }
  )
);
