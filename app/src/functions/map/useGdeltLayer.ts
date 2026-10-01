import L from "leaflet";
import { GDELT_CATEGORY_COLOR, gdeltRadius, type GdeltEvent } from "./gdelt";
import { escapeHtml } from "./proxyFetch";
import { useDataLayerGroup } from "./useDataLayerGroup";

function popupHtml(e: GdeltEvent): string {
  const color = GDELT_CATEGORY_COLOR[e.category] ?? "#d0d0d0";
  const when = new Date(e.latest).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:170px;max-width:260px">
      <div style="color:${color};font-weight:600;font-size:13px">${escapeHtml(e.category)}</div>
      <div style="color:#f0f0f0">${escapeHtml(e.location)}</div>
      <div style="color:#d0d0d0">${e.events} event${e.events !== 1 ? "s" : ""} · ${e.mentions} mention${e.mentions !== 1 ? "s" : ""}</div>
      <div style="color:#6e6e6e">Latest ${when}</div>
      <div style="color:#6e6e6e;margin-top:4px">Source: GDELT (machine-coded news — may include misclassified events)</div>
    </div>
  `;
}

/** One circle per place+category, colored by CAMEO category and sized by media mentions. */
export function useGdeltLayer(map: L.Map | null, events: GdeltEvent[] | undefined, visible: boolean) {
  useDataLayerGroup(map, events, visible, (data, group) => {
    for (const e of data) {
      const color = GDELT_CATEGORY_COLOR[e.category] ?? "#d0d0d0";
      const marker = L.circleMarker([e.lat, e.lon], { radius: gdeltRadius(e), color, weight: 1, fillColor: color, fillOpacity: 0.45 });
      marker.bindPopup(popupHtml(e));
      marker.addTo(group);
    }
  });
}
