import { useEffect, useRef } from "react";
import L from "leaflet";
import { NUCLEAR_FACILITIES, NUCLEAR_STATUS_COLOR, type NuclearFacility } from "./nuclearFacilities";
import { safeRemove } from "./safeRemove";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function popupHtml(f: NuclearFacility): string {
  const statusColor = NUCLEAR_STATUS_COLOR[f.status];
  const capacityLine = f.capacityMW > 0 ? `<div style="color:#d0d0d0">${f.reactors} reactor${f.reactors !== 1 ? "s" : ""} · ${f.capacityMW.toLocaleString()} MW</div>` : "";
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:180px;max-width:280px">
      <div style="color:#b45cff;font-weight:600;font-size:13px">${escapeHtml(f.name)}</div>
      <div style="color:#f0f0f0">${escapeHtml(f.country)}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:2px">
        <span style="width:7px;height:7px;border-radius:50%;background:${statusColor};display:inline-block"></span>
        <span style="color:${statusColor}">${escapeHtml(f.status)}</span>
      </div>
      ${capacityLine}
      <div style="color:#d0d0d0;margin-top:4px">${escapeHtml(f.description)}</div>
      <div style="color:#6e6e6e;margin-top:4px">Source: IAEA PRIS / World Nuclear Association</div>
    </div>
  `;
}

export function useNuclearFacilityLayer(map: L.Map | null, visible: boolean) {
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!map) return;
    const group = L.layerGroup();
    for (const f of NUCLEAR_FACILITIES) {
      const color = NUCLEAR_STATUS_COLOR[f.status];
      const icon = L.divIcon({
        className: "",
        html: `<div style="width:10px;height:10px;background:${color}33;border:1.5px solid ${color};border-radius:50%"></div>`,
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });
      const marker = L.marker([f.lat, f.lon], { icon });
      const html = popupHtml(f);
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
