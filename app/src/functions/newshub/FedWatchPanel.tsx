import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { loadFedWatch, type RateOdds } from "@/lib/fedwatch";
import { cn } from "@/lib/cn";

function OddsBar({ label, bps, probability, primary }: { label: string; bps: number; probability: number; primary?: boolean }) {
  const tone = bps > 0 ? "bg-term-red" : bps < 0 ? "bg-term-green" : "bg-term-amber";
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className={cn("w-20 shrink-0 tracking-wider", primary ? "text-term-heading font-bold" : "text-term-muted")}>{label}</span>
      <div className="flex-1 h-3 bg-term-panel2 border border-term-borderSoft relative overflow-hidden">
        <div className={cn("h-full", tone)} style={{ width: `${Math.max(1, probability * 100)}%` }} />
      </div>
      <span className="num w-12 text-right shrink-0">{(probability * 100).toFixed(0)}%</span>
    </div>
  );
}

function OddsBlock({ title, odds }: { title: string; odds: RateOdds }) {
  return (
    <div className="border border-term-border p-2.5 flex flex-col gap-1.5">
      <span className="sub-header">{title}</span>
      {odds.outcomes.map((o) => (
        <OddsBar key={o.label} label={o.label} bps={o.bps} probability={o.probability} primary={o.probability === Math.max(...odds.outcomes.map((x) => x.probability))} />
      ))}
      <div className="sub-header mt-1">IMPLIED RATE ≈ {odds.impliedRate.toFixed(2)}%</div>
    </div>
  );
}

export function FedWatchPanel() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ["newshub-fedwatch"],
    queryFn: () => loadFedWatch(),
    staleTime: 15 * 60_000,
    refetchInterval: 15 * 60_000,
  });

  if (isLoading) return <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>;
  if (error) return <div className="p-4 text-term-red">{(error as Error).message}</div>;
  if (!data) return <div className="p-4 text-term-muted">No FedWatch data.</div>;

  const meetingEnd = new Date(data.meeting.end + "T14:00:00");
  const msToMeeting = meetingEnd.getTime() - now.getTime();
  const daysToMeeting = Math.max(0, Math.ceil(msToMeeting / 864e5));

  return (
    <div className="h-full overflow-auto scroll-thin p-3 flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="border border-term-amber/50 bg-term-amberSubtle p-2.5 flex flex-col gap-1">
          <span className="sub-header">Next FOMC Meeting</span>
          <span className="text-term-heading font-bold">{data.meeting.start} – {data.meeting.end}</span>
          <span className="num text-term-amberBright text-[18px] font-bold">{daysToMeeting}d</span>
        </div>
        <div className="border border-term-border p-2.5 flex flex-col gap-1">
          <span className="sub-header">Current Target Range</span>
          <span className="num text-term-heading text-[18px] font-bold">{data.currentTarget.lower.toFixed(2)}–{data.currentTarget.upper.toFixed(2)}%</span>
          <span className="sub-header">Midpoint {data.currentTarget.midpoint.toFixed(3)}%</span>
        </div>
        <div className="border border-term-border p-2.5 flex flex-col gap-1">
          <span className="sub-header">Rate Effective</span>
          <span className="text-term-heading">{data.meeting.effective}</span>
          <span className="sub-header">Day after 2nd meeting day</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <OddsBlock title="Market-Implied Odds (Today)" odds={data.current} />
        {data.sinceLastMeeting && <OddsBlock title="Implied Odds Right After Last Meeting" odds={data.sinceLastMeeting} />}
        {!data.sinceLastMeeting && (
          <div className="border border-term-border p-2.5 flex items-center justify-center text-term-muted text-[11px] text-center">
            Couldn't reconstruct the "since last meeting" comparison — historical ZQ contract fetch for the prior meeting date didn't return a usable close.
          </div>
        )}
      </div>

      <div className="sub-header border-t border-term-borderSoft pt-2">
        DERIVED FROM FREE DATA: EFFR (FEDERAL RESERVE H.15) + 30-DAY FED FUNDS FUTURES CURVE (ZQ, YFINANCE). ODDS ARE A
        SIMPLIFIED LINEAR-INTERPOLATION MODEL BETWEEN THE NEAREST 25BP OUTCOMES — THE SAME RAW INPUT CME'S FEDWATCH
        TOOL USES, BUT NOT AN EXACT REPRODUCTION OF ITS FULL DISCRETE-OUTCOME DISTRIBUTION. 2026 FOMC DATES ARE
        HARDCODED FROM FEDERALRESERVE.GOV — UPDATE lib/fedwatch.ts EACH JANUARY.
      </div>
    </div>
  );
}
