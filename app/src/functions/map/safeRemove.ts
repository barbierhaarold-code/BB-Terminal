import type L from "leaflet";

// React 18 StrictMode double-invokes effects on mount (dev only): the map
// shell gets created, torn down, and recreated in the same tick, and a
// layer's own cleanup can end up firing after the map underneath it (and
// its SVG renderer) has already been torn down by that dance — Leaflet's
// internal remove path then throws on the half-destroyed state instead of
// no-op'ing. Removal is otherwise idempotent, so swallow it.
export function safeRemove(layer: L.Layer | null | undefined): void {
  if (!layer) return;
  try {
    layer.remove();
  } catch {
    // already torn down along with its map — nothing left to clean up
  }
}
