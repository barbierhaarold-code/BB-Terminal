import { useEffect, useRef } from "react";
import L from "leaflet";
import { CHOKEPOINTS, type Chokepoint } from "./chokepoints";
import { safeRemove } from "./safeRemove";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function popupHtml(c: Chokepoint): string {
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:220px;max-width:280px">
      <div style="color:#b45cff;font-weight:600;font-size:13px">${escapeHtml(c.name)}</div>
      <div style="color:#f0f0f0;margin-top:2px">${escapeHtml(c.description)}</div>
      <div style="color:#eeb022;margin-top:6px">Oil flow: ${escapeHtml(c.oilFlow)}</div>
      <div style="color:#eeb022">${escapeHtml(c.shareOfTrade)}</div>
      <div style="color:#6e6e6e;margin-top:4px">Source: ${escapeHtml(c.source)}</div>
    </div>
  `;
}

/** Renders one diamond marker per curated maritime chokepoint (static data, doesn't depend on any fetched query). Toggled by `visible`. */
export function useChokepointLayer(map: L.Map | null, visible: boolean) {
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    for (const c of CHOKEPOINTS) {
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:11px;height:11px;background:rgba(180,92,255,0.25);border:1.5px solid #b45cff;transform:rotate(45deg)"></div>`,
        iconSize: [11, 11],
        iconAnchor: [5.5, 5.5],
      });
      const marker = L.marker([c.lat, c.lon], { icon });
      const html = popupHtml(c);
      marker.bindPopup(html);
      marker.bindTooltip(html, { direction: "top", offset: [0, -6], opacity: 0.95 });
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
