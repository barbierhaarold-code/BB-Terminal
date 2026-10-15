// Is the in-memory journal/plan data trustworthy for the CURRENT signed-in user?
// Anything that reads the stores outside React (Copilot tools) must ask this first, so a load
// failure, a still-loading account or leftover data of another account is never read as "empty".
import { useJournal } from "@/store/journalStore";
import { useTradePlans } from "@/store/tradePlanStore";
import { isServerMode } from "./backend";
import { currentUserId } from "./runtime";

function reason(s: { status: string; ownerId: string | null; loadError: string | null }, what: string): string | null {
  if (!isServerMode()) return null;
  const uid = currentUserId();
  if (!uid) return `You are not signed in, so ${what} is unavailable.`;
  if (s.ownerId !== uid) return `${what} for this account is not loaded yet.`;
  if (s.status === "error") return `${what} could not be loaded: ${s.loadError ?? "unknown error"}. This is NOT an empty ${what}.`;
  if (s.status !== "ready") return `${what} is still loading. This is NOT an empty ${what}.`;
  return null;
}

export const journalUnavailableReason = (): string | null => reason(useJournal.getState(), "the Track Record");
export const plansUnavailableReason = (): string | null => reason(useTradePlans.getState(), "the trade plans");
