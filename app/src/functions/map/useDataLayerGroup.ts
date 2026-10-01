import { useEffect, useRef } from "react";
import L from "leaflet";
import { safeRemove } from "./safeRemove";

/**
 * Owns a L.LayerGroup for a data-driven layer: creates it with the map,
 * rebuilds its contents via `build` whenever `data` changes, and adds/removes
 * it from the map as `visible` toggles. Same lifecycle as the per-layer hooks
 * (useFireLayer etc.), factored once for the newer layers.
 */
export function useDataLayerGroup<T>(
  map: L.Map | null,
  data: T | undefined,
  visible: boolean,
  build: (data: T, group: L.LayerGroup) => void,
) {
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
    if (data !== undefined) build(data, group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, map]);

  useEffect(() => {
    if (!map || !groupRef.current) return;
    if (visible) {
      try { groupRef.current.addTo(map); } catch { /* map already torn down */ }
    } else {
      safeRemove(groupRef.current);
    }
  }, [map, visible]);
}
