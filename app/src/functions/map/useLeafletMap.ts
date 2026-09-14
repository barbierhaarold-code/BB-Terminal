import { useEffect, useRef, useState, type RefObject } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./leaflet-theme.css";

// CARTO's dark_all tiles now require an account/API key (verified live —
// they return a 200 but the tile image itself is watermarked "API KEY
// REQUIRED"), so they no longer qualify as the free option they used to be.
// Esri's World Dark Gray Canvas is still genuinely free and keyless (no
// token, unlike Mapbox, which is explicitly not approved for this app).
const DARK_TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION = "Esri, HERE, Garmin, FAO, NOAA, USGS";

interface MapHandle {
  instance: L.Map;
  resizeObserver: ResizeObserver;
}

/** Creates and owns the Leaflet map instance for the given container, disposing it on unmount. */
export function useLeafletMap(containerRef: RefObject<HTMLDivElement>) {
  const [map, setMap] = useState<L.Map | null>(null);
  const handleRef = useRef<MapHandle | null>(null);
  const teardownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function scheduleTeardown(instance: L.Map, resizeObserver: ResizeObserver) {
      // Deferred by a tick rather than torn down inline: React 18 StrictMode
      // mounts, cleans up, and remounts this effect once synchronously in
      // dev to surface cleanup bugs. Tearing down inline made that dance
      // create a *second* Leaflet instance on the same container while the
      // first one's async internals (tile loads, pane updates) were still
      // in flight — those callbacks then fired against an instance that had
      // already been removed and threw. Deferring gives the (synchronous)
      // remount a chance to cancel this and reuse the live instance instead.
      teardownTimerRef.current = setTimeout(() => {
        resizeObserver.disconnect();
        try { instance.remove(); } catch { /* already removed */ }
        handleRef.current = null;
        teardownTimerRef.current = null;
        setMap(null);
      }, 0);
    }

    if (teardownTimerRef.current != null && handleRef.current) {
      clearTimeout(teardownTimerRef.current);
      teardownTimerRef.current = null;
      const { instance, resizeObserver } = handleRef.current;
      setMap(instance);
      return () => scheduleTeardown(instance, resizeObserver);
    }

    const instance = L.map(container, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 10,
      worldCopyJump: true,
      zoomControl: false,
      attributionControl: true,
    });
    L.control.zoom({ position: "bottomright" }).addTo(instance);
    L.tileLayer(DARK_TILE_URL, {
      attribution: TILE_ATTRIBUTION,
      maxZoom: 10,
    }).addTo(instance);

    const resizeObserver = new ResizeObserver(() => {
      try { instance.invalidateSize(); } catch { /* torn down mid-callback */ }
    });
    resizeObserver.observe(container);

    handleRef.current = { instance, resizeObserver };
    setMap(instance);

    return () => scheduleTeardown(instance, resizeObserver);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return map;
}
