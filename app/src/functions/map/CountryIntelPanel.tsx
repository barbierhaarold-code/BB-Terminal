import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { fetchCountryProfile, TRAVEL_LEVEL_COLOR, type CountryProfile, type WbPoint } from "./countryIntel";

const fmtUsd = (n: number) =>
  n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`;
const fmtPop = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString());

export function CountryIntelPanel({ iso3, name, onClose }: { iso3: string; name: string; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["map-country-profile", iso3],
    queryFn: () => fetchCountryProfile(iso3),
    staleTime: 60 * 60_000,
    retry: 1,
  });

  return (
    <div className="absolute top-3 right-3 z-[1100] w-[300px] max-h-[calc(100%-24px)] overflow-y-auto bg-term-panel/95 border border-term-border shadow-panel backdrop-blur-sm text-[11px]">
      <div className="px-2.5 py-1.5 border-b border-term-border flex items-center justify-between sticky top-0 bg-term-panel/95">
        <span className="text-[10px] uppercase tracking-[0.18em] text-term-amber font-semibold truncate">{q.data?.name ?? name}</span>
        <button onClick={onClose} aria-label="Close country profile" className="text-term-muted hover:text-term-amber"><X size={12} /></button>
      </div>
      <div className="p-2.5 flex flex-col gap-3">
        {q.isLoading ? (
          <div className="text-term-muted">Loading profile…</div>
        ) : q.error ? (
          <div className="text-term-red">{(q.error as Error).message}</div>
        ) : q.data ? (
          <Profile p={q.data} />
        ) : (
          <div className="text-term-muted">No data available.</div>
        )}
      </div>
    </div>
  );
}

function Profile({ p }: { p: CountryProfile }) {
  return (
    <>
      <div className="text-term-muted">
        {[p.capital && `Capital: ${p.capital}`, p.region, p.incomeLevel].filter(Boolean).join(" · ")}
      </div>

      <Block title="Macro (World Bank)">
        {p.macro.status === "ok" ? (
          <>
            <Row label="GDP" v={p.macro.data.gdp} f={fmtUsd} />
            <Row label="GDP growth" v={p.macro.data.gdpGrowth} f={(n) => `${n.toFixed(1)}%`} />
            <Row label="GDP / capita" v={p.macro.data.gdpPerCapita} f={(n) => `$${Math.round(n).toLocaleString()}`} />
            <Row label="Inflation (CPI)" v={p.macro.data.inflation} f={(n) => `${n.toFixed(1)}%`} />
            <Row label="Unemployment" v={p.macro.data.unemployment} f={(n) => `${n.toFixed(1)}%`} />
            <Row label="Population" v={p.macro.data.population} f={fmtPop} />
            <Row label="Military spend" v={p.macro.data.militaryPctGdp} f={(n) => `${n.toFixed(1)}% GDP`} />
          </>
        ) : <SectionState s={p.macro} />}
      </Block>

      <Block title="Governance & development">
        {p.governance.status === "ok" ? (
          <>
            {p.governance.data.cpi ? (
              <Line label={`Corruption Perceptions Index ${p.governance.data.cpi.year}`} value={`${p.governance.data.cpi.score}/100 · rank ${p.governance.data.cpi.rank}`} />
            ) : <Line label="Corruption Perceptions Index" value="not scored" muted />}
            {p.governance.data.hdi ? (
              <Line label={`Human Development Index ${p.governance.data.hdi.year}`} value={`${p.governance.data.hdi.hdi.toFixed(3)}${p.governance.data.hdi.rank ? ` · rank ${p.governance.data.hdi.rank}` : ""}${p.governance.data.hdi.group ? ` · ${p.governance.data.hdi.group}` : ""}`} />
            ) : <Line label="Human Development Index" value="not scored" muted />}
            {p.governance.data.errors.map((e) => <div key={e} className="text-term-red">{e}</div>)}
          </>
        ) : <SectionState s={p.governance} />}
      </Block>

      <Block title="Sanctions exposure (OFAC SDN)">
        {p.sanctions.status === "ok" ? (
          p.sanctions.data.addresses === 0 ? (
            <div className="text-term-muted">No SDN-listed addresses in this country.</div>
          ) : (
            <>
              <Line label="SDN entries with a listed address here" value={p.sanctions.data.entities.toLocaleString()} />
              <div className="text-term-muted text-[10px]">Address-based count — not a statement about the country's own sanctions status.</div>
            </>
          )
        ) : <SectionState s={p.sanctions} />}
      </Block>

      <Block title="US State Dept travel advisory">
        {p.travel.status === "ok" ? (
          <>
            <div className="font-semibold" style={{ color: TRAVEL_LEVEL_COLOR[p.travel.data.level] }}>
              {p.travel.data.title.replace(/^.*? - /, "")}
            </div>
            <div className="text-term-muted leading-snug">{p.travel.data.summary}</div>
            <a href={p.travel.data.link} target="_blank" rel="noreferrer" className="text-term-amber hover:underline">Full advisory ↗</a>
          </>
        ) : <SectionState s={p.travel} />}
      </Block>
    </>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-term-muted border-b border-term-borderSoft pb-0.5 mb-1">{title}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function SectionState({ s }: { s: { status: "error"; error: string } | { status: "empty"; note: string } | { status: "ok" } }) {
  if (s.status === "error") return <div className="text-term-red">{s.error}</div>;
  if (s.status === "empty") return <div className="text-term-muted">{s.note || "No data available."}</div>;
  return null;
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-term-muted">{label}</span>
      <span className={muted ? "text-term-muted" : "text-term-heading num text-right"}>{value}</span>
    </div>
  );
}

function Row({ label, v, f }: { label: string; v: WbPoint | null; f: (n: number) => string }) {
  return <Line label={label} value={v ? `${f(v.value)} (${v.year})` : "—"} muted={!v} />;
}
