import { useEffect, useRef } from "react";
import L from "leaflet";
import { terminatorPolygon } from "./terminator";
import { safeRemove } from "./safeRemove";

// No need for per-second precision — the subsolar point moves ~0.25°/min,
// invisible at world-map zoom levels over a few minutes.
const REFRESH_MS = 5 * 60_000;

/** Draws the night-side terminator polygon on `map` and keeps it redrawn on an interval, toggled by `visible`. */
export function useTerminatorLayer(map: L.Map | null, visible: boolean) {
  const layerRef = useRef<L.Polygon | null>(null);

  useEffect(() => {
    if (!map) return;

    const draw = () => {
      const points = terminatorPolygon(new Date());
      if (!layerRef.current) {
        layerRef.current = L.polygon(points, {
          stroke: true,
          color: "#b45cff",
          weight: 1,
          opacity: 0.45,
          fillColor: "#000000",
          fillOpacity: 0.38,
          interactive: false,
        });
      } else {
        layerRef.current.setLatLngs(points);
      }
    };

    draw();
    const interval = setInterval(draw, REFRESH_MS);
    return () => {
      clearInterval(interval);
      safeRemove(layerRef.current);
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!map || !layerRef.current) return;
    if (visible) {
      try { layerRef.current.addTo(map); } catch { /* map already torn down */ }
    } else {
      safeRemove(layerRef.current);
    }
  }, [map, visible]);
}
