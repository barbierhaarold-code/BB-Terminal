import { create } from "zustand";

// "Seen" flag lives in plain localStorage, one key per Supabase user id, so each account
// gets the tutorial once per browser. Deliberately NOT a zustand `persist` store and not
// part of any shared store (Track Record / Portfolio / Copilot / workspace are untouched).
const keyFor = (userId: string) => `ak-tutorial-seen:${userId}`;

export function hasSeenTutorial(userId: string): boolean {
  try { return localStorage.getItem(keyFor(userId)) === "1"; } catch { return true; } // storage blocked → never nag
}
export function markTutorialSeen(userId: string): void {
  try { localStorage.setItem(keyFor(userId), "1"); } catch { /* ignore */ }
}

interface TutorialState {
  open: boolean;
  step: number;
  start: () => void;
  close: () => void;
  setStep: (n: number) => void;
}

export const useTutorial = create<TutorialState>((set) => ({
  open: false,
  step: 0,
  start: () => set({ open: true, step: 0 }),
  close: () => set({ open: false }),
  setStep: (n) => set({ step: n }),
}));
