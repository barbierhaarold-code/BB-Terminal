import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { PLAN_SCHEMA_VERSION, parsePlansBlob, type TradePlan } from "@/lib/tradePlan";
import { isServerMode } from "@/lib/userData/backend";
import { registerUserDataStore } from "@/lib/userData/registry";
import { currentUserId } from "@/lib/userData/runtime";
import { startUserDataSession, refreshUserData } from "@/lib/userData/session";
import { refuseWrite, submitWrite } from "@/lib/userData/sync";
import type { DataStatus } from "@/store/journalStore";

export const PLANS_STORAGE_KEY = "bbterminal-trade-plans";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface PlanState {
  plans: TradePlan[];
  /** Real cause when the plans could not be read (local: unreadable value; server: load failure). Shown with a Retry in the UI. */
  loadError: string | null;
  /** Server mode: which account's data this is. Local mode: always "ready", no owner. */
  status: DataStatus;
  ownerId: string | null;
  addPlan: (p: Omit<TradePlan, "id" | "createdAt" | "updatedAt">) => TradePlan;
  updatePlan: (id: string, patch: Partial<Omit<TradePlan, "id" | "createdAt">>) => void;
  deletePlan: (id: string) => void;
  /** Re-read (used by the error state's Retry): local → the persisted value, server → the account. */
  reload: () => void;
  /** Start from an empty list after a local load failure (the unreadable raw value was already kept under a .corrupt key). */
  discardUnreadable: () => void;
}

/** Wraps localStorage so a corrupt value is kept aside instead of being overwritten on the next save.
 * In server mode it touches nothing: account data can never overwrite (or read) the local plans. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    if (isServerMode()) return null;
    const raw = localStorage.getItem(name);
    if (raw == null) return null;
    try { JSON.parse(raw); } catch (e) {
      try { localStorage.setItem(`${name}.corrupt`, raw); } catch { /* ignore */ }
      throw new Error(`Saved plans are not valid JSON (${(e as Error).message}). The raw value was kept under "${name}.corrupt".`);
    }
    return raw;
  },
  setItem: (name, value) => { if (!isServerMode()) localStorage.setItem(name, value); },
  removeItem: (name) => { if (!isServerMode()) localStorage.removeItem(name); },
};

export function plansWritable(s: Pick<PlanState, "status" | "ownerId">): boolean {
  return !isServerMode() || (s.status === "ready" && s.ownerId !== null && s.ownerId === currentUserId());
}

const NOT_READY = "Your plans are not loaded yet (or could not be loaded), so this change was not saved.";

/**
 * Trade plans — their OWN store (never part of `bbterminal-journal`), so a plan bug can't touch trades.
 * Plans point at a journal trade by id (`review.tradeId`); the trade store is never written from here.
 * Local backend: localStorage as before. Server backend: per-user rows, optimistic with rollback.
 */
export const useTradePlans = create<PlanState>()(
  persist(
    (set, get) => {
      const write = (label: string, local: () => void, op: { apply: () => void; undo: () => void; remote: Parameters<typeof submitWrite>[0]["remote"] }) => {
        if (!isServerMode()) { local(); return; }
        if (!plansWritable(get())) { refuseWrite(NOT_READY); return; }
        submitWrite({ label, ...op });
      };

      return {
        plans: [],
        loadError: null,
        status: isServerMode() ? "idle" : "ready",
        ownerId: null,

        addPlan: (p) => {
          const now = new Date().toISOString();
          const plan: TradePlan = { ...p, id: newId(), createdAt: now, updatedAt: now };
          write("Saving plan", () => set({ plans: [...get().plans, plan] }), {
            apply: () => set({ plans: [...get().plans, plan] }),
            undo: () => set({ plans: get().plans.filter((x) => x.id !== plan.id) }),
            remote: (a) => a.insertPlan(plan),
          });
          return plan;
        },

        updatePlan: (id, patch) => {
          const index = get().plans.findIndex((p) => p.id === id);
          const prev = get().plans[index];
          if (!prev) return;
          const next: TradePlan = { ...prev, ...patch, id: prev.id, createdAt: prev.createdAt, updatedAt: new Date().toISOString() };
          write("Updating plan", () => set({ plans: get().plans.map((p) => (p.id === id ? { ...p, ...patch, id: p.id, createdAt: p.createdAt, updatedAt: next.updatedAt } : p)) }), {
            apply: () => set({ plans: get().plans.map((p) => (p.id === id ? { ...p, ...patch, id: p.id, createdAt: p.createdAt, updatedAt: next.updatedAt } : p)) }),
            undo: () => set({ plans: get().plans.map((p) => (p.id === id ? prev : p)) }),
            // the plan as it is in memory at send time (earlier queued edits already applied)
            remote: (a) => a.updatePlan(get().plans.find((p) => p.id === id) ?? next),
          });
        },

        deletePlan: (id) => {
          const index = get().plans.findIndex((p) => p.id === id);
          const prev = get().plans[index];
          write("Deleting plan", () => set({ plans: get().plans.filter((p) => p.id !== id) }), {
            apply: () => set({ plans: get().plans.filter((p) => p.id !== id) }),
            undo: () => {
              if (!prev) return;
              const out = get().plans.slice();
              out.splice(Math.min(index, out.length), 0, prev);
              set({ plans: out });
            },
            remote: (a) => a.deletePlan(id),
          });
        },

        reload: () => { if (isServerMode()) refreshUserData(); else void useTradePlans.persist.rehydrate(); },
        discardUnreadable: () => set({ plans: [], loadError: null }),
      };
    },
    {
      name: PLANS_STORAGE_KEY,
      version: PLAN_SCHEMA_VERSION,
      storage: createJSONStorage(() => safeStorage),
      partialize: (s) => ({ plans: s.plans }),
      // Reject a structurally broken value instead of crashing the tab.
      merge: (persisted, current) => {
        if (persisted == null) return current;
        const res = parsePlansBlob({ schemaVersion: PLAN_SCHEMA_VERSION, plans: (persisted as { plans?: unknown }).plans });
        if (!res.ok) {
          try { localStorage.setItem(`${PLANS_STORAGE_KEY}.corrupt`, JSON.stringify(persisted)); } catch { /* ignore */ }
          return { ...current, loadError: `${res.error} The raw value was kept under "${PLANS_STORAGE_KEY}.corrupt".` };
        }
        return { ...current, plans: res.blob.plans, loadError: null };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error) useTradePlans.setState({ loadError: (error as Error).message });
      },
    },
  ),
);

registerUserDataStore({
  reset: () => useTradePlans.setState({ plans: [], loadError: null, status: "idle", ownerId: null }),
  loading: (userId) => {
    const s = useTradePlans.getState();
    if (s.status === "ready" && s.ownerId === userId) return;
    useTradePlans.setState({ plans: [], loadError: null, status: "loading", ownerId: userId });
  },
  loaded: (userId, snap) => useTradePlans.setState({ plans: snap.plans, loadError: null, status: "ready", ownerId: userId }),
  failed: (userId, message) => {
    const s = useTradePlans.getState();
    if (s.status === "ready" && s.ownerId === userId) return; // the journal store already reported the refresh failure
    useTradePlans.setState({ plans: [], loadError: message, status: "error", ownerId: userId });
  },
});

startUserDataSession();
