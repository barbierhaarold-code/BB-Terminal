import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import L from "leaflet";
import { useLeafletMap } from "./map/useLeafletMap";
import { useTerminatorLayer } from "./map/useTerminatorLayer";
import { useEarthquakeLayer } from "./map/useEarthquakeLayer";
import { fetchEarthquakes, QUAKE_WINDOW_LABEL, type QuakeWindow } from "./map/earthquakes";
import { useFireLayer } from "./map/useFireLayer";
import { fetchFires } from "./map/fires";
import { useVolcanoLayer } from "./map/useVolcanoLayer";
import { fetchHistoricalVolcanoes, fetchLiveVolcanoAlerts, mergeVolcanoSources, type VolcanoMarker } from "./map/volcanoes";
import { usePortLayer } from "./map/usePortLayer";
import { fetchPorts, HARBOR_SIZE_LABEL, type HarborSize } from "./map/ports";
import { useChokepointLayer } from "./map/useChokepointLayer";
import { useMilitaryBaseLayer } from "./map/useMilitaryBaseLayer";
import { useNuclearFacilityLayer } from "./map/useNuclearFacilityLayer";
import { useGdeltLayer } from "./map/useGdeltLayer";
import { fetchGdelt, GDELT_CATEGORY_COLOR } from "./map/gdelt";
import { useWeatherLayer } from "./map/useWeatherLayer";
import { fetchWeatherAlerts, REGION_LABEL, SEVERITY_COLOR, type WeatherRegion } from "./map/weather";
import { useGpsJamLayer } from "./map/useGpsJamLayer";
import { fetchGpsJam, JAM_COLOR } from "./map/gpsjam";
import { useAisLayer } from "./map/useAisLayer";
import { AIS_POLL_MS, fetchVessels } from "./map/ais";
import { useCountryIntelLayer } from "./map/useCountryIntelLayer";
import { fetchCountryBoundaries } from "./map/countryIntel";
import { CountryIntelPanel } from "./map/CountryIntelPanel";
import { useFeatureLock } from "@/store/featureLockStore";
import { LockedFeature } from "@/components/LockedFeature";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const QUAKE_WINDOWS: QuakeWindow[] = ["day", "week", "month"];
const PORT_SIZES: HarborSize[] = ["L", "M"];

