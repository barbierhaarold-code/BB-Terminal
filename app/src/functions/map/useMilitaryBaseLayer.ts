import { useEffect, useRef } from "react";
import L from "leaflet";
import { MILITARY_BASES, type MilitaryBase } from "./militaryBases";
import { safeRemove } from "./safeRemove";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function popupHtml(b: MilitaryBase): string {
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:180px;max-width:280px">
      <div style="color:#b45cff;font-weight:600;font-size:13px">${escapeHtml(b.name)}</div>
      <div style="color:#f0f0f0">${escapeHtml(b.country)}</div>
      <div style="color:#eeb022">${escapeHtml(b.operator)} · ${escapeHtml(b.type)}</div>
      <div style="color:#d0d0d0;margin-top:4px">${escapeHtml(b.description)}</div>
      <div style="color:#6e6e6e;margin-top:4px">Publicly documented installation</div>
    </div>
  `;
}

export function useMilitaryBaseLayer(map: L.Map | null, visible: boolean) {
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    for (const b of MILITARY_BASES) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:9px;height:9px;background:rgba(239,68,68,0.3);border:1.5px solid #ef4444;border-radius:0"></div>`,
        iconSize: [9, 9],
        iconAnchor: [4.5, 4.5],
      });
      const marker = L.marker([b.lat, b.lon], { icon });
      const html = popupHtml(b);
      marker.bindPopup(html);
      marker.bindTooltip(html, { direction: "top", offset: [0, -5], opacity: 0.95 });
      marker.addTo(group);
    }
    groupRef.current = group;
    return () => {
      safeRemove(group);
      groupRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!map || !groupRef.current) return;
    if (visible) {
      try { groupRef.current.addTo(map); } catch { /* map already torn down */ }
    } else {
      safeRemove(groupRef.current);
    }
  }, [map, visible]);
}
