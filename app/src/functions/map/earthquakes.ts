// USGS real-time earthquake GeoJSON summary feeds — free, no key, CORS open.
// https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/

export type QuakeWindow = "day" | "week" | "month";

export const QUAKE_WINDOW_LABEL: Record<QuakeWindow, string> = {
  day: "24H",
  week: "7D",
  month: "30D",
};

const FEED_URL: Record<QuakeWindow, string> = {
  day: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  week: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson",
  month: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
};

export interface Earthquake {
  id: string;
  mag: number | null;
  place: string;
  /** Epoch ms. */
  time: number;
  depthKm: number;
  lat: number;
  lon: number;
  url: string;
}

interface UsgsFeatureCollection {
  features: {
    id: string;
    properties: { mag: number | null; place: string | null; time: number; url: string };
    geometry: { coordinates: [number, number, number] }; // [lon, lat, depthKm]
  }[];
}

export async function fetchEarthquakes(window: QuakeWindow): Promise<Earthquake[]> {
  const res = await fetch(FEED_URL[window]);
  if (!res.ok) throw new Error(`USGS earthquake feed failed: HTTP ${res.status}`);
  const json: UsgsFeatureCollection = await res.json();
  return json.features.map((f) => ({
    id: f.id,
    mag: f.properties.mag,
    place: f.properties.place ?? "Unknown location",
    time: f.properties.time,
    url: f.properties.url,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    depthKm: f.geometry.coordinates[2],
  }));
}
