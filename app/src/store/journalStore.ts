import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import type { Trade, NewTrade, Setup } from "@/lib/journal";
import { isServerMode } from "@/lib/userData/backend";
import { registerUserDataStore } from "@/lib/userData/registry";
import { currentUserId } from "@/lib/userData/runtime";
import { startUserDataSession, refreshUserData } from "@/lib/userData/session";
import { refuseWrite, submitWrite } from "@/lib/userData/sync";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Default account base capital (USD — the currency trade results are
 * already recorded in). LOCAL mode only: a server account starts with NO base
 * capital (null) and capital-relative stats read n/a until the user sets one. */
export const DEFAULT_BASE_CAPITAL = 43_000;

/** Per-DEVICE display preference in server mode (never stored on the server). A key of its own,
 * so it can never touch `bbterminal-journal`. In local mode `pricesHidden` stays inside the journal blob as before. */
export const DEVICE_PRICES_HIDDEN_KEY = "bbterminal-prices-hidden";
const readDevicePricesHidden = (): boolean => { try { return localStorage.getItem(DEVICE_PRICES_HIDDEN_KEY) === "1"; } catch { return false; } };
const writeDevicePricesHidden = (v: boolean) => { try { localStorage.setItem(DEVICE_PRICES_HIDDEN_KEY, v ? "1" : "0"); } catch { /* preference only */ } };

export type DataStatus = "idle" | "loading" | "ready" | "error";

interface JournalState {
  trades: Trade[];
  setups: Setup[];
  /** null = not set (server accounts start here). Local mode is never null. */
  baseCapital: number | null;
  /** Privacy toggle — masks dollar figures across Track Record. Ratios and
   * percentages stay visible since they don't reveal exact dollar amounts. */
  pricesHidden: boolean;
  /** Server mode: which account's data this is. Local mode: always "ready", no owner. */
  status: DataStatus;
  ownerId: string | null;
  loadError: string | null;
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
  /** server mode: re-read the account (Retry on the load error) */
  reload: () => void;
}

/** In server mode this store NEVER reads or writes localStorage: account data must not be able to overwrite
 * the local Track Record, and local data must not leak into an account. The mode is checked at call time. */
const guardedStorage: StateStorage = {
  getItem: (name) => (isServerMode() ? null : localStorage.getItem(name)),
  setItem: (name, value) => { if (!isServerMode()) localStorage.setItem(name, value); },
  removeItem: (name) => { if (!isServerMode()) localStorage.removeItem(name); },
};

/** Server mode: is this store holding the signed-in user's loaded data? */
export function journalWritable(s: Pick<JournalState, "status" | "ownerId">): boolean {
  return !isServerMode() || (s.status === "ready" && s.ownerId !== null && s.ownerId === currentUserId());
}

const NOT_READY = "Your journal is not loaded yet (or could not be loaded), so this change was not saved.";

function reinsert<T>(list: T[], item: T, index: number): T[] {
  const out = list.slice();
  out.splice(Math.min(Math.max(index, 0), out.length), 0, item);
  return out;
}

/**
 * Trade journal — closed-trade history/log. Two backends behind one API:
 *  - local (default): localStorage via `persist`, exactly as before;
 *  - server: per-user rows (Supabase, RLS) through the adapter, optimistic with
 *    rollback (see lib/userData/sync.ts). Never broker-synced: every row came from
 *    the manual entry form or the bulk paste-import.
 */
