import L from "leaflet";
import type { AisResult } from "./ais";
import { escapeHtml } from "./proxyFetch";
import { useDataLayerGroup } from "./useDataLayerGroup";

function popupHtml(v: AisResult["vessels"][number]): string {
  const seen = new Date(v.seen).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:160px;max-width:240px">
      <div style="color:#22ccee;font-weight:600;font-size:13px">${escapeHtml(v.name || "Unnamed vessel")}</div>
      <div style="color:#f0f0f0">MMSI ${v.mmsi}</div>
      <div style="color:#d0d0d0">${v.sog.toFixed(1)} kn · course ${Math.round(v.cog)}°</div>
      <div style="color:#6e6e6e">Position at ${seen}</div>
      <div style="color:#6e6e6e;margin-top:4px">Source: AISStream.io (live, no SLA)</div>
    </div>
  `;
}

/** One small dot per vessel, brighter when under way, dim when stationary. Only draws results from a live feed (the fetcher returns none otherwise). */
export function useAisLayer(map: L.Map | null, result: AisResult | undefined, visible: boolean) {
  useDataLayerGroup(map, result, visible, (data, group) => {
    if (data.status !== "connected") return;
    for (const v of data.vessels) {
      const moving = v.sog >= 0.5;
      L.circleMarker([v.lat, v.lon], {
        radius: moving ? 3 : 2.5,
        color: "#22ccee",
        weight: 1,
        fillColor: "#22ccee",
        fillOpacity: moving ? 0.85 : 0.3,
        opacity: moving ? 0.9 : 0.4,
      }).bindPopup(popupHtml(v)).addTo(group);
    }
  });
}
