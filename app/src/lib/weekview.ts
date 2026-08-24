/** Mon–Fri business week containing `d`, as local-date (YYYY-MM-DD) strings. */
export function weekRange(d: Date): { monday: string; friday: string; days: string[] } {
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);
  const days = Array.from({ length: 5 }, (_, i) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    return toYmd(x);
  });
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return { monday: toYmd(monday), friday: toYmd(friday), days };
}

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addWeeks(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n * 7);
  return x;
}

export function weekLabel(days: string[]): string {
  const fmt = (ymd: string) => {
    const [, m, dd] = ymd.split("-");
    return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][Number(m) - 1]} ${Number(dd)}`;
  };
  return `${fmt(days[0])} – ${fmt(days[4])}`;
}

export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
