import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Earthquake } from "./earthquakes";
import { magnitudeColor, magnitudeRadius } from "./magnitude";
import { safeRemove } from "./safeRemove";

function popupHtml(q: Earthquake): string {
  const time = new Date(q.time).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  });
  const mag = q.mag != null ? q.mag.toFixed(1) : "—";
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:160px">
      <div style="color:${magnitudeColor(q.mag)};font-weight:600;font-size:13px">M ${mag}</div>
      <div style="color:#f0f0f0">${escapeHtml(q.place)}</div>
      <div style="color:#6e6e6e">${time}</div>
      <div style="color:#6e6e6e">Depth: ${q.depthKm.toFixed(1)} km</div>
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Renders one circle marker per earthquake on `map`, sized/colored by magnitude, with click + hover popups. Rebuilds whenever `earthquakes` changes; toggled by `visible`. */
export function useEarthquakeLayer(map: L.Map | null, earthquakes: Earthquake[] | undefined, visible: boolean) {
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
    for (const q of earthquakes ?? []) {
      const marker = L.circleMarker([q.lat, q.lon], {
        radius: magnitudeRadius(q.mag),
        color: magnitudeColor(q.mag),
        weight: 1,
        fillColor: magnitudeColor(q.mag),
        fillOpacity: 0.55,
      });
      const html = popupHtml(q);
      marker.bindPopup(html);
      marker.bindTooltip(html, { direction: "top", offset: [0, -4], opacity: 0.95 });
      marker.addTo(group);
    }
  }, [earthquakes]);

  useEffect(() => {
    if (!map || !groupRef.current) return;
    if (visible) {
      try { groupRef.current.addTo(map); } catch { /* map already torn down */ }
    } else {
      safeRemove(groupRef.current);
    }
  }, [map, visible]);
}
