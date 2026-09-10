import { useEffect, useMemo, useRef, useState } from "react";
import { useJournal } from "@/store/journalStore";
import { useTradeDraft } from "@/store/tradeDraftStore";
import { naiveResult, MACRO_BIAS_OPTIONS, CONVICTION_OPTIONS, type Direction } from "@/lib/journal";
import { cn } from "@/lib/cn";

const inputCls = "bg-term-panel border border-term-border px-2 py-1 text-term-text placeholder:text-term-muted focus:outline-none focus:border-term-amber";
const labelCls = "sub-header block mb-1";

function nowLocalDatetime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TradeForm() {
  const { addTrade, setups, addSetup } = useJournal();

  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<Direction>("buy");
  const [size, setSize] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [exitPrice, setExitPrice] = useState("");
  const [result, setResult] = useState("");
  const [resultTouched, setResultTouched] = useState(false);
  const [entryAt, setEntryAt] = useState(nowLocalDatetime());
  const [exitAt, setExitAt] = useState("");
  const [setupId, setSetupId] = useState("");
  const [newSetupOpen, setNewSetupOpen] = useState(false);
  const [newSetupName, setNewSetupName] = useState("");
  const [macroBias, setMacroBias] = useState("");
  const [conviction, setConviction] = useState("");
  const [newsEvent, setNewsEvent] = useState("");
  const [feeling, setFeeling] = useState("");
  const [notes, setNotes] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [prefillFlash, setPrefillFlash] = useState(false);

  // Consume a Copilot-supplied draft (prefill_track_record_entry). This only
  // seeds the same local state a human typing would set — nothing is saved
  // until the user clicks Log Trade. Keyed on `nonce` so re-prefilling works,
  // and cleared immediately after so it can't linger or re-apply.
  const { draft: pendingDraft, nonce: draftNonce, clear: clearDraft } = useTradeDraft();
  const appliedNonce = useRef(0);
  useEffect(() => {
    if (draftNonce === appliedNonce.current || !pendingDraft) return;
    appliedNonce.current = draftNonce;
    const d = pendingDraft;
    if (d.symbol != null) setSymbol(d.symbol);
    if (d.direction === "buy" || d.direction === "sell") setDirection(d.direction);
    if (d.size != null) setSize(d.size);
    if (d.entryPrice != null) setEntryPrice(d.entryPrice);
    if (d.exitPrice != null) setExitPrice(d.exitPrice);
    if (d.entryAt) setEntryAt(d.entryAt);
    if (d.exitAt != null) setExitAt(d.exitAt);
    if (d.macroBias && MACRO_BIAS_OPTIONS.includes(d.macroBias)) setMacroBias(d.macroBias);
    if (d.conviction && CONVICTION_OPTIONS.includes(d.conviction)) setConviction(d.conviction);
    if (d.newsEvent != null) setNewsEvent(d.newsEvent);
    if (d.feeling != null) setFeeling(d.feeling);
    if (d.notes != null) setNotes(d.notes);
    setResultTouched(false); // let the auto result recompute from the new prices
    if (d.setupName && d.setupName.trim()) {
      const s = addSetup(d.setupName.trim());
      setSetupId(s.id);
    }
    clearDraft();
    setPrefillFlash(true);
    setTimeout(() => setPrefillFlash(false), 4000);
  }, [draftNonce, pendingDraft, addSetup, clearDraft]);

  const autoResult = useMemo(() => {
    if (!entryPrice.trim() || !exitPrice.trim() || !size.trim()) return undefined;
    const e = Number(entryPrice), x = Number(exitPrice), s = Number(size);
    if (!Number.isFinite(e) || !Number.isFinite(x) || !Number.isFinite(s)) return undefined;
    return naiveResult(direction, e, x, s);
  }, [direction, entryPrice, exitPrice, size]);

  // Auto-fill the result field as entry/exit/size change, unless the user
  // has typed into it directly — matches "auto-calculable but editable".
  const displayedResult = resultTouched ? result : (autoResult != null ? autoResult.toFixed(2) : "");

  function reset() {
    setSymbol(""); setSize(""); setEntryPrice(""); setExitPrice(""); setResult("");
    setResultTouched(false); setEntryAt(nowLocalDatetime()); setExitAt(""); setSetupId("");
    setMacroBias(""); setConviction(""); setNewsEvent(""); setFeeling(""); setNotes("");
  }

  function submit() {
    const sym = symbol.trim().toUpperCase();
    const sz = Number(size), ep = Number(entryPrice), xp = Number(exitPrice);
    const res = Number(displayedResult);
    if (!sym || !Number.isFinite(sz) || !Number.isFinite(ep) || !Number.isFinite(xp) || !Number.isFinite(res) || !entryAt) return;
    addTrade({
      symbol: sym, direction, size: sz, entryPrice: ep, exitPrice: xp, result: res,
      entryAt: new Date(entryAt).toISOString(),
      exitAt: exitAt ? new Date(exitAt).toISOString() : undefined,
      setupId: setupId || undefined,
      macroBias: macroBias || undefined,
      conviction: conviction || undefined,
      newsEvent: newsEvent.trim() || undefined,
      feeling: feeling.trim() || undefined,
      notes: notes.trim() || undefined,
      source: "manual",
    });
    reset();
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }

  function createSetupInline() {
    const name = newSetupName.trim();
    if (!name) return;
    const s = addSetup(name);
    setSetupId(s.id);
    setNewSetupName("");
    setNewSetupOpen(false);
  }

  const canSubmit = symbol.trim() && size && entryPrice && exitPrice && displayedResult !== "" && entryAt;

  return (
    <div className="panel">
      <div className="panel-header">
        <span>LOG A TRADE</span>
        <span className="sub-header normal-case tracking-normal font-normal">manual entry · reflect as you log</span>
      </div>
      <div className="p-3 flex flex-col gap-3">
        {/* Core fields */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div>
            <label className={labelCls}>SYMBOL</label>
            <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="XAUUSD" spellCheck={false}
              className={cn(inputCls, "w-full uppercase")} />
          </div>
          <div>
            <label className={labelCls}>DIRECTION</label>
            <div className="flex gap-1">
              {(["buy", "sell"] as const).map((d) => (
                <button key={d} onClick={() => setDirection(d)}
                  className={cn("flex-1 px-2 py-1 border uppercase tracking-wider text-[11px]",
                    d === direction ? (d === "buy" ? "border-term-green text-term-green" : "border-term-red text-term-red") : "border-term-border text-term-muted hover:text-term-text")}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={labelCls}>SIZE (LOTS)</label>
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="0.3" inputMode="decimal"
              className={cn(inputCls, "w-full num")} />
          </div>
          <div>
            <label className={labelCls}>DATE / TIME (ENTRY)</label>
            <input type="datetime-local" value={entryAt} onChange={(e) => setEntryAt(e.target.value)}
              className={cn(inputCls, "w-full num")} />
          </div>
          <div>
            <label className={labelCls}>DATE / TIME (EXIT) — optional</label>
            <input type="datetime-local" value={exitAt} onChange={(e) => setExitAt(e.target.value)}
              className={cn(inputCls, "w-full num")} />
          </div>
          <div>
            <label className={labelCls}>ENTRY PRICE</label>
            <input value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} placeholder="4390.64" inputMode="decimal"
              className={cn(inputCls, "w-full num")} />
          </div>
          <div>
            <label className={labelCls}>EXIT PRICE</label>
            <input value={exitPrice} onChange={(e) => setExitPrice(e.target.value)} placeholder="4388.52" inputMode="decimal"
              className={cn(inputCls, "w-full num")} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>RESULT (USD) — auto, editable</label>
            <input
              value={displayedResult}
              onChange={(e) => { setResultTouched(true); setResult(e.target.value); }}
              placeholder="-54.93" inputMode="decimal"
              className={cn(inputCls, "w-full num",
                Number(displayedResult) > 0 && "text-term-green", Number(displayedResult) < 0 && "text-term-red")} />
          </div>
        </div>

        {/* Journal context — available every time, not hidden */}
        <div className="border-t border-term-borderSoft pt-3">
          <div className="sub-header mb-2">JOURNAL CONTEXT</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>BIAIS MACRO DU JOUR</label>
              <select value={macroBias} onChange={(e) => setMacroBias(e.target.value)} className={cn(inputCls, "w-full")}>
                <option value="">—</option>
                {MACRO_BIAS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>CONVICTION</label>
              <select value={conviction} onChange={(e) => setConviction(e.target.value)} className={cn(inputCls, "w-full")}>
                <option value="">—</option>
                {CONVICTION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>SETUP</label>
              {newSetupOpen ? (
                <div className="flex gap-1">
                  <input value={newSetupName} onChange={(e) => setNewSetupName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && createSetupInline()}
                    placeholder="New setup name…" autoFocus
                    className={cn(inputCls, "flex-1 min-w-0")} />
                  <button onClick={createSetupInline} className="px-2 border border-term-amber text-term-amber text-[11px]">ADD</button>
                  <button onClick={() => setNewSetupOpen(false)} className="px-2 border border-term-border text-term-muted text-[11px]">×</button>
                </div>
              ) : (
                <select value={setupId} onChange={(e) => {
                  if (e.target.value === "__new__") { setNewSetupOpen(true); return; }
                  setSetupId(e.target.value);
                }} className={cn(inputCls, "w-full")}>
                  <option value="">—</option>
                  {setups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  <option value="__new__">+ New…</option>
                </select>
              )}
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={labelCls}>NEWS / ÉVÉNEMENT MACRO</label>
              <input value={newsEvent} onChange={(e) => setNewsEvent(e.target.value)}
                placeholder="CPI US 14h30, discours Powell…"
                className={cn(inputCls, "w-full")} />
            </div>
            <div className="col-span-2 md:col-span-1">
              <label className={labelCls}>RESSENTI</label>
              <input value={feeling} onChange={(e) => setFeeling(e.target.value)}
                placeholder="confiant, FOMO, revenge trade, patient…"
                className={cn(inputCls, "w-full")} />
            </div>
            <div className="col-span-2 md:col-span-3">
              <label className={labelCls}>NOTES</label>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="Exécution, gestion, ce que je referais différemment…"
                rows={2}
                className={cn(inputCls, "w-full resize-none")} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={submit} disabled={!canSubmit}
            className={cn("px-4 py-1.5 border text-[12px] uppercase tracking-wider font-bold",
              canSubmit ? "border-term-amber text-term-amber hover:bg-term-amberSubtle" : "border-term-border text-term-muted cursor-not-allowed")}>
            Log Trade
          </button>
          {savedFlash && <span className="text-term-green text-[11px] uppercase tracking-wider">✓ saved</span>}
          {prefillFlash && !savedFlash && (
            <span className="text-term-amber text-[11px] uppercase tracking-wider">Pre-filled by copilot · review &amp; save</span>
          )}
        </div>
      </div>
    </div>
  );
}
