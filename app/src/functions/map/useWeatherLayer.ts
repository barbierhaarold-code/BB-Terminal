import L from "leaflet";
import { SEVERITY_COLOR, type WeatherAlert } from "./weather";
import { escapeHtml } from "./proxyFetch";
import { useDataLayerGroup } from "./useDataLayerGroup";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
}

function popupHtml(a: WeatherAlert): string {
  const color = SEVERITY_COLOR[a.severity];
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:180px;max-width:280px">
      <div style="color:${color};font-weight:600;font-size:13px">${escapeHtml(a.event)}</div>
      <div style="color:${color}">${a.severity}</div>
      <div style="color:#f0f0f0;margin-top:2px">${escapeHtml(a.area)}</div>
      <div style="color:#6e6e6e">${fmt(a.onset)} → ${fmt(a.expires)}</div>
      <div style="color:#6e6e6e;margin-top:4px">Source: ${escapeHtml(a.source)}</div>
    </div>
  `;
}

/** Severity-colored outline + centre dot per active alert; the outline is simplified, so treat it as indicative, not survey-accurate. */
export function useWeatherLayer(map: L.Map | null, alerts: WeatherAlert[] | undefined, visible: boolean) {
  useDataLayerGroup(map, alerts, visible, (data, group) => {
    // Draw minor first so severe outlines sit on top.
    const order = { Unknown: 0, Minor: 1, Moderate: 2, Severe: 3, Extreme: 4 } as const;
    for (const a of [...data].sort((x, y) => order[x.severity] - order[y.severity])) {
      const color = SEVERITY_COLOR[a.severity];
      const html = popupHtml(a);
      for (const ring of a.rings) {
        L.polygon(ring, { color, weight: 1, opacity: 0.7, fillColor: color, fillOpacity: 0.1 }).bindPopup(html).addTo(group);
      }
      L.circleMarker([a.lat, a.lon], { radius: 4, color, weight: 1, fillColor: color, fillOpacity: 0.8 }).bindPopup(html).addTo(group);
    }
  });
}
