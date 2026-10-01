import { useEffect, useRef } from "react";
import L from "leaflet";
import { safeRemove } from "./safeRemove";

type Ring = number[][]; // [lon, lat]
interface IndexedCountry {
  iso3: string;
  name: string;
  /** Polygons as [outer, ...holes]. */
  polys: Ring[][];
  bbox: [number, number, number, number]; // minLon, minLat, maxLon, maxLat
}

function ringContains(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function indexCountries(fc: GeoJSON.FeatureCollection): IndexedCountry[] {
  const out: IndexedCountry[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    if (polys.length === 0) continue;
    let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
    for (const p of polys) for (const [lon, lat] of p[0]) {
      if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
    }
    out.push({ iso3: f.properties?.iso3, name: f.properties?.name, polys: polys as Ring[][], bbox: [minLon, minLat, maxLon, maxLat] });
  }
  return out;
}

function countryAt(countries: IndexedCountry[], lon: number, lat: number): IndexedCountry | null {
  for (const c of countries) {
    const [a, b, d, e] = c.bbox;
    if (lon < a || lon > d || lat < b || lat > e) continue;
    for (const poly of c.polys) {
      if (ringContains(poly[0], lon, lat) && !poly.slice(1).some((h) => ringContains(h, lon, lat))) return c;
    }
  }
  return null;
}

const BORDER_STYLE: L.PathOptions = { color: "#b45cff", weight: 0.6, opacity: 0.3, fill: false, interactive: false };
const SELECTED_STYLE: L.PathOptions = { color: "#b45cff", weight: 1.6, opacity: 1, fillColor: "#b45cff", fillOpacity: 0.15, interactive: false };

/**
 * Country selection by map click + point-in-polygon, with faint borders drawn
 * for discoverability. Deliberately NOT interactive polygons: with the app's
 * canvas renderer only the topmost canvas receives mouse events, so a
 * polygon layer sitting under the marker layers never gets a click. A map
 * click that merely opened another layer's popup is ignored, so clicking a
 * GDELT dot doesn't also open a country profile.
 */
export function useCountryIntelLayer(
  map: L.Map | null,
  boundaries: GeoJSON.FeatureCollection | undefined,
  visible: boolean,
  selectedIso3: string | null,
  onSelect: (iso3: string, name: string) => void,
) {
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const bordersRef = useRef<L.GeoJSON | null>(null);
  const selectedLayerRef = useRef<L.GeoJSON | null>(null);

  useEffect(() => {
    if (!map || !boundaries) return;
    if (!map.getPane("countryPane")) map.createPane("countryPane").style.zIndex = "250";
    const borders = L.geoJSON(boundaries, { pane: "countryPane", style: () => BORDER_STYLE, interactive: false });
    bordersRef.current = borders;
    return () => {
      safeRemove(borders);
      bordersRef.current = null;
    };
  }, [map, boundaries]);

  useEffect(() => {
    if (!map || !bordersRef.current) return;
    const borders = bordersRef.current;
    if (visible) {
      try { borders.addTo(map); } catch { /* map already torn down */ }
    } else {
      safeRemove(borders);
    }
  }, [map, boundaries, visible]);

  useEffect(() => {
    if (!map || !boundaries || !visible) return;
    const countries = indexCountries(boundaries);
    let lastPopupAt = 0;
    const onPopup = () => { lastPopupAt = Date.now(); };
    const onClick = (e: L.LeafletMouseEvent) => {
      if (Date.now() - lastPopupAt < 50) return;
      const ll = e.latlng.wrap();
      const c = countryAt(countries, ll.lng, ll.lat);
      if (c) onSelectRef.current(c.iso3, c.name);
    };
    map.on("popupopen", onPopup);
    map.on("click", onClick);
    map.getContainer().style.cursor = "crosshair";
    return () => {
      map.off("popupopen", onPopup);
      map.off("click", onClick);
      try { map.getContainer().style.cursor = ""; } catch { /* torn down */ }
    };
  }, [map, boundaries, visible]);

  useEffect(() => {
    safeRemove(selectedLayerRef.current);
    selectedLayerRef.current = null;
    if (!map || !boundaries || !visible || !selectedIso3) return;
    const feature = boundaries.features.find((f) => f.properties?.iso3 === selectedIso3);
    if (!feature) return;
    const layer = L.geoJSON(feature, { pane: "countryPane", style: () => SELECTED_STYLE, interactive: false });
    selectedLayerRef.current = layer;
    try { layer.addTo(map); } catch { /* map already torn down */ }
    return () => {
      safeRemove(layer);
      selectedLayerRef.current = null;
    };
  }, [map, boundaries, visible, selectedIso3]);
}
