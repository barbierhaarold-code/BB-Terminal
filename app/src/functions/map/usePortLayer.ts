import { useEffect, useRef } from "react";
import L from "leaflet";
import type { Port } from "./ports";
import { safeRemove } from "./safeRemove";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function popupHtml(p: Port): string {
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:160px">
      <div style="color:#b45cff;font-weight:600;font-size:13px">${escapeHtml(p.name)}</div>
      <div style="color:#f0f0f0">${escapeHtml(p.country)}</div>
      <div style="color:#6e6e6e">${p.harborSize} harbor${p.firstPortOfEntry ? " · Port of entry" : ""}</div>
      <div style="color:#6e6e6e;margin-top:4px">Source: NGA World Port Index (Pub. 150)</div>
    </div>
  `;
}

/** Renders one square marker per port (a distinct shape from the circular quake/fire/volcano markers, so a dense coastline doesn't read as "more earthquakes"). Rebuilds whenever `ports` changes; toggled by `visible`. */
export function usePortLayer(map: L.Map | null, ports: Port[] | undefined, visible: boolean) {
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
    for (const p of ports ?? []) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:7px;height:7px;background:#b45cff;opacity:0.75;border:1px solid #0a0a0a;transform:rotate(45deg)"></div>`,
        iconSize: [7, 7],
        iconAnchor: [3.5, 3.5],
      });
      const marker = L.marker([p.lat, p.lon], { icon });
      const html = popupHtml(p);
      marker.bindPopup(html);
      marker.bindTooltip(html, { direction: "top", offset: [0, -4], opacity: 0.95 });
      marker.addTo(group);
    }
  }, [ports]);

  useEffect(() => {
    if (!map || !groupRef.current) return;
    if (visible) {
      try { groupRef.current.addTo(map); } catch { /* map already torn down */ }
    } else {
      safeRemove(groupRef.current);
    }
  }, [map, visible]);
}
