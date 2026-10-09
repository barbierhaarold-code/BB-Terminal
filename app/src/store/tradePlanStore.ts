import { create } from "zustand";
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware";
import { PLAN_SCHEMA_VERSION, parsePlansBlob, type TradePlan } from "@/lib/tradePlan";

export const PLANS_STORAGE_KEY = "bbterminal-trade-plans";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface PlanState {
  plans: TradePlan[];
  /** Real cause when the persisted plans could not be read (shown with a Retry in the UI). */
  loadError: string | null;
  addPlan: (p: Omit<TradePlan, "id" | "createdAt" | "updatedAt">) => TradePlan;
  updatePlan: (id: string, patch: Partial<Omit<TradePlan, "id" | "createdAt">>) => void;
  deletePlan: (id: string) => void;
  /** Re-read the persisted value (used by the error state's Retry). */
  reload: () => void;
  /** Start from an empty list after a load failure (the unreadable raw value was already kept under a .corrupt key). */
  discardUnreadable: () => void;
}

/** Wraps localStorage so a corrupt value is kept aside instead of being overwritten on the next save. */
const safeStorage: StateStorage = {
  getItem: (name) => {
    const raw = localStorage.getItem(name);
    if (raw == null) return null;
    try { JSON.parse(raw); } catch (e) {
      try { localStorage.setItem(`${name}.corrupt`, raw); } catch { /* ignore */ }
      throw new Error(`Saved plans are not valid JSON (${(e as Error).message}). The raw value was kept under "${name}.corrupt".`);
    }
    return raw;
  },
  setItem: (name, value) => localStorage.setItem(name, value),
  removeItem: (name) => localStorage.removeItem(name),
};

/**
 * Trade plans — their OWN persisted store (never part of `bbterminal-journal`), so a plan bug can't touch trades.
 * Plans point at a journal trade by id (`review.tradeId`); the trade store is never written from here.
 */
export const useTradePlans = create<PlanState>()(
  persist(
    (set, get) => ({
      plans: [],
      loadError: null,

      addPlan: (p) => {
        const now = new Date().toISOString();
        const plan: TradePlan = { ...p, id: newId(), createdAt: now, updatedAt: now };
        set({ plans: [...get().plans, plan] });
        return plan;
      },
      updatePlan: (id, patch) => set({
        plans: get().plans.map((p) => (p.id === id ? { ...p, ...patch, id: p.id, createdAt: p.createdAt, updatedAt: new Date().toISOString() } : p)),
      }),
      deletePlan: (id) => set({ plans: get().plans.filter((p) => p.id !== id) }),
      reload: () => { void useTradePlans.persist.rehydrate(); },
      discardUnreadable: () => set({ plans: [], loadError: null }),
    }),
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
