import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/store/themeStore";

/** Light/dark switch — lives in the persistent top bar. Choice persists in localStorage (`bbterminal-theme`). */
export function ThemeToggle() {
  const mode = useTheme((s) => s.mode);
  const toggle = useTheme((s) => s.toggle);
  const label = mode === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <button
      onClick={toggle}
      title={label}
      aria-label={label}
      className="flex items-center justify-center w-7 h-7 border border-term-border text-term-muted hover:border-term-amberDim hover:text-term-amberBright transition-colors"
    >
      {mode === "dark" ? <Sun size={13} strokeWidth={2} /> : <Moon size={13} strokeWidth={2} />}
    </button>
  );
}
