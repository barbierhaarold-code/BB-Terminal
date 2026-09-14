import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLeafletMap } from "./map/useLeafletMap";
import { useTerminatorLayer } from "./map/useTerminatorLayer";
import { useEarthquakeLayer } from "./map/useEarthquakeLayer";
import { fetchEarthquakes, QUAKE_WINDOW_LABEL, type QuakeWindow } from "./map/earthquakes";
import { cn } from "@/lib/cn";

const QUAKE_WINDOWS: QuakeWindow[] = ["day", "week", "month"];

export function MAP() {
  const containerRef = useRef<HTMLDivElement>(null);
  const map = useLeafletMap(containerRef);

  const [terminatorOn, setTerminatorOn] = useState(true);
  const [quakesOn, setQuakesOn] = useState(true);
  const [quakeWindow, setQuakeWindow] = useState<QuakeWindow>("day");

  useTerminatorLayer(map, terminatorOn);

  const quakesQuery = useQuery({
    queryKey: ["map-earthquakes", quakeWindow],
    queryFn: () => fetchEarthquakes(quakeWindow),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  useEarthquakeLayer(map, quakesQuery.data, quakesOn);

  return (
    <div className="h-full w-full relative">
      <div ref={containerRef} className="h-full w-full" />

      {/* Leaflet's own panes/controls run up to z-index 1000 (see leaflet.css),
          well above Tailwind's usual z-10/z-20 scale, so this needs an
          explicit value comfortably past that to stay on top. */}
      <div className="absolute top-3 left-3 z-[1100] w-[220px] bg-term-panel/95 border border-term-border shadow-panel backdrop-blur-sm text-[11px]">
        <div className="px-2.5 py-1.5 border-b border-term-border text-[10px] uppercase tracking-[0.18em] text-term-amber font-semibold">
          Layers
        </div>

        <div className="p-2.5 flex flex-col gap-2.5">
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

            <div className="mt-1.5 text-[10px]">
              {!quakesOn ? (
                <span className="text-term-muted">Layer hidden</span>
              ) : quakesQuery.isLoading ? (
                <span className="text-term-muted">Loading…</span>
              ) : quakesQuery.error ? (
                <span className="text-term-red">{(quakesQuery.error as Error).message}</span>
              ) : (quakesQuery.data?.length ?? 0) === 0 ? (
                <span className="text-term-muted">No earthquakes in this window.</span>
              ) : (
                <span className="text-term-muted">
                  <span className="text-term-heading num">{quakesQuery.data!.length}</span> events · {QUAKE_WINDOW_LABEL[quakeWindow]}
                </span>
              )}
            </div>
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
