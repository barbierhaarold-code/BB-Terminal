import { create } from "zustand";
import type { Direction } from "@/lib/journal";

/**
 * One pre-filled-but-unsaved trade draft, handed to the "Log a Trade" form's
 * initial state by the Copilot's `prefill_track_record_entry` tool.
 *
 * This is deliberately NOT a write path to the journal:
 *  - it never touches `useJournal`'s `trades` array,
 *  - it is not persisted (no `persist` middleware), so it can't survive a
 *    reload or masquerade as a logged trade,
 *  - `TradeForm` reads it once to seed its own local `useState`, then calls
 *    `clear()` — the only way a row is ever saved is Harold clicking
 *    "Log Trade", which runs the form's existing `addTrade()` path.
 * It's a scratch buffer between the copilot and the form, nothing more.
 */
export interface TradeDraft {
  symbol?: string;
  direction?: Direction;
  size?: string;
  entryPrice?: string;
  exitPrice?: string;
  /** `datetime-local` value ("YYYY-MM-DDTHH:mm") */
  entryAt?: string;
  exitAt?: string;
  /** setup *name* — the form resolves it to an id, creating the setup if new */
  setupName?: string;
  macroBias?: string;
  conviction?: string;
  newsEvent?: string;
  feeling?: string;
  notes?: string;
}

interface TradeDraftState {
  draft: TradeDraft | null;
  /** Bumped on every `setDraft` so the form re-seeds even if the same values
   * are pre-filled twice in a row. */
  nonce: number;
  setDraft: (d: TradeDraft) => void;
  clear: () => void;
}

export const useTradeDraft = create<TradeDraftState>((set, get) => ({
  draft: null,
  nonce: 0,
  setDraft: (d) => set({ draft: d, nonce: get().nonce + 1 }),
  clear: () => set({ draft: null }),
}));
