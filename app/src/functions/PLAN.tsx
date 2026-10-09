import { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import { useTradeDraft } from "@/store/tradeDraftStore";
import { useWorkspace } from "@/store/workspaceStore";
import { mask, type Direction, type Trade } from "@/lib/journal";
import {
  PLAN_STATUSES, FOLLOWED_VALUES, adherenceStats, computeRealizedR, entryReference, plannedRMultiples, R_NOTE,
  planProblems, plannedRiskDollars, statusCounts, type Followed, type PlanStatus, type TradePlan,
} from "@/lib/tradePlan";
import { buildContextSnapshot } from "@/lib/tradePlanContext";
import { DataNote, EmptyBlock, SectionTitle } from "./research/shared";

const inputCls = "bg-term-panel border border-term-border px-2 py-1 text-term-text placeholder:text-term-muted focus:outline-none focus:border-term-amber";
const labelCls = "sub-header block mb-1";
const btn = "px-3 py-1.5 border text-[11px] uppercase tracking-wider font-bold border-term-border text-term-muted hover:text-term-amber hover:border-term-amber disabled:opacity-40 disabled:hover:text-term-muted disabled:hover:border-term-border";
const btnPrimary = "px-3 py-1.5 border text-[11px] uppercase tracking-wider font-bold border-term-amber text-term-amber hover:bg-term-amberSubtle disabled:opacity-40";

const num = (s: string): number | undefined => {
  const t = s.trim().replace(/,/g, "");
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
};
const fmtN = (n: number | undefined | null, d = 2) => (n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: d }));
const fmtUsd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtR = (r: number) => `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)} R`;
const dt = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
const statusTone = (s: PlanStatus) =>
  s === "active" || s === "triggered" ? "text-term-amber border-term-amber/60"
  : s === "invalidated" || s === "cancelled" ? "text-term-red border-term-red/50"
  : "text-term-muted border-term-borderSoft";

