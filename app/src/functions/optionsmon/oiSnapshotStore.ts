import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface OiSnapshot {
  date: string; // YYYY-MM-DD
  byContract: Record<string, number>; // contract_symbol -> open_interest
}

interface OiSnapshotState {
  snapshots: Record<string, OiSnapshot>; // underlying symbol -> last saved snapshot
  /** The snapshot that `snapshots[symbol]` replaced (an earlier day), so a same-day
   * re-open still has something to diff against. Optional: absent in older saved data. */
  previous?: Record<string, OiSnapshot>;
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
      previous: {},
      save: (symbol, snapshot) =>
        set((s) => {
          const existing = s.snapshots[symbol];
          const replacesEarlierDay = existing && existing.date !== snapshot.date;
          return {
            snapshots: { ...s.snapshots, [symbol]: snapshot },
            previous: replacesEarlierDay ? { ...(s.previous ?? {}), [symbol]: existing } : (s.previous ?? {}),
          };
        }),
    }),
    { name: "abdelkhader-options-oi-snapshot" }
  )
);
