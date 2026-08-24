import { create } from "zustand";
import { persist } from "zustand/middleware";

const DEFAULT_ACCOUNTS = [
  "DeItaone", "unusual_whales", "OptionsHawk", "zerohedge", "KobeissiLetter",
  "FirstSquawk", "LiveSquawk", "WatcherGuru", "spectatorindex",
];

const DEFAULT_KEYWORDS = [
  "Fed", "rate", "CPI", "tariff", "war", "sanctions", "Powell", "Trump",
  "OPEC", "jobs report", "recession", "default", "downgrade", "ceasefire",
];

interface TweetsSettingsState {
  accounts: string[];
  keywords: string[];
  pollMinutes: number;
  addAccount: (handle: string) => void;
  removeAccount: (handle: string) => void;
  addKeyword: (keyword: string) => void;
  removeKeyword: (keyword: string) => void;
  setPollMinutes: (minutes: number) => void;
}

/** Persisted Tweets-tab settings (tracked accounts, HIGH-IMPACT keywords,
 * poll interval) — same zustand+persist shape as favoritesStore, so the
 * editable account/keyword list survives reloads. */
export const useTweetsSettings = create<TweetsSettingsState>()(
  persist(
    (set, get) => ({
      accounts: DEFAULT_ACCOUNTS,
      keywords: DEFAULT_KEYWORDS,
      pollMinutes: 15,
      addAccount: (handle) => {
        const h = handle.trim().replace(/^@/, "");
        if (!h || get().accounts.includes(h)) return;
        set({ accounts: [...get().accounts, h] });
      },
      removeAccount: (handle) => set({ accounts: get().accounts.filter((a) => a !== handle) }),
      addKeyword: (keyword) => {
        const k = keyword.trim();
        if (!k || get().keywords.includes(k)) return;
        set({ keywords: [...get().keywords, k] });
      },
      removeKeyword: (keyword) => set({ keywords: get().keywords.filter((k) => k !== keyword) }),
      setPollMinutes: (minutes) => set({ pollMinutes: Math.max(1, Math.round(minutes)) }),
    }),
    { name: "bbterminal-tweets-settings" }
  )
);
