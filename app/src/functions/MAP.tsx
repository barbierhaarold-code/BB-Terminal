import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
        </div>
      </div>
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

function LayerStatus({
  enabled, loading, error, count, unit,
}: { enabled: boolean; loading: boolean; error: Error | null; count: number | undefined; unit: string }) {
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
