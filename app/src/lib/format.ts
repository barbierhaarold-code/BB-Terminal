export function fmtPrice(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtInt(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  return Math.round(v).toLocaleString();
}

export function fmtVolume(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(2) + "K";
  return v.toString();
}

export function fmtPct(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return sign + v.toFixed(digits) + "%";
}

export function fmtPctFromDecimal(v: number | null | undefined, digits = 2) {
  if (v == null || Number.isNaN(v)) return "—";
  return fmtPct(v * 100, digits);
}

export function fmtDate(iso?: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: "2-digit", month: "short", day: "2-digit" });
  } catch { return iso; }
}

export function fmtTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export function dirClass(v: number | null | undefined): "up" | "down" | "flat" {
  if (v == null || Number.isNaN(v)) return "flat";
  return v >= 0 ? "up" : "down";
}
