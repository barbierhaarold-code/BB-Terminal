/** @type {import('tailwindcss').Config} */
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
          bg: "#0a0a0a",
          bg2: "#111111",
          panel: "#141414",
          panel2: "#1a1a1a",
          border: "#2a2a2a",
          borderSoft: "#1f1f1f",
          amber: "#b45cff",
          amberDim: "#6d2ea6",
          amberBright: "#cd93ff",
          amberSubtle: "rgba(180,92,255,0.08)",
          green: "#22ee22",
          greenDim: "#128812",
          red: "#ff3b3b",
          redDim: "#9a1414",
          cyan: "#22ccee",
          muted: "#6e6e6e",
          text: "#d0d0d0",
          heading: "#f0f0f0",
        },
      },
      boxShadow: {
        panel: "0 0 0 1px rgba(180,92,255,0.05), 0 6px 20px -10px rgba(0,0,0,0.8)",
      },
    },
  },
  plugins: [],
};
