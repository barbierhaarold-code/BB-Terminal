import L from "leaflet";
import { cellToBoundary } from "h3-js";
import { JAM_COLOR, type GpsJamResult } from "./gpsjam";
import { useDataLayerGroup } from "./useDataLayerGroup";

/** Colors each H3 cell by the share of aircraft reporting degraded GPS. Draws nothing when the data is stale. */
export function useGpsJamLayer(map: L.Map | null, result: GpsJamResult | undefined, visible: boolean) {
  useDataLayerGroup(map, result, visible, (data, group) => {
    if (data.stale) return;
    for (const c of data.cells) {
      let ring: [number, number][];
      try { ring = cellToBoundary(c.h) as [number, number][]; } catch { continue; }
      // H3 cells straddling the antimeridian come back with a ±180 jump; Leaflet would draw a world-wide sliver.
      const lons = ring.map((p) => p[1]);
      if (Math.max(...lons) - Math.min(...lons) > 180) continue;
      const color = JAM_COLOR[c.level];
      L.polygon(ring, { color, weight: 0.5, opacity: 0.6, fillColor: color, fillOpacity: c.level === "high" ? 0.4 : 0.22 })
        .bindPopup(`
          <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:170px">
            <div style="color:${color};font-weight:600;font-size:13px">GPS interference · ${c.level}</div>
            <div style="color:#f0f0f0">${c.pct}% of ${c.n} aircraft reported degraded GPS</div>
            <div style="color:#6e6e6e">Data for ${data.date} (daily, ADS-B derived)</div>
            <div style="color:#6e6e6e;margin-top:4px">Source: GPSJam.org — indicative, not authoritative</div>
          </div>`)
        .addTo(group);
    }
  });
}
