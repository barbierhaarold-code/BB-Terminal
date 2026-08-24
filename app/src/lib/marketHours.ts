import { localParts, localToUtc } from "@/lib/forex";

// ────────────────────────────────────────────────────────────
// Market Hours — pure timezone math, no external data. Same approach as
// forex.ts's SESSIONS (weekday + local open/close hour, no holiday
// calendar — a holiday just shows as "should be open" when it isn't, which
// is an acceptable gap for a glance-at-it board). Hours support decimal
// fractions (9.5 = 09:30) since several exchanges open on the half hour.
// ────────────────────────────────────────────────────────────

export interface ExchangeDef {
  name: string;
  flag: string;
  tz: string;
  /** local open/close hour (24h, decimal for half-hours e.g. 9.5 = 09:30) */
  open: number;
  close: number;
  /** only set for venues with well-known retail extended hours (NYSE/NASDAQ) */
  preOpen?: number;
  postClose?: number;
}

export const EXCHANGES: ExchangeDef[] = [
  { name: "NYSE",              flag: "🇺🇸", tz: "America/New_York",     open: 9.5,  close: 16,   preOpen: 4, postClose: 20 },
  { name: "NASDAQ",            flag: "🇺🇸", tz: "America/New_York",     open: 9.5,  close: 16,   preOpen: 4, postClose: 20 },
  { name: "Toronto (TSX)",     flag: "🇨🇦", tz: "America/Toronto",      open: 9.5,  close: 16 },
  { name: "London (LSE)",      flag: "🇬🇧", tz: "Europe/London",        open: 8,    close: 16.5 },
  { name: "Euronext",          flag: "🇪🇺", tz: "Europe/Paris",         open: 9,    close: 17.5 },
  { name: "Frankfurt (Xetra)", flag: "🇩🇪", tz: "Europe/Berlin",        open: 9,    close: 17.5 },
  { name: "Johannesburg (JSE)",flag: "🇿🇦", tz: "Africa/Johannesburg",  open: 9,    close: 17 },
  { name: "Tokyo (TSE)",       flag: "🇯🇵", tz: "Asia/Tokyo",           open: 9,    close: 15 },
  { name: "Hong Kong (HKEX)",  flag: "🇭🇰", tz: "Asia/Hong_Kong",       open: 9.5,  close: 16 },
  { name: "Shanghai (SSE)",    flag: "🇨🇳", tz: "Asia/Shanghai",        open: 9.5,  close: 15 },
  { name: "Shenzhen (SZSE)",   flag: "🇨🇳", tz: "Asia/Shanghai",        open: 9.5,  close: 15 },
  { name: "Singapore (SGX)",   flag: "🇸🇬", tz: "Asia/Singapore",       open: 9,    close: 17 },
  { name: "Korea (KRX)",       flag: "🇰🇷", tz: "Asia/Seoul",           open: 9,    close: 15.5 },
  { name: "India (NSE/BSE)",   flag: "🇮🇳", tz: "Asia/Kolkata",         open: 9.25, close: 15.5 },
  { name: "ASX",               flag: "🇦🇺", tz: "Australia/Sydney",     open: 10,   close: 16 },
];

export type ExchangePhase = "pre" | "open" | "after" | "closed";

export interface ExchangeStatus {
  def: ExchangeDef;
  phase: ExchangePhase;
  /** localized "HH:MM" current time at the venue */
  localTime: string;
  /** ms until the next phase transition */
  msToNext: number;
}

function hm(hourDecimal: number): { hour: number; minute: number } {
  const hour = Math.floor(hourDecimal);
  const minute = Math.round((hourDecimal - hour) * 60);
  return { hour, minute };
}

export function exchangeStatus(def: ExchangeDef, now: Date): ExchangeStatus {
  const { dow, minutes } = localParts(def.tz, now);
  const isWeekday = dow >= 1 && dow <= 5;

  const preMin = def.preOpen != null ? def.preOpen * 60 : undefined;
  const openMin = def.open * 60;
  const closeMin = def.close * 60;
  const postMin = def.postClose != null ? def.postClose * 60 : undefined;

  let phase: ExchangePhase = "closed";
  if (isWeekday) {
    if (minutes >= openMin && minutes < closeMin) phase = "open";
    else if (preMin != null && minutes >= preMin && minutes < openMin) phase = "pre";
    else if (postMin != null && minutes >= closeMin && minutes < postMin) phase = "after";
  }

  const localTime = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

  // Next transition: the boundary that ends the current phase, or (when
  // closed) the next weekday's earliest session start (pre-market if the
  // venue has one, else regular open).
  let msToNext: number;
  if (phase === "pre") {
    const { hour, minute } = hm(def.open);
    msToNext = localToUtc(def.tz, now, 0, hour, minute) - now.getTime();
  } else if (phase === "open") {
    const { hour, minute } = hm(def.close);
    msToNext = localToUtc(def.tz, now, 0, hour, minute) - now.getTime();
  } else if (phase === "after") {
    const { hour, minute } = hm(def.postClose!);
    msToNext = localToUtc(def.tz, now, 0, hour, minute) - now.getTime();
  } else {
    const startHour = def.preOpen ?? def.open;
    const { hour, minute } = hm(startHour);
    let found = Infinity;
    for (let d = 0; d <= 4; d++) {
      const candidate = localToUtc(def.tz, now, d, hour, minute);
      if (candidate <= now.getTime()) continue;
      const targetDow = (dow + d) % 7;
      if (targetDow >= 1 && targetDow <= 5) { found = candidate - now.getTime(); break; }
    }
    msToNext = found;
  }

  return { def, phase, localTime, msToNext };
}
