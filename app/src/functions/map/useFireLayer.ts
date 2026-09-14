import { useEffect, useRef } from "react";
import L from "leaflet";
import type { FireDetection } from "./fires";
import { frpColor, frpRadius } from "./fires";
import { safeRemove } from "./safeRemove";

function popupHtml(f: FireDetection): string {
  const time = new Date(f.acquiredAt).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  const frp = Number.isFinite(f.frp) ? `${f.frp.toFixed(1)} MW` : "—";
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:150px">
      <div style="color:${frpColor(f.frp)};font-weight:600;font-size:13px">Active fire</div>
      <div style="color:#f0f0f0">FRP: ${frp}</div>
      <div style="color:#6e6e6e">Confidence: ${f.confidence}</div>
      <div style="color:#6e6e6e">${f.satellite} · ${f.daynight === "D" ? "Day" : "Night"} pass</div>
      <div style="color:#6e6e6e">${time}</div>
    </div>
  `;
}

/** Renders one circle marker per VIIRS fire detection, sized/colored by FRP intensity. Rebuilds whenever `fires` changes; toggled by `visible`. */
export function useFireLayer(map: L.Map | null, fires: FireDetection[] | undefined, visible: boolean) {
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    groupRef.current = group;
    return () => {
      safeRemove(group);
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    for (const f of fires ?? []) {
      const marker = L.circleMarker([f.lat, f.lon], {
        radius: frpRadius(f.frp),
        color: frpColor(f.frp),
        weight: 1,
        fillColor: frpColor(f.frp),
        fillOpacity: 0.6,
      });
      const html = popupHtml(f);
      marker.bindPopup(html);
      marker.bindTooltip(html, { direction: "top", offset: [0, -4], opacity: 0.95 });
      marker.addTo(group);
    }
  }, [fires]);

  useEffect(() => {
    if (!map || !groupRef.current) return;
    if (visible) {
      try { groupRef.current.addTo(map); } catch { /* map already torn down */ }
    } else {
      safeRemove(groupRef.current);
    }
  }, [map, visible]);
}
