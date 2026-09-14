import { useEffect, useRef } from "react";
import L from "leaflet";
import type { VolcanoMarker } from "./volcanoes";
import { volcanoAlertColor } from "./volcanoes";
import { safeRemove } from "./safeRemove";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function popupHtml(v: VolcanoMarker): string {
  if (v.kind === "live") {
    const time = new Date(v.updatedAt).toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
    });
    return `
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:200px;max-width:260px">
        <div style="color:${volcanoAlertColor(v.colorCode)};font-weight:600;font-size:13px">${escapeHtml(v.name)} — ${escapeHtml(v.alertLevel)}</div>
        <div style="color:#f0f0f0">${escapeHtml(v.observatory)} · ${escapeHtml(v.colorCode)}</div>
        <div style="color:#6e6e6e;margin-top:4px">${escapeHtml(v.synopsis)}</div>
        <div style="color:#6e6e6e;margin-top:4px">${time}</div>
        <div style="color:#6e6e6e">Source: USGS Volcano Notification Service (US-monitored volcanoes only)</div>
      </div>
    `;
  }
  const eruption = v.lastEruptionYear < 0 ? `${Math.abs(v.lastEruptionYear)} BCE` : String(v.lastEruptionYear);
  return `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.5;color:#d0d0d0;min-width:180px">
      <div style="color:#eeb022;font-weight:600;font-size:13px">${escapeHtml(v.name)}</div>
      <div style="color:#f0f0f0">${escapeHtml(v.country)}${v.morphology ? ` · ${escapeHtml(v.morphology)}` : ""}</div>
      <div style="color:#6e6e6e">Last significant eruption: ${eruption}${v.vei != null ? ` (VEI ${v.vei})` : ""}</div>
      ${v.elevationM != null ? `<div style="color:#6e6e6e">Elevation: ${v.elevationM.toLocaleString()} m</div>` : ""}
      ${v.deaths ? `<div style="color:#6e6e6e">Deaths recorded: ${v.deaths.toLocaleString()}</div>` : ""}
      <div style="color:#6e6e6e;margin-top:4px">Source: NOAA NCEI Significant Volcanic Eruptions</div>
    </div>
  `;
}

/** Renders one marker per volcano — a diamond for the NOAA historical base layer, a pulsing circle colored by USGS alert level for a live-monitored one. Rebuilds whenever `volcanoes` changes; toggled by `visible`. */
export function useVolcanoLayer(map: L.Map | null, volcanoes: VolcanoMarker[] | undefined, visible: boolean) {
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
    for (const v of volcanoes ?? []) {
      const isLive = v.kind === "live";
      const color = isLive ? volcanoAlertColor(v.colorCode) : "#eeb022";
      const marker = L.circleMarker([v.lat, v.lon], {
        radius: isLive ? 8 : 5,
        color,
        weight: isLive ? 2 : 1,
        fillColor: color,
        fillOpacity: isLive ? 0.5 : 0.35,
      });
      const html = popupHtml(v);
      marker.bindPopup(html);
      marker.bindTooltip(html, { direction: "top", offset: [0, -4], opacity: 0.95 });
      marker.addTo(group);
    }
  }, [volcanoes]);

  useEffect(() => {
    if (!map || !groupRef.current) return;
    if (visible) {
      try { groupRef.current.addTo(map); } catch { /* map already torn down */ }
    } else {
      safeRemove(groupRef.current);
    }
  }, [map, visible]);
}
