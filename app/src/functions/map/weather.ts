// Weather alerts from three official regional feeds via weatherProxyPlugin:
// NOAA/NWS (US), MeteoAlarm (Europe), Environment Canada. NOT global —
// the UI says so rather than implying coverage elsewhere.
import { fetchProxyJson } from "./proxyFetch";

export type WeatherSeverity = "Extreme" | "Severe" | "Moderate" | "Minor" | "Unknown";
export type WeatherRegion = "us" | "eu" | "ca";

export interface WeatherAlert {
  id: string;
  region: WeatherRegion;
  event: string;
  severity: WeatherSeverity;
  headline: string;
  area: string;
  onset: string | null;
  expires: string | null;
  source: string;
  lat: number;
  lon: number;
  rings: [number, number][][];
}

export interface RegionStatus { status: "ok" | "error"; count: number; error?: string }
export interface WeatherResult { alerts: WeatherAlert[]; regions: Record<WeatherRegion, RegionStatus> }

export const REGION_LABEL: Record<WeatherRegion, string> = { us: "US · NWS", eu: "Europe · MeteoAlarm", ca: "Canada · ECCC" };

export const SEVERITY_COLOR: Record<WeatherSeverity, string> = {
  Extreme: "#ff3b3b",
  Severe: "#ff8c22",
  Moderate: "#eeb022",
  Minor: "#22ccee",
  Unknown: "#6e6e6e",
};

export async function fetchWeatherAlerts(): Promise<WeatherResult> {
  const json = await fetchProxyJson<{ results: WeatherAlert[]; regions: WeatherResult["regions"] }>("/weather-proxy/alerts", "Weather alerts feed");
  return { alerts: json.results, regions: json.regions };
}