export function PLAN() {
  const { plans, loadError, reload, discardUnreadable } = useTradePlans();
  const trades = useJournal((s) => s.trades);
  const [selId, setSelId] = useState<string | null>(null);
  const [editing, setEditing] = useState<"new" | string | null>(null);

  const sel = plans.find((p) => p.id === selId) ?? null;
  const sorted = useMemo(() => [...plans].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [plans]);
  const counts = statusCounts(plans);

  return (
    <div className="h-full overflow-auto scroll-thin flex flex-col gap-3 p-3 text-[12px] [&>*]:shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-term-amber text-[11px] tracking-[0.25em] font-bold">TRADE PLAN</span>
            <span className="text-term-muted text-[11px]">write the plan first · compare it with what happened · stored in this browser</span>
          </div>
          <div className="text-term-muted text-[11px] flex gap-3 flex-wrap" data-testid="plan-counts">
            {PLAN_STATUSES.map((s) => <span key={s}>{s} <b className="num text-term-text">{counts[s]}</b></span>)}
          </div>
        </div>
        <button onClick={() => { setEditing("new"); setSelId(null); }} disabled={!!loadError} className={btnPrimary} data-testid="plan-new">+ New plan</button>
      </div>

      {loadError && (
        <div className="p-3 text-term-red flex flex-col items-start gap-2 border border-term-red/40" role="alert" data-testid="plan-error">
          <div><span className="sub-header text-term-red mr-1">ERROR</span>{loadError}</div>
          <div className="flex gap-2">
            <button onClick={reload} className="px-2 py-1 border border-term-red/60 text-[11px] uppercase tracking-wider hover:bg-term-red/10 flex items-center gap-1.5">
              <RefreshCw size={11} /> Retry
            </button>
            <button onClick={discardUnreadable} className="px-2 py-1 border border-term-border text-term-muted text-[11px] uppercase tracking-wider hover:text-term-text">
              Start with an empty list
            </button>
          </div>
        </div>
      )}

      {editing && !loadError && (
        <PlanForm
          key={editing}
          plan={editing === "new" ? null : plans.find((p) => p.id === editing) ?? null}
          onDone={(id) => { setEditing(null); if (id) setSelId(id); }}
        />
      )}

      {!loadError && plans.length === 0 && !editing && (
        <EmptyBlock>No plans yet. Press “+ New plan” to document your first trade before you take it.</EmptyBlock>
      )}

      {plans.length > 0 && (
        <div className="border border-term-borderSoft overflow-x-auto scroll-thin">
          <table className="w-full min-w-[900px]" data-testid="plan-table">
            <thead>
              <tr className="text-left sub-header border-b border-term-borderSoft">
                <th className="px-2 py-1.5 font-normal">Created</th>
                <th className="px-2 py-1.5 font-normal">Title</th>
                <th className="px-2 py-1.5 font-normal">Symbol</th>
                <th className="px-2 py-1.5 font-normal">Dir</th>
                <th className="px-2 py-1.5 font-normal">Status</th>
                <th className="px-2 py-1.5 font-normal text-right">Entry ref.</th>
                <th className="px-2 py-1.5 font-normal text-right">Stop</th>
                <th className="px-2 py-1.5 font-normal text-right">Risk %</th>
                <th className="px-2 py-1.5 font-normal text-right">Linked trade</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} onClick={() => { setSelId(p.id); setEditing(null); }}
                  className={cn("cursor-pointer border-b border-term-borderSoft hover:bg-term-amberSubtle", p.id === selId && "bg-term-amberSubtle")}>
                  <td className="px-2 py-1.5 num text-term-muted">{dt(p.createdAt)}</td>
                  <td className="px-2 py-1.5 text-term-text max-w-[260px] truncate" title={p.title}>{p.title || <span className="text-term-muted">—</span>}</td>
                  <td className="px-2 py-1.5 text-term-heading font-bold">{p.symbol}</td>
                  <td className={cn("px-2 py-1.5 uppercase", p.direction === "buy" ? "text-term-green" : "text-term-red")}>{p.direction}</td>
                  <td className="px-2 py-1.5"><span className={cn("border px-1.5 py-0.5 text-[10px] uppercase tracking-wider", statusTone(p.status))}>{p.status}</span></td>
                  <td className="px-2 py-1.5 num text-right">{fmtN(entryReference(p))}</td>
                  <td className="px-2 py-1.5 num text-right">{fmtN(p.stop)}</td>
                  <td className="px-2 py-1.5 num text-right">{p.riskPct != null ? `${fmtN(p.riskPct)}%` : "—"}</td>
                  <td className="px-2 py-1.5 text-right text-term-muted">{p.review.tradeId ? (trades.some((t) => t.id === p.review.tradeId) ? "linked" : "missing trade") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {sel && !editing && <PlanDetail key={sel.id} plan={sel} onEdit={() => setEditing(sel.id)} onDeleted={() => setSelId(null)} />}

      <Adherence plans={plans} trades={trades} />

      <DataNote>
        <p className="mb-1.5">
          A plan is what you intended before the trade: the reasoning (macro read, then technical read), where you would enter, where you are wrong (the stop),
          where you would take profit, and how much of your base capital you were willing to risk. Afterwards you link it to the trade you actually took and say
          whether you followed it, so the journal can show how your plans compare with what happened.
        </p>
        <p className="mb-1.5">
          <b>Realized R</b> = the trade’s result divided by the money that would have been lost at the planned stop, measured from the trade’s actual entry price, at the trade’s size
          (risk per unit = |trade entry − plan stop|). The money per price point is read from the linked trade itself (result ÷ price move ÷ size), so it works for any instrument.
          The plan’s entry zone is used only for the plan’s own planned R of each target. R is shown as “n/a” with the reason whenever the plan or the trade lacks a valid number
          (for example a trade with an entry or exit price of 0); it is never guessed. {R_NOTE}
        </p>
        <p>
          <b>Context snapshots</b> are frozen copies of what Market Context and COT showed at that moment, with their own as-of dates (COT is weekly). They are facts,
          not a forecast. Adherence figures are descriptive and always show their sample size; with few plans they say little. Plans live in their own browser store and
          are included in the Track Record JSON export. Planned risk in dollars follows the privacy toggle; percentages and R stay visible.
        </p>
      </DataNote>
    </div>
  );
}

// ───────────── form ─────────────

function PlanForm({ plan, onDone }: { plan: TradePlan | null; onDone: (id?: string) => void }) {
  const { addPlan, updatePlan } = useTradePlans();
  const setups = useJournal((s) => s.setups);
  const [title, setTitle] = useState(plan?.title ?? "");
  const [symbol, setSymbol] = useState(plan?.symbol ?? "");
  const [direction, setDirection] = useState<Direction>(plan?.direction ?? "buy");
  const [thesisMacro, setThesisMacro] = useState(plan?.thesisMacro ?? "");
  const [thesisTechnical, setThesisTechnical] = useState(plan?.thesisTechnical ?? "");
  const [setupId, setSetupId] = useState(plan?.setupId ?? "");
  const [timeframe, setTimeframe] = useState(plan?.timeframe ?? "");
  const [entryLow, setEntryLow] = useState(plan?.entryLow != null ? String(plan.entryLow) : "");
  const [entryHigh, setEntryHigh] = useState(plan?.entryHigh != null ? String(plan.entryHigh) : "");
  const [stop, setStop] = useState(plan?.stop != null ? String(plan.stop) : "");
  const [targets, setTargets] = useState(plan?.targets.join(", ") ?? "");
  const [riskPct, setRiskPct] = useState(plan?.riskPct != null ? String(plan.riskPct) : "");
  const [catalysts, setCatalysts] = useState(plan?.catalysts ?? "");
  const [conviction, setConviction] = useState(plan?.conviction != null ? String(plan.conviction) : "");
  const [status, setStatus] = useState<PlanStatus>(plan?.status ?? "draft");
  const [snap, setSnap] = useState(false);
  const [busy, setBusy] = useState(false);

  const tgtNums = targets.split(/[,;\s]+/).filter(Boolean).map(Number);
  const badTargets = tgtNums.some((n) => !Number.isFinite(n));
  const draft = {
    title: title.trim() || undefined,
    symbol: symbol.trim().toUpperCase(), direction, thesisMacro: thesisMacro.trim(), thesisTechnical: thesisTechnical.trim(),
    setupId: setupId || undefined, timeframe: timeframe.trim(), entryLow: num(entryLow), entryHigh: num(entryHigh), stop: num(stop),
    targets: badTargets ? [] : tgtNums, riskPct: num(riskPct), catalysts: catalysts.trim(), conviction: num(conviction), status,
  };
  const probs = planProblems({ ...(plan ?? { id: "", createdAt: "", updatedAt: "", review: { lesson: "" } }), ...draft } as TradePlan);
  const invalidNum = (s: string) => s.trim() !== "" && num(s) == null;
  const bad = invalidNum(entryLow) || invalidNum(entryHigh) || invalidNum(stop) || invalidNum(riskPct) || invalidNum(conviction) || badTargets;
  const convOk = draft.conviction == null || (Number.isInteger(draft.conviction) && draft.conviction >= 1 && draft.conviction <= 5);
  const canSave = !!draft.symbol && !bad && convOk && !busy;

  async function save() {
    if (!canSave) return;
    if (plan) { updatePlan(plan.id, draft); onDone(plan.id); return; }
    const created = addPlan({ ...draft, review: { lesson: "" } });
    if (snap) {
      setBusy(true);
      const context = await buildContextSnapshot(created.symbol);
      useTradePlans.getState().updatePlan(created.id, { context });
      setBusy(false);
    }
    onDone(created.id);
  }

  return (
    <div className="panel" data-testid="plan-form">
      <div className="panel-header"><span>{plan ? "EDIT PLAN" : "NEW PLAN"}</span><span className="sub-header normal-case tracking-normal font-normal">fields are saved only when you press Save</span></div>
      <div className="p-3 flex flex-col gap-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="col-span-2 md:col-span-4">
            <label className={labelCls}>TITLE — optional</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="Short label, e.g. Gold pullback into CPI" className={cn(inputCls, "w-full")} data-testid="plan-title" />
          </div>
          <div>
            <label className={labelCls}>INSTRUMENT</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="XAUUSD" spellCheck={false} className={cn(inputCls, "w-full uppercase")} data-testid="plan-symbol" />
          </div>
          <div>
            <label className={labelCls}>DIRECTION</label>
            <div className="flex gap-1">
              {(["buy", "sell"] as const).map((d) => (
                <button key={d} onClick={() => setDirection(d)} className={cn("flex-1 px-2 py-1 border uppercase tracking-wider text-[11px]",
                  d === direction ? (d === "buy" ? "border-term-green text-term-green" : "border-term-red text-term-red") : "border-term-border text-term-muted hover:text-term-text")}>{d}</button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>SETUP</label>
            <select value={setupId} onChange={(e) => setSetupId(e.target.value)} className={cn(inputCls, "w-full")}>
              <option value="">—</option>
              {setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>TIMEFRAME / HORIZON</label>
            <input value={timeframe} onChange={(e) => setTimeframe(e.target.value)} placeholder="M15 entry, intraday" className={cn(inputCls, "w-full")} />
          </div>
          <div className="col-span-2 md:col-span-2">
            <label className={labelCls}>THESIS · MACRO READ</label>
            <textarea value={thesisMacro} onChange={(e) => setThesisMacro(e.target.value)} rows={3} placeholder="What the macro backdrop says and why it matters here…" className={cn(inputCls, "w-full resize-none")} />
          </div>
          <div className="col-span-2 md:col-span-2">
            <label className={labelCls}>THESIS · TECHNICAL READ</label>
            <textarea value={thesisTechnical} onChange={(e) => setThesisTechnical(e.target.value)} rows={3} placeholder="Structure, levels, the trigger you are waiting for…" className={cn(inputCls, "w-full resize-none")} />
          </div>
          <div>
            <label className={labelCls}>ENTRY ZONE · LOW</label>
            <input value={entryLow} onChange={(e) => setEntryLow(e.target.value)} inputMode="decimal" placeholder="4380" className={cn(inputCls, "w-full num", invalidNum(entryLow) && "border-term-red")} data-testid="plan-entry-low" />
          </div>
          <div>
            <label className={labelCls}>ENTRY ZONE · HIGH</label>
            <input value={entryHigh} onChange={(e) => setEntryHigh(e.target.value)} inputMode="decimal" placeholder="4390" className={cn(inputCls, "w-full num", invalidNum(entryHigh) && "border-term-red")} data-testid="plan-entry-high" />
          </div>
          <div>
            <label className={labelCls}>INVALIDATION (STOP)</label>
            <input value={stop} onChange={(e) => setStop(e.target.value)} inputMode="decimal" placeholder="4365" className={cn(inputCls, "w-full num", invalidNum(stop) && "border-term-red")} data-testid="plan-stop" />
          </div>
          <div>
            <label className={labelCls}>TARGETS (COMMA-SEPARATED)</label>
            <input value={targets} onChange={(e) => setTargets(e.target.value)} placeholder="4420, 4450" className={cn(inputCls, "w-full num", badTargets && "border-term-red")} data-testid="plan-targets" />
          </div>
          <div>
            <label className={labelCls}>PLANNED RISK (% OF BASE CAPITAL)</label>
            <input value={riskPct} onChange={(e) => setRiskPct(e.target.value)} inputMode="decimal" placeholder="0.5" className={cn(inputCls, "w-full num", invalidNum(riskPct) && "border-term-red")} data-testid="plan-risk" />
          </div>
          <div>
            <label className={labelCls}>CONVICTION (YOUR RATING, 1–5)</label>
            <select value={conviction} onChange={(e) => setConviction(e.target.value)} className={cn(inputCls, "w-full")}>
              <option value="">—</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>STATUS</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as PlanStatus)} className={cn(inputCls, "w-full")}>
              {PLAN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-span-2 md:col-span-4">
            <label className={labelCls}>CATALYSTS / EVENTS TO WATCH</label>
            <input value={catalysts} onChange={(e) => setCatalysts(e.target.value)} placeholder="US CPI 14:30, Fed speakers…" className={cn(inputCls, "w-full")} />
          </div>
        </div>
        {probs.map((p) => <div key={p} className="text-term-amber text-[11px]">⚠ {p}</div>)}
        {!plan && (
          <label className="flex items-center gap-2 text-[11px] text-term-muted">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
            Attach current context snapshot (freezes what Market Context and COT show now; facts, not a forecast)
          </label>
        )}
        <div className="flex items-center gap-2">
          <button onClick={() => void save()} disabled={!canSave} className={btnPrimary} data-testid="plan-save">{busy ? "Saving…" : "Save plan"}</button>
          <button onClick={() => onDone()} className={btn}>Cancel</button>
          {bad && <span className="text-term-red text-[11px]">One or more numbers are not valid.</span>}
          {!convOk && <span className="text-term-red text-[11px]">Conviction must be 1–5.</span>}
        </div>
      </div>
    </div>
  );
}

// ───────────── detail + review ─────────────

function PlanDetail({ plan, onEdit, onDeleted }: { plan: TradePlan; onEdit: () => void; onDeleted: () => void }) {
  const { updatePlan, deletePlan } = useTradePlans();
  const { trades, setups, baseCapital, pricesHidden } = useJournal();
  const openTab = useWorkspace((s) => s.openTab);
  const setDraft = useTradeDraft((s) => s.setDraft);
  const [filter, setFilter] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [snapState, setSnapState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const risk$ = plannedRiskDollars(plan.riskPct, baseCapital);
  const trade = plan.review.tradeId ? trades.find((t) => t.id === plan.review.tradeId) : undefined;
  const r = trade ? computeRealizedR(plan, trade) : null;
  const setupName = plan.setupId ? setups.find((s) => s.id === plan.setupId)?.name ?? "(setup no longer exists)" : "—";

  const candidates = useMemo(() => {
    const f = filter.trim().toUpperCase();
    return [...trades]
      .filter((t) => !f || t.symbol.toUpperCase().includes(f))
      .sort((a, b) => (a.entryAt < b.entryAt ? 1 : -1));
  }, [trades, filter]);

  function setReview(patch: Partial<TradePlan["review"]>) { updatePlan(plan.id, { review: { ...plan.review, ...patch } }); }

  async function attach() {
    setSnapState({ busy: true });
    try { updatePlan(plan.id, { context: await buildContextSnapshot(plan.symbol) }); setSnapState({ busy: false }); }
    catch (e) { setSnapState({ busy: false, error: (e as Error).message }); }
  }

  function createTradeFromPlan() {
    // Same pattern as the Copilot prefill: seeds the manual form only; nothing is written to the trade store.
    const setup = plan.setupId ? setups.find((s) => s.id === plan.setupId)?.name : undefined;
    setDraft({
      symbol: plan.symbol, direction: plan.direction, setupName: setup,
      newsEvent: plan.catalysts || undefined,
      notes: `From trade plan ${plan.id.slice(0, 8)}${plan.timeframe ? ` (${plan.timeframe})` : ""}. Stop ${plan.stop ?? "n/a"}, targets ${plan.targets.join(", ") || "n/a"}.`,
    });
    openTab("TRACK");
  }

  const ctx = plan.context;
  return (
    <div className="panel" data-testid="plan-detail">
      <div className="panel-header">
        <span>{plan.title ? `${plan.title} · ` : ""}{plan.symbol} · {plan.direction.toUpperCase()} · {plan.status.toUpperCase()}</span>
        <span className="sub-header normal-case tracking-normal font-normal">created {dt(plan.createdAt)} · updated {dt(plan.updatedAt)}</span>
      </div>
      <div className="p-3 flex flex-col gap-3">
        <div className="flex gap-2 flex-wrap">
          <button onClick={onEdit} className={btn}>Edit</button>
          <select value={plan.status} onChange={(e) => updatePlan(plan.id, { status: e.target.value as PlanStatus })} className={cn(inputCls, "text-[11px]")} aria-label="Status">
            {PLAN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={createTradeFromPlan} className={btn} data-testid="plan-create-trade">Create trade from plan</button>
          <span className="flex-1" />
          {confirmDel
            ? <><button onClick={() => { deletePlan(plan.id); onDeleted(); }} className={cn(btn, "border-term-red text-term-red")} data-testid="plan-delete-confirm">Confirm delete</button><button onClick={() => setConfirmDel(false)} className={btn}>Keep</button></>
            : <button onClick={() => setConfirmDel(true)} className={btn} data-testid="plan-delete">Delete plan</button>}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2">
          <Fact k="Setup" v={setupName} />
          <Fact k="Timeframe" v={plan.timeframe || "—"} />
          <Fact k="Entry zone" v={plan.entryLow != null || plan.entryHigh != null ? `${fmtN(plan.entryLow)} – ${fmtN(plan.entryHigh)}` : "—"} />
          <Fact k="Stop (invalidation)" v={fmtN(plan.stop)} />
          <Fact k="Targets" v={plan.targets.length ? plan.targets.map((t) => fmtN(t)).join(" · ") : "—"} />
          <Fact k="Planned R of targets (from zone midpoint)" v={plan.targets.length ? plannedRMultiples(plan).map((m) => (m == null ? "n/a" : `${m.toFixed(2)} R`)).join(" · ") : "—"} testId="plan-target-r" />
          <Fact k="Planned risk" v={plan.riskPct != null ? `${fmtN(plan.riskPct)}% of base capital` : "—"} />
          <Fact k="Planned risk (USD)" v={risk$ != null ? mask(fmtUsd(risk$), pricesHidden) : "—"} testId="plan-risk-usd" />
          <Fact k="Conviction (self-rated)" v={plan.conviction != null ? `${plan.conviction} / 5` : "—"} />
        </div>
        {(plan.thesisMacro || plan.thesisTechnical) && (
          <div className="grid md:grid-cols-2 gap-3">
            <Text k="Thesis · macro" v={plan.thesisMacro} />
            <Text k="Thesis · technical" v={plan.thesisTechnical} />
          </div>
        )}
        {plan.catalysts && <Text k="Catalysts / events to watch" v={plan.catalysts} />}

        {/* context snapshot */}
        <div className="border-t border-term-borderSoft pt-3" data-testid="plan-context">
          <SectionTitle>CONTEXT SNAPSHOT (FROZEN FACTS)</SectionTitle>
          {snapState.busy && <div className="text-term-muted uppercase tracking-widest text-[11px]" data-testid="plan-ctx-loading">Loading Market Context and COT…</div>}
          {snapState.error && (
            <div className="text-term-red flex items-center gap-2" role="alert">
              <span className="sub-header text-term-red">ERROR</span>{snapState.error}
              <button onClick={() => void attach()} className="underline">Retry</button>
            </div>
          )}
          {!ctx && !snapState.busy && !snapState.error && <div className="text-term-muted text-[11px] mb-2">No snapshot attached.</div>}
          {ctx && (
            <div className="text-[11px] flex flex-col gap-1.5 mb-2">
              <div className="text-term-muted">Taken {dt(ctx.takenAt)} for {ctx.symbol}. {ctx.note}</div>
              {ctx.market.available
                ? <div><b className="text-term-heading">Market Context</b> · {ctx.market.backdropName}: <b>{ctx.market.backdrop}</b> · composite {ctx.market.composite == null ? "n/a" : ctx.market.composite.toFixed(2)} · last daily bar {ctx.market.asOf ?? "n/a"}
                    <div className="text-term-muted">{ctx.market.drivers.map((d) => `${d.label}: ${d.direction}${d.weight === 0 ? " (weight 0)" : ""}`).join(" · ")}</div></div>
                : <div className="text-term-muted"><b className="text-term-heading">Market Context</b> · unavailable — {ctx.market.reason}</div>}
              {ctx.cot.available
                ? <div><b className="text-term-heading">COT</b> · {ctx.cot.contractName}, {ctx.cot.groupLabel}: net {ctx.cot.net.toLocaleString("en-US")}, weekly change {ctx.cot.changeNet == null ? "n/a" : ctx.cot.changeNet.toLocaleString("en-US")}, percentile 3Y {ctx.cot.pct3y == null ? "n/a" : Math.round(ctx.cot.pct3y)} / 5Y {ctx.cot.pct5y == null ? "n/a" : Math.round(ctx.cot.pct5y)} · positions as of {ctx.cot.positionsAsOf} (weekly, not live) · {ctx.cot.source}</div>
                : <div className="text-term-muted"><b className="text-term-heading">COT</b> · unavailable — {ctx.cot.reason}</div>}
            </div>
          )}
          <button onClick={() => void attach()} disabled={snapState.busy} className={btn} data-testid="plan-attach">{ctx ? "Replace with current snapshot" : "Attach current context snapshot"}</button>
        </div>

        {/* review */}
        <div className="border-t border-term-borderSoft pt-3" data-testid="plan-review">
          <SectionTitle>REVIEW (AFTER THE TRADE)</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              <label className={labelCls}>LINKED TRADE</label>
              <div className="flex gap-1">
                <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="filter symbol…" className={cn(inputCls, "w-28 uppercase")} spellCheck={false} />
                <select value={plan.review.tradeId ?? ""} onChange={(e) => setReview({ tradeId: e.target.value || undefined })} className={cn(inputCls, "flex-1 min-w-0")} data-testid="plan-trade-select">
                  <option value="">— none —</option>
                  {plan.review.tradeId && !trades.some((t) => t.id === plan.review.tradeId) && <option value={plan.review.tradeId}>(linked trade no longer exists)</option>}
                  {candidates.map((t) => <option key={t.id} value={t.id}>{tradeLabel(t, pricesHidden)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className={labelCls}>FOLLOWED THE PLAN?</label>
              <div className="flex gap-1">
                {FOLLOWED_VALUES.map((f) => (
                  <button key={f} onClick={() => setReview({ followed: plan.review.followed === f ? undefined : f })}
                    className={cn("flex-1 px-2 py-1 border uppercase tracking-wider text-[11px]", plan.review.followed === f ? "border-term-amber text-term-amber" : "border-term-border text-term-muted hover:text-term-text")}>{f}</button>
                ))}
              </div>
            </div>
            <div className="md:col-span-3">
              <label className={labelCls}>LESSON</label>
              <textarea value={plan.review.lesson} onChange={(e) => setReview({ lesson: e.target.value })} rows={2} placeholder="What happened versus the plan, what you would keep or change…" className={cn(inputCls, "w-full resize-none")} />
            </div>
          </div>
          {trade && r && (
            <div className="mt-2 text-[11px] flex flex-col gap-0.5" data-testid="plan-metrics">
              <div>Trade result: <b className="num">{mask(fmtUsd(trade.result), pricesHidden)}</b></div>
              {r.ok ? (
                <>
                  <div>Initial risk per unit: <b className="num">{fmtN(r.plannedRiskPerUnit, 4)}</b> (|trade entry {fmtN(trade.entryPrice, 4)} − plan stop {fmtN(plan.stop, 4)}|)</div>
                  <div>Initial risk in money at the trade’s size: <b className="num">{mask(fmtUsd(r.plannedRiskMoney), pricesHidden)}</b></div>
                  <div>Realized R: <b className="num text-term-heading" data-testid="plan-realized-r">{fmtR(r.r)}</b></div>
                </>
              ) : (
                <div>Realized R: <b data-testid="plan-realized-r">n/a ({r.reason})</b></div>
              )}
              <div className="text-term-muted" data-testid="plan-r-note">{R_NOTE}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function tradeLabel(t: Trade, hidden: boolean): string {
  const d = t.entryAt.slice(0, 16).replace("T", " ");
  return `${d} · ${t.symbol} ${t.direction} ${t.size} @ ${t.entryPrice} → ${t.exitPrice} · ${mask(`${t.result >= 0 ? "+" : ""}${t.result.toFixed(2)}`, hidden)}`;
}

function Fact({ k, v, testId }: { k: string; v: string; testId?: string }) {
  return <div><div className="sub-header">{k}</div><div className="num text-term-text" data-testid={testId}>{v}</div></div>;
}
function Text({ k, v }: { k: string; v: string }) {
  return <div><div className="sub-header">{k}</div><div className="text-term-text whitespace-pre-wrap leading-relaxed">{v || "—"}</div></div>;
}

// ───────────── adherence ─────────────

function Adherence({ plans, trades }: { plans: TradePlan[]; trades: Trade[] }) {
  const pricesHidden = useJournal((s) => s.pricesHidden);
  const a = useMemo(() => adherenceStats(plans, trades), [plans, trades]);
  return (
    <div className="panel" data-testid="plan-adherence">
      <div className="panel-header"><span>ADHERENCE · PLANS VS WHAT HAPPENED</span><span className="sub-header normal-case tracking-normal font-normal">n = {a.reviewed} reviewed</span></div>
      <div className="p-3 flex flex-col gap-2 text-[11px]">
        <div className={cn(a.smallSample ? "text-term-amber" : "text-term-muted")} data-testid="plan-sample-note">{a.note}</div>
        {a.reviewed === 0 ? (
          <EmptyBlock>Mark “followed the plan?” on a plan to see adherence here.</EmptyBlock>
        ) : (
          <table className="w-full min-w-[520px]">
            <thead>
              <tr className="text-left sub-header border-b border-term-borderSoft">
                <th className="py-1 font-normal">Followed</th><th className="py-1 font-normal text-right">Plans (n)</th><th className="py-1 font-normal text-right">Share</th>
                <th className="py-1 font-normal text-right">With linked trade (n)</th><th className="py-1 font-normal text-right">Net result</th><th className="py-1 font-normal text-right">Mean realized R</th>
              </tr>
            </thead>
            <tbody>
              {a.groups.map((g) => (
                <tr key={g.followed} className="border-b border-term-borderSoft">
                  <td className="py-1 uppercase">{g.followed}</td>
                  <td className="py-1 num text-right">{g.n}</td>
                  <td className="py-1 num text-right">{a.shares ? `${(a.shares[g.followed] * 100).toFixed(0)}%` : "—"}</td>
                  <td className="py-1 num text-right">{g.linked}</td>
                  <td className="py-1 num text-right">{g.linked ? mask(fmtUsd(g.net), pricesHidden) : "—"}</td>
                  <td className="py-1 num text-right">{g.avgR != null ? `${fmtR(g.avgR)} (n=${g.rCount})` : `n/a (n=${g.rCount})`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="text-term-muted">Descriptive only: no claim is made about cause or about what to do next.</div>
      </div>
    </div>
  );
}