export function MAP() {
  const containerRef = useRef<HTMLDivElement>(null);
  const map = useLeafletMap(containerRef);

  const [terminatorOn, setTerminatorOn] = useState(true);
  const [quakesOn, setQuakesOn] = useState(true);
  const [quakeWindow, setQuakeWindow] = useState<QuakeWindow>("day");
  const [firesOn, setFiresOn] = useState(false);
  const [volcanoesOn, setVolcanoesOn] = useState(false);
  const [portsOn, setPortsOn] = useState(false);
  const [portSize, setPortSize] = useState<HarborSize>("L");
  const [chokepointsOn, setChokepointsOn] = useState(false);
  const [militaryOn, setMilitaryOn] = useState(false);
  const [nuclearOn, setNuclearOn] = useState(false);
  const [gdeltOn, setGdeltOn] = useState(false);
  const [weatherOn, setWeatherOn] = useState(false);
  const [countryOn, setCountryOn] = useState(false);
  const [aisOn, setAisOn] = useState(false);
  const [gpsJamOn, setGpsJamOn] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<{ iso3: string; name: string } | null>(null);
  // Viewport for the AIS query, rounded to whole degrees so small pans don't refetch.
  const [aisBounds, setAisBounds] = useState<L.LatLngBounds | null>(null);

  useTerminatorLayer(map, terminatorOn);

  const quakesQuery = useQuery({
    queryKey: ["map-earthquakes", quakeWindow],
    queryFn: () => fetchEarthquakes(quakeWindow),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  useEarthquakeLayer(map, quakesQuery.data, quakesOn);

  const firesQuery = useQuery({
    queryKey: ["map-fires"],
    queryFn: fetchFires,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled: firesOn,
  });
  useFireLayer(map, firesQuery.data, firesOn);

  const volcanoesHistoricalQuery = useQuery({
    queryKey: ["map-volcanoes-historical"],
    queryFn: fetchHistoricalVolcanoes,
    staleTime: 6 * 60 * 60_000,
    refetchInterval: 6 * 60 * 60_000,
    enabled: volcanoesOn,
  });
  const volcanoesLiveQuery = useQuery({
    queryKey: ["map-volcanoes-live"],
    queryFn: fetchLiveVolcanoAlerts,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled: volcanoesOn,
  });
  const volcanoMarkers: VolcanoMarker[] | undefined = volcanoesHistoricalQuery.data
    ? mergeVolcanoSources(volcanoesHistoricalQuery.data, volcanoesLiveQuery.data ?? [])
    : undefined;
  useVolcanoLayer(map, volcanoMarkers, volcanoesOn);

  const portsQuery = useQuery({
    queryKey: ["map-ports", portSize],
    queryFn: () => fetchPorts(portSize),
    staleTime: 24 * 60 * 60_000,
    refetchInterval: false,
    enabled: portsOn,
  });
  usePortLayer(map, portsQuery.data, portsOn);

  useChokepointLayer(map, chokepointsOn);
  useMilitaryBaseLayer(map, militaryOn);
  useNuclearFacilityLayer(map, nuclearOn);

  const gdeltQuery = useQuery({
    queryKey: ["map-gdelt"],
    queryFn: fetchGdelt,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled: gdeltOn,
  });
  useGdeltLayer(map, gdeltQuery.data?.events, gdeltOn);

  const weatherQuery = useQuery({
    queryKey: ["map-weather"],
    queryFn: fetchWeatherAlerts,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    enabled: weatherOn,
  });
  useWeatherLayer(map, weatherQuery.data?.alerts, weatherOn);

  const gpsJamQuery = useQuery({
    queryKey: ["map-gpsjam"],
    queryFn: fetchGpsJam,
    staleTime: 60 * 60_000,
    refetchInterval: 60 * 60_000,
    enabled: gpsJamOn,
  });
  useGpsJamLayer(map, gpsJamQuery.data, gpsJamOn);

  useEffect(() => {
    if (!map || !aisOn) return;
    const update = () => {
      const b = map.getBounds();
      setAisBounds(L.latLngBounds([Math.floor(b.getSouth()), Math.floor(b.getWest())], [Math.ceil(b.getNorth()), Math.ceil(b.getEast())]));
    };
    update();
    map.on("moveend", update);
    return () => { map.off("moveend", update); };
  }, [map, aisOn]);
  const aisKey = aisBounds ? aisBounds.toBBoxString() : "world";
  const aisQuery = useQuery({
    queryKey: ["map-ais", aisKey],
    queryFn: () => fetchVessels(aisBounds),
    refetchInterval: AIS_POLL_MS,
    staleTime: AIS_POLL_MS,
    // Keep drawing the previous viewport's vessels while a pan refetches, but only if that response was itself live.
    placeholderData: (prev) => prev,
    enabled: aisOn && !!aisBounds,
  });
  useAisLayer(map, aisQuery.data, aisOn);
  const aisLocked = useFeatureLock((s) => s.locked.ais);

  const boundariesQuery = useQuery({
    queryKey: ["map-country-boundaries"],
    queryFn: fetchCountryBoundaries,
    staleTime: Infinity,
    enabled: countryOn,
  });
  useCountryIntelLayer(map, boundariesQuery.data, countryOn, selectedCountry?.iso3 ?? null, (iso3, name) => setSelectedCountry({ iso3, name }));

  return (
    <div className="h-full w-full relative">
      <div ref={containerRef} className="h-full w-full" />

      {/* Leaflet's own panes/controls run up to z-index 1000 (see leaflet.css),
          well above Tailwind's usual z-10/z-20 scale, so this needs an
          explicit value comfortably past that to stay on top. */}
      <div className="absolute top-3 left-3 z-[1100] w-[240px] max-h-[calc(100%-24px)] overflow-y-auto bg-term-panel/95 border border-term-border shadow-panel backdrop-blur-sm text-[11px]">
        <div className="px-2.5 py-1.5 border-b border-term-border text-[10px] uppercase tracking-[0.18em] text-term-amber font-semibold sticky top-0 bg-term-panel/95">
          Layers
        </div>

        <div className="p-2.5 flex flex-col gap-3">
          <LayerToggle label="Day / Night Terminator" active={terminatorOn} onClick={() => setTerminatorOn((v) => !v)} />

          <div>
            <LayerToggle label="Earthquakes (USGS)" active={quakesOn} onClick={() => setQuakesOn((v) => !v)} />
            <div className="flex gap-1 mt-1.5">
              {QUAKE_WINDOWS.map((w) => (
                <button
                  key={w}
                  onClick={() => setQuakeWindow(w)}
                  disabled={!quakesOn}
                  className={cn(
                    "flex-1 px-1.5 py-0.5 border text-[10px] uppercase tracking-wider transition-colors",
                    !quakesOn && "opacity-40 cursor-not-allowed",
                    quakeWindow === w && quakesOn
                      ? "border-term-amber text-term-amber"
                      : "border-term-border text-term-muted hover:text-term-text"
                  )}
                >
                  {QUAKE_WINDOW_LABEL[w]}
                </button>
              ))}
            </div>
            <LayerStatus
              enabled={quakesOn}
              loading={quakesQuery.isLoading}
              error={quakesQuery.error as Error | null}
              count={quakesQuery.data?.length}
              unit={QUAKE_WINDOW_LABEL[quakeWindow]}
            />
          </div>

          <div>
            <LayerToggle label="Active Fires (NASA FIRMS)" active={firesOn} onClick={() => setFiresOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">VIIRS · Last 24H</div>
            <LayerStatus
              enabled={firesOn}
              loading={firesQuery.isLoading}
              error={firesQuery.error as Error | null}
              count={firesQuery.data?.length}
              unit="detections"
            />
          </div>

          <div>
            <LayerToggle label="Volcanoes" active={volcanoesOn} onClick={() => setVolcanoesOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">NOAA NCEI history · USGS live alerts (US only)</div>
            <LayerStatus
              enabled={volcanoesOn}
              loading={volcanoesHistoricalQuery.isLoading}
              error={
                volcanoesHistoricalQuery.error
                  ? (volcanoesHistoricalQuery.error as Error)
                  : volcanoesLiveQuery.error && !volcanoesHistoricalQuery.data
                  ? (volcanoesLiveQuery.error as Error)
                  : null
              }
              count={volcanoMarkers?.length}
              unit="known volcanoes"
            />
            {volcanoesOn && volcanoesHistoricalQuery.data && volcanoesLiveQuery.error ? (
              <div className="mt-1 text-[10px] text-term-red">Live USGS alert feed unavailable — showing historical data only.</div>
            ) : null}
          </div>

          <div>
            <LayerToggle label="Ports (NGA World Port Index)" active={portsOn} onClick={() => setPortsOn((v) => !v)} />
            <div className="flex gap-1 mt-1.5">
              {PORT_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setPortSize(s)}
                  disabled={!portsOn}
                  className={cn(
                    "flex-1 px-1.5 py-0.5 border text-[10px] uppercase tracking-wider transition-colors",
                    !portsOn && "opacity-40 cursor-not-allowed",
                    portSize === s && portsOn
                      ? "border-term-amber text-term-amber"
                      : "border-term-border text-term-muted hover:text-term-text"
                  )}
                >
                  {HARBOR_SIZE_LABEL[s]}
                </button>
              ))}
            </div>
            <LayerStatus
              enabled={portsOn}
              loading={portsQuery.isLoading}
              error={portsQuery.error as Error | null}
              count={portsQuery.data?.length}
              unit="ports"
            />
          </div>

          <div>
            <LayerToggle label="Maritime Chokepoints (EIA)" active={chokepointsOn} onClick={() => setChokepointsOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">7 strategic straits/canals · static</div>
          </div>

          <div>
            <LayerToggle label="Military Installations" active={militaryOn} onClick={() => setMilitaryOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">Publicly documented bases · static</div>
          </div>

          <div>
            <LayerToggle label="Nuclear Facilities (IAEA)" active={nuclearOn} onClick={() => setNuclearOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">Power reactors worldwide · static</div>
          </div>

          <div>
            <LayerToggle label="Conflict & Events (GDELT)" active={gdeltOn} onClick={() => setGdeltOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">Machine-coded news · trailing ~4H · 15-min updates</div>
            {gdeltOn && gdeltQuery.data ? (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-term-muted">
                {Object.entries(GDELT_CATEGORY_COLOR).filter(([k]) => k !== "Mass violence").map(([k, c]) => (
                  <span key={k} className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />{k}</span>
                ))}
              </div>
            ) : null}
            <LayerStatus
              enabled={gdeltOn}
              loading={gdeltQuery.isLoading}
              error={gdeltQuery.error as Error | null}
              count={gdeltQuery.data?.events.length}
              unit="locations"
            />
          </div>

          <div>
            <LayerToggle label="Weather Alerts" active={weatherOn} onClick={() => setWeatherOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">Coverage: US, Europe, Canada only — no alerts shown elsewhere does not mean none exist.</div>
            <LayerStatus
              enabled={weatherOn}
              loading={weatherQuery.isLoading}
              error={weatherQuery.error as Error | null}
              count={weatherQuery.data?.alerts.length}
              unit="active alerts"
            />
            {weatherOn && weatherQuery.data ? (
              <div className="mt-1 flex flex-col gap-0.5 text-[10px]">
                {(Object.keys(REGION_LABEL) as WeatherRegion[]).map((r) => {
                  const st = weatherQuery.data!.regions[r];
                  return (
                    <div key={r} className={st.status === "error" ? "text-term-red" : "text-term-muted"}>
                      {REGION_LABEL[r]}: {st.status === "error" ? `unavailable — ${st.error}` : `${st.count}`}{st.status === "ok" && st.error ? ` (${st.error})` : ""}
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-x-2 text-term-muted">
                  {(["Severe", "Moderate", "Minor"] as const).map((k) => (
                    <span key={k} className="flex items-center gap-1"><span className="w-1.5 h-1.5" style={{ background: SEVERITY_COLOR[k] }} />{k}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div>
            <LayerToggle label="Country Intel" active={countryOn} onClick={() => { setCountryOn((v) => !v); setSelectedCountry(null); }} />
            <div className="mt-1.5 text-[10px] text-term-muted">Click a country · World Bank, CPI, HDI, OFAC, State Dept</div>
            <LayerStatus
              enabled={countryOn}
              loading={boundariesQuery.isLoading}
              error={boundariesQuery.error as Error | null}
              count={boundariesQuery.data?.features.length}
              unit="countries"
            />
          </div>

          <div>
            <LayerToggle label="Vessels (AIS)" active={aisOn} onClick={() => setAisOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">Live community feed (AISStream.io) · no uptime guarantee</div>
            <AisStatus
              enabled={aisOn}
              locked={aisLocked}
              loading={aisQuery.isLoading || (aisOn && !aisBounds)}
              // While locked, the full teaser is shown over the map — keep the
              // sidebar from also printing a red "feature_locked" error line.
              fetchError={aisLocked ? null : (aisQuery.error as Error | null)}
              result={aisLocked ? undefined : aisQuery.data}
            />
          </div>

          <div>
            <LayerToggle label="GPS Jamming (GPSJam)" active={gpsJamOn} onClick={() => setGpsJamOn((v) => !v)} />
            <div className="mt-1.5 text-[10px] text-term-muted">Daily ADS-B-derived grid · hobby source, no continuity guarantee</div>
            {gpsJamOn && gpsJamQuery.data && !gpsJamQuery.data.stale ? (
              <div className="mt-1 flex gap-2 text-[10px] text-term-muted">
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5" style={{ background: JAM_COLOR.medium }} />2–10% bad</span>
                <span className="flex items-center gap-1"><span className="w-1.5 h-1.5" style={{ background: JAM_COLOR.high }} />&gt;10% bad</span>
              </div>
            ) : null}
            {gpsJamOn && gpsJamQuery.data?.stale ? (
              <div className="mt-1.5 text-[10px] text-term-red">
                Source is stale — latest data is from {gpsJamQuery.data.date} ({gpsJamQuery.data.ageDays} days old). Not displayed, to avoid showing old data as current.
              </div>
            ) : null}
            <LayerStatus
              enabled={gpsJamOn}
              loading={gpsJamQuery.isLoading}
              error={gpsJamQuery.error as Error | null}
              count={gpsJamQuery.data?.stale ? undefined : gpsJamQuery.data?.cells.length}
              unit={gpsJamQuery.data ? `affected cells · data for ${gpsJamQuery.data.date}` : "affected cells"}
              hideEmptyWhenStale={!!gpsJamQuery.data?.stale}
            />
            {gpsJamOn && gpsJamQuery.data?.suspect && !gpsJamQuery.data.stale ? (
              <div className="mt-1 text-[10px] text-term-muted">GPSJam flags this day's data as suspect (low aircraft coverage).</div>
            ) : null}
          </div>
        </div>
      </div>

      {countryOn && selectedCountry ? (
        <CountryIntelPanel iso3={selectedCountry.iso3} name={selectedCountry.name} onClose={() => setSelectedCountry(null)} />
      ) : null}

      {aisOn && aisLocked ? (
        <div className="absolute inset-0 z-[1200] flex items-center justify-center bg-term-bg/70 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-md max-h-full bg-term-panel border border-term-border shadow-panel">
            <button
              onClick={() => setAisOn(false)}
              title="Close"
              className="absolute top-2 right-2 z-10 p-1.5 text-term-muted hover:text-term-text"
            >
              <X size={15} />
            </button>
            <LockedFeature feature="ais" />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LayerToggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 w-full text-left group">
      <span
        className={cn(
          "w-3 h-3 border shrink-0 flex items-center justify-center",
          active ? "border-term-amber bg-term-amberSubtle" : "border-term-border"
        )}
      >
        {active && <span className="w-1.5 h-1.5 bg-term-amber" />}
      </span>
      <span className={cn("group-hover:text-term-text", active ? "text-term-heading" : "text-term-muted")}>
        {label}
      </span>
    </button>
  );
}

function AisStatus({
  enabled, locked, loading, fetchError, result,
}: { enabled: boolean; locked?: boolean; loading: boolean; fetchError: Error | null; result: import("./map/ais").AisResult | undefined }) {
  let body: React.ReactNode;
  if (!enabled) body = <span className="text-term-muted">Layer hidden</span>;
  else if (locked) body = <span className="text-term-amber">Members only — access managed by Harold</span>;
  else if (fetchError) body = <span className="text-term-red">Feed unavailable — {fetchError.message}</span>;
  else if (!result) body = <span className="text-term-muted">{loading ? "Loading…" : "No data available."}</span>;
  else if (result.status === "connected") {
    body = result.vessels.length === 0
      ? <span className="text-term-muted">Connected — no vessels in view yet.</span>
      : (
        <span className="text-term-muted">
          <span className="text-term-heading num">{result.vessels.length}</span> vessels in view
          {result.truncated ? " (capped — zoom in for more)" : ""} · <span className="text-term-green">live</span>
        </span>
      );
  } else if (result.status === "connecting") body = <span className="text-term-muted">Connecting to AIS feed…</span>;
  else body = <span className="text-term-red">Feed unavailable — {(result.error ?? "no AIS data is arriving").replace(/\.$/, "")}. No vessels shown.</span>;
  return (
    <div className="mt-1.5 text-[10px]">
      {body}
      {result && result.parseErrors > 0 && (
        <div className="text-term-muted/70 mt-0.5">{result.parseErrors} message{result.parseErrors === 1 ? "" : "s"} failed to parse (server log has detail)</div>
      )}
    </div>
  );
}

function LayerStatus({
  enabled, loading, error, count, unit, hideEmptyWhenStale,
}: { enabled: boolean; loading: boolean; error: Error | null; count: number | undefined; unit: string; hideEmptyWhenStale?: boolean }) {
  if (hideEmptyWhenStale && enabled && !loading && !error) return null;
  return (
    <div className="mt-1.5 text-[10px]">
      {!enabled ? (
        <span className="text-term-muted">Layer hidden</span>
      ) : loading ? (
        <span className="text-term-muted">Loading…</span>
      ) : error ? (
        <span className="text-term-red">{error.message}</span>
      ) : (count ?? 0) === 0 ? (
        <span className="text-term-muted">No data available.</span>
      ) : (
        <span className="text-term-muted">
          <span className="text-term-heading num">{count}</span> {unit}
        </span>
      )}
    </div>
  );
}
