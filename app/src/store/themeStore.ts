import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ThemeMode = "dark" | "light";

interface ThemeState {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
}

/**
 * App-wide light/dark theme. Same zustand + `persist` shape as
 * `workspaceStore` / `favoritesStore`, storage key `bbterminal-theme`, so the
 * choice survives a reload. Defaults to `dark` on first load.
 *
 * The actual switch is a `data-theme` attribute on <html> (see App.tsx and the
 * inline anti-FOUC script in index.html) — every `term-*` design token is a CSS
 * variable that flips on that attribute. The violet accent (`term-amber*`
 * family) is intentionally identical in both modes per the locked branding;
 * only background / surface / border / text tokens change.
 */
export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: "dark",
      toggle: () => set({ mode: get().mode === "dark" ? "light" : "dark" }),
      setMode: (m) => set({ mode: m }),
    }),
    { name: "bbterminal-theme" }
  )
);

/** Narrow selector — components that only need the current mode string. */
export const useThemeMode = () => useTheme((s) => s.mode);
