import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OiSnapshot {
  date: string; // YYYY-MM-DD
  byContract: Record<string, number>; // contract_symbol -> open_interest
}

interface OiSnapshotState {
  snapshots: Record<string, OiSnapshot>; // underlying symbol -> last saved snapshot
  save: (symbol: string, snapshot: OiSnapshot) => void;
}

/**
 * EOD open-interest cache used only to detect day-over-day OI jumps for the
 * Unusual Activity tab. This app has no backend persistence for historical
 * chain snapshots, so this is a client-only, one-slot-per-symbol cache
 * (today overwrites yesterday) — it can only ever diff against the most
 * recent *prior* day this symbol was viewed, not a full history.
 */
export const useOiSnapshotStore = create<OiSnapshotState>()(
  persist(
    (set) => ({
      snapshots: {},
      save: (symbol, snapshot) =>
        set((s) => ({ snapshots: { ...s.snapshots, [symbol]: snapshot } })),
    }),
    { name: "abdelkhader-options-oi-snapshot" }
  )
);
