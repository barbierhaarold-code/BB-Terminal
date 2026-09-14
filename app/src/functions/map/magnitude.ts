// Magnitude → visual encoding for earthquake markers. This is a data-severity
// scale (green = minor, red = major), the same green↔red vocabulary the rest
// of the app already uses for signed change (see HEAT.tsx's heatColor) — not
// a UI-chrome accent, so it deliberately doesn't reach for the violet token.

export function magnitudeColor(mag: number | null): string {
  const m = mag ?? 0;
  if (m < 2.5) return "#22ee22"; // term-green
  if (m < 4) return "#c8e622";
  if (m < 5.5) return "#eeb022";
  if (m < 7) return "#ff8c22";
  return "#ff3b3b"; // term-red
}

export function magnitudeRadius(mag: number | null): number {
  const m = Math.max(mag ?? 0, 0);
  return Math.max(3, Math.min(22, 3 + m * 2.4));
}