export const useJournal = create<JournalState>()(
  persist(
    (set, get) => {
      /** local → run `local`; server → optimistic `apply` + queued remote write (or refuse, visibly) */
      const write = (label: string, local: () => void, op: { apply: () => void; undo: () => void; remote: Parameters<typeof submitWrite>[0]["remote"] }) => {
        if (!isServerMode()) { local(); return; }
        if (!journalWritable(get())) { refuseWrite(NOT_READY); return; }
        submitWrite({ label, ...op });
      };

      return {
        trades: [],
        setups: [],
        baseCapital: isServerMode() ? null : DEFAULT_BASE_CAPITAL,
        pricesHidden: isServerMode() ? readDevicePricesHidden() : false,
        status: isServerMode() ? "idle" : "ready",
        ownerId: null,
        loadError: null,

        addTrade: (t) => {
          const row: Trade = { ...t, id: newId(), createdAt: new Date().toISOString() };
          write("Saving trade", () => set({ trades: [...get().trades, row] }), {
            apply: () => set({ trades: [...get().trades, row] }),
            undo: () => set({ trades: get().trades.filter((x) => x.id !== row.id) }),
            remote: (a) => a.insertTrades([row]),
          });
        },

        updateTrade: (id, patch) => {
          const prev = get().trades.find((t) => t.id === id);
          write("Updating trade", () => set({ trades: get().trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), {
            apply: () => set({ trades: get().trades.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
            undo: () => { if (prev) set({ trades: get().trades.map((t) => (t.id === id ? prev : t)) }); },
            remote: (a) => a.updateTrade(id, patch),
          });
        },

        deleteTrade: (id) => {
          const index = get().trades.findIndex((t) => t.id === id);
          const prev = get().trades[index];
          write("Deleting trade", () => set({ trades: get().trades.filter((t) => t.id !== id) }), {
            apply: () => set({ trades: get().trades.filter((t) => t.id !== id) }),
            undo: () => { if (prev) set({ trades: reinsert(get().trades, prev, index) }); },
            remote: (a) => a.deleteTrade(id),
          });
        },

        bulkAddTrades: (ts) => {
          const now = new Date().toISOString();
          const rows: Trade[] = ts.map((t) => ({ ...t, id: newId(), createdAt: now }));
          const ids = new Set(rows.map((r) => r.id));
          write("Saving imported trades", () => set({ trades: [...get().trades, ...rows] }), {
            apply: () => set({ trades: [...get().trades, ...rows] }),
            undo: () => set({ trades: get().trades.filter((x) => !ids.has(x.id)) }),
            remote: (a) => a.insertTrades(rows),
          });
          return rows.length;
        },

        addSetup: (name) => {
          const trimmed = name.trim();
          const existing = get().setups.find((s) => s.name.toLowerCase() === trimmed.toLowerCase());
          if (existing) return existing;
          const s: Setup = { id: newId(), name: trimmed };
          write("Saving setup", () => set({ setups: [...get().setups, s] }), {
            apply: () => set({ setups: [...get().setups, s] }),
            undo: () => set({ setups: get().setups.filter((x) => x.id !== s.id) }),
            remote: (a) => a.insertSetup(s),
          });
          return s;
        },

        renameSetup: (id, name) => {
          const prev = get().setups.find((s) => s.id === id);
          const next = name.trim();
          write("Renaming setup", () => set({ setups: get().setups.map((s) => (s.id === id ? { ...s, name: next } : s)) }), {
            apply: () => set({ setups: get().setups.map((s) => (s.id === id ? { ...s, name: next } : s)) }),
            undo: () => { if (prev) set({ setups: get().setups.map((s) => (s.id === id ? prev : s)) }); },
            remote: (a) => a.renameSetup(id, next),
          });
        },

        deleteSetup: (id) => {
          const index = get().setups.findIndex((s) => s.id === id);
          const prev = get().setups[index];
          const touched = get().trades.filter((t) => t.setupId === id).map((t) => t.id);
          const apply = () => set({
            setups: get().setups.filter((s) => s.id !== id),
            trades: get().trades.map((t) => (t.setupId === id ? { ...t, setupId: undefined } : t)),
          });
          write("Deleting setup", apply, {
            apply,
            undo: () => set({
              setups: prev ? reinsert(get().setups, prev, index) : get().setups,
              trades: get().trades.map((t) => (touched.includes(t.id) ? { ...t, setupId: id } : t)),
            }),
            remote: (a) => a.deleteSetup(id),
          });
        },

        assignSetup: (tradeIds, setupId) => {
          const ids = tradeIds.filter((id) => get().trades.some((t) => t.id === id));
          const before = new Map(get().trades.filter((t) => ids.includes(t.id)).map((t) => [t.id, t.setupId]));
          const apply = () => set({ trades: get().trades.map((t) => (tradeIds.includes(t.id) ? { ...t, setupId } : t)) });
          write("Updating setup tags", apply, {
            apply,
            undo: () => set({ trades: get().trades.map((t) => (before.has(t.id) ? { ...t, setupId: before.get(t.id) } : t)) }),
            remote: (a) => a.updateTrades(ids, { setupId }),
          });
        },

        setBaseCapital: (n) => {
          if (!(Number.isFinite(n) && n > 0)) return;
          const prev = get().baseCapital;
          write("Saving base capital", () => set({ baseCapital: n }), {
            apply: () => set({ baseCapital: n }),
            undo: () => set({ baseCapital: prev }),
            remote: (a) => a.saveBaseCapital(n),
          });
        },

        togglePricesHidden: () => {
          const next = !get().pricesHidden;
          set({ pricesHidden: next });
          if (isServerMode()) writeDevicePricesHidden(next); // device preference only
        },

        reload: () => refreshUserData(),
      };
    },
    {
      name: "bbterminal-journal",
      storage: createJSONStorage(() => guardedStorage),
      // Exactly the keys (and order) persisted before server mode existed: local storage stays byte-identical.
      partialize: (s) => ({ trades: s.trades, setups: s.setups, baseCapital: s.baseCapital, pricesHidden: s.pricesHidden }),
    }
  )
);

const EMPTY = { trades: [], setups: [], baseCapital: null, status: "idle", ownerId: null, loadError: null } as const;

registerUserDataStore({
  reset: () => useJournal.setState({ ...EMPTY, trades: [], setups: [], pricesHidden: readDevicePricesHidden() }),
  loading: (userId) => {
    const s = useJournal.getState();
    if (s.status === "ready" && s.ownerId === userId) return; // background refresh: keep showing the data
    useJournal.setState({ ...EMPTY, trades: [], setups: [], status: "loading", ownerId: userId });
  },
  loaded: (userId, snap) => useJournal.setState({
    trades: snap.trades, setups: snap.setups, baseCapital: snap.baseCapital, status: "ready", ownerId: userId, loadError: null,
  }),
  failed: (userId, message) => {
    const s = useJournal.getState();
    if (s.status === "ready" && s.ownerId === userId) { refuseWrite(`Could not refresh your journal: ${message}`); return; }
    useJournal.setState({ ...EMPTY, trades: [], setups: [], status: "error", ownerId: userId, loadError: message });
  },
});

startUserDataSession();
