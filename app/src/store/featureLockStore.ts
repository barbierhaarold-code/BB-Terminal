import { create } from "zustand";

/** Features the server can gate behind a per-email allowlist (vite-plugins/auth.ts).
 *  A 403 {"error":"feature_locked","feature":...} flips the matching flag on; the
 *  next successful call to that proxy flips it back off, so the UI recovers on its
 *  own once access is restored. This is a presentation-only mirror of the server's
 *  verdict — it never grants access, it only decides which panel to render. */
export type LockableFeature = "copilot" | "tweets" | "ais";

interface FeatureLockState {
  locked: Record<LockableFeature, boolean>;
  setLocked: (feature: LockableFeature, value: boolean) => void;
}

export const useFeatureLock = create<FeatureLockState>((set) => ({
  locked: { copilot: false, tweets: false, ais: false },
  setLocked: (feature, value) =>
    set((s) => (s.locked[feature] === value ? s : { locked: { ...s.locked, [feature]: value } })),
}));
