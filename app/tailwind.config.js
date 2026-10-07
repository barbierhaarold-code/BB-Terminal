/** @type {import('tailwindcss').Config} */

// Every `term-*` colour is now a CSS variable (space-separated RGB triplet) so
// the whole palette can flip between dark and light at runtime via the
// `data-theme` attribute on <html> — see app/src/index.css for the two value
// sets and app/src/store/themeStore.ts for the toggle.
//
// The `<alpha-value>` placeholder keeps Tailwind's slash-opacity modifiers
// working (e.g. `bg-term-green/40`, `border-term-red/50`).
//
// LOCKED BRANDING: the violet accent (`amber`, `amberDim`, `amberBright`,
// `amberSubtle`) resolves to the exact same values in both themes. Only
// background / surface / border / text tokens differ between modes.
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: [
          "IBM Plex Mono",
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
        sans: [
          "Inter var",
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        term: {
          bg: rgb("--term-bg"),
          bg2: rgb("--term-bg2"),
          panel: rgb("--term-panel"),
          panel2: rgb("--term-panel2"),
          border: rgb("--term-border"),
          borderSoft: rgb("--term-border-soft"),
          amber: rgb("--term-amber"),
          amberDim: rgb("--term-amber-dim"),
          amberBright: rgb("--term-amber-bright"),
          // 8% violet tint — identical in both modes (locked branding).
          amberSubtle: "rgb(var(--term-amber) / 0.08)",
          green: rgb("--term-green"),
          greenDim: rgb("--term-green-dim"),
          red: rgb("--term-red"),
          redDim: rgb("--term-red-dim"),
          cyan: rgb("--term-cyan"),
          muted: rgb("--term-muted"),
          text: rgb("--term-text"),
          heading: rgb("--term-heading"),
        },
      },
      boxShadow: {
        panel: "0 0 0 1px rgb(var(--term-amber) / 0.05), 0 6px 20px -10px rgba(0,0,0,0.8)",
      },
    },
  },
  plugins: [],
};
