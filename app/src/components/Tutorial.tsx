import { useEffect } from "react";
import { X } from "lucide-react";
import { useAuth } from "@/store/authStore";
import { useWorkspace } from "@/store/workspaceStore";
import { useTutorial, hasSeenTutorial, markTutorialSeen } from "@/store/tutorialStore";
import type { FunctionCode } from "@/lib/functions";

interface Step {
  title: string;
  body: string[];
  /** Optional function code to open behind the card ("Open it"). */
  open?: { code: FunctionCode; label: string; symbol?: string };
}

const STEPS: Step[] = [
  {
    title: "Welcome to Abdel Khader",
    body: [
      "A multi-asset market terminal: stocks, FX, gold, crypto, options, news and a world map in one place.",
      "This tour takes about two minutes. You can skip it at any time and replay it later from HELP.",
    ],
  },
  {
    title: "Navigation and the command bar",
    body: [
      "The terminal is driven by function codes. Type a code in the command bar at the top and press Enter (or GO). Put a ticker first to target it, for example TSLA OMON.",
      "The menu bar under it groups the same screens, and HELP lists every code. Each screen opens as a tab you can close or reopen.",
    ],
    open: { code: "HELP", label: "Open HELP (all function codes)" },
  },
  {
    title: "Command Center (CC)",
    body: ["Your morning briefing: US index cards, a gold (XAU/USD) panel, index performance, sector moves and more on one screen."],
    open: { code: "CC", label: "Open Command Center" },
  },
  {
    title: "Forex Center (FXC)",
    body: ["Major and cross FX pairs, gold and silver, a trading-sessions clock, FX news and gold-focused context such as positioning (COT) data."],
    open: { code: "FXC", label: "Open Forex Center" },
  },
  {
    title: "News Hub (NH)",
    body: ["Headlines plus an economic calendar, earnings, corporate actions, prediction markets, Fed-related data, market hours and live TV, in separate tabs. Some tabs may be members-only."],
    open: { code: "NH", label: "Open News Hub" },
  },
  {
    title: "Equity Research (RESEARCH)",
    body: [
      "A deep dive on one company: summary, valuation (DCF and a quick estimate), fundamentals, financial statements, earnings, ownership, analyst ratings and peers.",
      "Use a ticker first, for example AAPL RESEARCH. Typing just a ticker opens a one-screen scorecard (INTEL). Data is mostly from Yahoo Finance, so some fields can be missing or delayed.",
    ],
    open: { code: "RESEARCH", symbol: "AAPL", label: "Open Equity Research (AAPL)" },
  },
  {
    title: "Options Monitor (OMON)",
    body: [
      "The options chain with six views: Chain, Expected Range, Implied Vol, Open Interest, Unusual Activity and Greeks Exposure.",
      "Data is delayed and can take several seconds to load for large tickers. Unusual Activity is an end-of-day estimate, not a live flow feed.",
    ],
    open: { code: "OMON", symbol: "AAPL", label: "Open Options Monitor (AAPL)" },
  },
  {
    title: "Crypto Monitor (CRYPTO)",
    body: ["Top coin prices, market sentiment, futures funding and open interest, liquidations and on-chain information."],
    open: { code: "CRYPTO", label: "Open Crypto Monitor" },
  },
  {
    title: "World Map (MAP)",
    body: ["A map of market-relevant events and infrastructure: earthquakes, fires, ports, shipping chokepoints, weather alerts, conflict events and more. Turn a layer on to see what it shows, where it comes from and why it can matter."],
    open: { code: "MAP", label: "Open World Map" },
  },
  {
    title: "Track Record (TRACK)",
    body: ["Your trading journal: log trades manually or import them, add setups, and see performance statistics. Your entries are stored in this browser, so export a backup if you want to keep them elsewhere."],
    open: { code: "TRACK", label: "Open Track Record" },
  },
  {
    title: "Portfolio (PORTFOLIO)",
    body: ["Track open positions with live profit and loss, sector allocation, performance versus the S&P 500 and risk statistics. Positions you enter are stored in this browser."],
    open: { code: "PORTFOLIO", label: "Open Portfolio" },
  },
  {
    title: "Analytics (QUANT)",
    body: ["Quantitative tools: correlation matrix, pairs-trading z-scores, beta and hedge ratio, sector rotation and COT positioning."],
    open: { code: "QUANT", label: "Open Analytics" },
  },
  {
    title: "Commitments of Traders (COT)",
    body: [
      "Official CFTC positioning: how hedge funds, banks and other trader groups are positioned in FX, indices, Bitcoin, gold, silver and oil futures, with a percentile showing how stretched each reading is versus the last 3 and 5 years.",
      "It is weekly, not live: positions are as of Tuesday and published the following Friday, and the page always shows both dates. An extreme reading describes crowding, not a signal.",
    ],
    open: { code: "COT", label: "Open COT" },
  },
  {
    title: "Market Context (LEAN)",
    body: [
      "A transparent backdrop per instrument (gold, the dollar index, the main FX pairs, S&P 500, Nasdaq 100, oil, Bitcoin): Supportive, Headwind or Neutral. Today it is built from the dollar and rates drivers only; trend, COT positioning, risk regime and cross-asset readings are shown with their raw inputs and carry weight 0 because the walk-forward test found no demonstrated edge.",
      "It is context, not a forecast or a trade signal. The page shows what would change the backdrop and how often it agreed with past moves, which is close to chance and not statistically significant.",
    ],
    open: { code: "LEAN", label: "Open Market Context" },
  },
  {
    title: "Locked features",
    body: [
      "Some features (for example the AI Copilot, Tweets and Vessels on the map) are members-only. A locked panel shows a \"Members only\" card instead of data. It is not an error.",
      "To request access, press the button on the locked panel. It opens an email to the account owner.",
    ],
  },
  {
    title: "That's it",
    body: [
      "Remember: type a function code, press Enter. HELP lists everything.",
      "Nothing in this terminal is investment advice. You can replay this tour any time from HELP.",
    ],
  },
];

