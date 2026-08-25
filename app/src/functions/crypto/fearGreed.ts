// alternative.me Fear & Greed Index — free, no key, CORS open (verified:
// `access-control-allow-origin: *`). Updates once daily; `limit` pulls that
// many trailing days so we can show today vs. a week/month ago alongside it.
const FNG_URL = "https://api.alternative.me/fng/";

export interface FngPoint {
  value: number;
  classification: string;
  timestamp: number;
}

interface FngRaw {
  data: { value: string; value_classification: string; timestamp: string }[];
}

export async function fetchFearGreed(limit = 30): Promise<FngPoint[]> {
  const res = await fetch(`${FNG_URL}?limit=${limit}`);
  if (!res.ok) throw new Error(`alternative.me F&G failed: HTTP ${res.status}`);
  const json: FngRaw = await res.json();
  return json.data.map((d) => ({
    value: Number(d.value),
    classification: d.value_classification,
    timestamp: Number(d.timestamp) * 1000,
  }));
}
