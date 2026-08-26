import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Position, NewPosition } from "@/lib/portfolio";

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

interface PortfolioState {
  positions: Position[];
  addPosition: (p: NewPosition) => void;
  updatePosition: (id: string, patch: Partial<NewPosition>) => void;
  removePosition: (id: string) => void;
}

/**
 * Open-position tracker — local-only (localStorage via the `persist`
 * middleware), same pattern as workspaceStore/favoritesStore/journalStore.
 * Distinct from journalStore: that one is closed-trade history (manual entry
 * or bulk import), this one is live open positions the P&L/allocation/risk
 * panels compute against — different in kind, so the two stores don't merge.
 */
export const usePortfolio = create<PortfolioState>()(
  persist(
    (set, get) => ({
      positions: [],
      addPosition: (p) => set({
        positions: [...get().positions, { ...p, symbol: p.symbol.toUpperCase(), id: newId() }],
      }),
      updatePosition: (id, patch) => set({
        positions: get().positions.map((pos) =>
          pos.id === id
            ? { ...pos, ...patch, symbol: (patch.symbol ?? pos.symbol).toUpperCase() }
            : pos
        ),
      }),
      removePosition: (id) => set({ positions: get().positions.filter((pos) => pos.id !== id) }),
    }),
    { name: "bbterminal-portfolio" }
  )
);