/** Mounted once inside the signed-in app. Auto-opens the first time an account signs in on this browser. */
export function Tutorial() {
  const userId = useAuth((s) => s.session?.user.id);
  const { open, step, start, close, setStep } = useTutorial();
  const openTab = useWorkspace((s) => s.openTab);

  useEffect(() => {
    if (userId && !hasSeenTutorial(userId)) {
      const t = setTimeout(start, 800);
      return () => clearTimeout(t);
    }
  }, [userId, start]);

  const finish = () => {
    if (userId) markTutorialSeen(userId);
    close();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, userId]);

  if (!open) return null;
  const s = STEPS[step];
  const last = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-label="Terminal tour"
      className="fixed bottom-12 right-4 z-[3000] w-[380px] max-w-[calc(100vw-2rem)] bg-term-panel border border-term-amber shadow-panel text-[12px]"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-term-border bg-term-panel2">
        <span className="text-[10px] tracking-[0.2em] text-term-amber font-semibold">
          TOUR · {step + 1} / {STEPS.length}
        </span>
        <button
          onClick={finish}
          className="flex items-center gap-1 px-2 py-0.5 border border-term-amber text-term-amberBright text-[10px] uppercase tracking-wider hover:bg-term-amber hover:text-term-bg transition-colors"
        >
          <X size={11} /> Skip tour
        </button>
      </div>

      <div className="p-3 flex flex-col gap-2">
        <div className="text-term-heading text-[14px] font-bold">{s.title}</div>
        {s.body.map((p, i) => (
          <p key={i} className="text-term-text leading-relaxed">{p}</p>
        ))}
        {s.open && (
          <button
            onClick={() => openTab(s.open!.code, s.open!.symbol)}
            className="self-start mt-1 px-2 py-1 border border-term-border text-term-muted text-[11px] hover:border-term-amberDim hover:text-term-amberBright transition-colors"
          >
            {s.open.label} →
          </button>
        )}
      </div>

      <div className="flex items-center justify-between px-3 py-2 border-t border-term-border">
        <div className="flex gap-1">
          {STEPS.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to step ${i + 1}`}
              onClick={() => setStep(i)}
              className={`w-1.5 h-1.5 ${i === step ? "bg-term-amber" : "bg-term-border hover:bg-term-muted"}`}
            />
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
            className="px-2 py-1 border border-term-border text-term-muted text-[11px] uppercase tracking-wider disabled:opacity-40 hover:text-term-text"
          >
            Back
          </button>
          <button
            onClick={() => (last ? finish() : setStep(step + 1))}
            className="px-3 py-1 border border-term-amber bg-term-amberSubtle text-term-amberBright text-[11px] uppercase tracking-wider hover:bg-term-amber hover:text-term-bg transition-colors"
          >
            {last ? "Done" : "Next"}
          </button>
        </div>
      </div>
      <div className="px-3 pb-2 text-[10px] text-term-muted">Press Esc to close · replay anytime from HELP</div>
    </div>
  );
}
