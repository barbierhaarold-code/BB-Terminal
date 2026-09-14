// NASA FIRMS (Fire Information for Resource Management System) — VIIRS
// near-real-time active-fire detections. Free, but requires a personal
// MAP_KEY (NASA Earthdata account, no cost) — see FIRMS_MAP_KEY in
// app/.env.example. The key is kept server-side (see firmsProxyPlugin in
// vite.config.ts) and never reaches the browser bundle, same reasoning as
// the Twelve Data/GetXAPI/Anthropic keys proxied there.
// https://firms.modaps.eosdis.nasa.gov/api/area/

export interface FireDetection {
  id: string;
  lat: number;
  lon: number;
  /** Brightness temperature (Kelvin) of the fire pixel, channel I-4/M-13. */
  brightness: number;
  /** Fire Radiative Power in megawatts — a proxy for fire intensity/size. */
  frp: number;
  confidence: "low" | "nominal" | "high";
  satellite: string;
  /** Epoch ms, from the combined acq_date + acq_time fields. */
  acquiredAt: number;
  daynight: "D" | "N";
}

export type FireConfidenceFilter = "all" | "nominal_high";

/** Parses the FIRMS VIIRS CSV (header row + comma rows) into typed detections. Column order isn't assumed — read from the header so a schema tweak upstream can't silently misalign fields. */
function parseFirmsCsv(csv: string): FireDetection[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => header.indexOf(name);
  const iLat = col("latitude");
  const iLon = col("longitude");
  const iBright = col("bright_ti4") >= 0 ? col("bright_ti4") : col("brightness");
  const iFrp = col("frp");
  const iConf = col("confidence");
  const iSat = col("satellite");
  const iDate = col("acq_date");
  const iTime = col("acq_time");
  const iDayNight = col("daynight");
  if (iLat < 0 || iLon < 0) return [];

  const confMap = (raw: string): FireDetection["confidence"] => {
    const v = raw.trim().toLowerCase();
    if (v === "l" || v === "low") return "low";
    if (v === "h" || v === "high") return "high";
    if (!Number.isNaN(Number(v))) {
      const n = Number(v);
      return n >= 80 ? "high" : n >= 30 ? "nominal" : "low";
    }
    return "nominal";
  };

  const out: FireDetection[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(",");
    if (row.length < header.length) continue;
    const lat = Number(row[iLat]);
    const lon = Number(row[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const dateStr = iDate >= 0 ? row[iDate].trim() : "";
    const timeStr = iTime >= 0 ? row[iTime].trim().padStart(4, "0") : "0000";
    const acquiredAt = dateStr
      ? Date.parse(`${dateStr}T${timeStr.slice(0, 2)}:${timeStr.slice(2, 4)}:00Z`)
      : Date.now();

    out.push({
      id: `${lat},${lon},${dateStr},${timeStr},${i}`,
      lat,
      lon,
      brightness: iBright >= 0 ? Number(row[iBright]) : NaN,
      frp: iFrp >= 0 ? Number(row[iFrp]) : NaN,
      confidence: iConf >= 0 ? confMap(row[iConf]) : "nominal",
      satellite: iSat >= 0 ? row[iSat].trim() : "VIIRS",
      acquiredAt: Number.isFinite(acquiredAt) ? acquiredAt : Date.now(),
      daynight: (iDayNight >= 0 ? row[iDayNight].trim().toUpperCase() : "D") === "N" ? "N" : "D",
    });
  }
  return out;
}

/** Fetches the last 24h of world VIIRS fire detections via the server-side proxy (keeps FIRMS_MAP_KEY out of the client bundle). */
export async function fetchFires(): Promise<FireDetection[]> {
  const res = await fetch("/firms-proxy/fires");
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.warnings?.[0]?.message ?? `FIRMS fire feed failed: HTTP ${res.status}`);
  }
  const csv = await res.text();
  return parseFirmsCsv(csv);
}

export function frpColor(frp: number): string {
  if (!Number.isFinite(frp) || frp < 5) return "#ffd23b";
  if (frp < 20) return "#ff9d1f";
  if (frp < 100) return "#ff5c1f";
  return "#ff2d1f";
}

export function frpRadius(frp: number): number {
  const f = Number.isFinite(frp) ? Math.max(frp, 0) : 1;
  return Math.max(2.5, Math.min(12, 2.5 + Math.sqrt(f) * 0.9));
}
