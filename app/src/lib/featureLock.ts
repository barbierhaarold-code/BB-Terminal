import { useAuth } from "@/store/authStore";
import { useFeatureLock, type LockableFeature } from "@/store/featureLockStore";

export type { LockableFeature };

/** Thrown by a proxy fetcher when the server answered 403 feature_locked, so the
 *  normal error path can tell a locked feature apart from a real failure. */
export class FeatureLockedError extends Error {
  constructor(public feature: LockableFeature) {
    super(`feature_locked:${feature}`);
    this.name = "FeatureLockedError";
  }
}

export interface FeatureCopy {
  /** Short name used in the mailto subject and body. */
  name: string;
  headline: string;
  body: string;
  /** One honest line on why it's gated. */
  reason: string;
  button: string;
}

// Wording is fixed product copy — do not paraphrase. Each entry says only what
// the feature is; it must not claim anything these lines don't.
export const FEATURE_LOCK_COPY: Record<LockableFeature, FeatureCopy> = {
  tweets: {
    name: "Tweets",
    headline: "The voices that move markets, inside your terminal",
    body: "The X accounts the pros watch, in one place, refreshed continuously. See what's breaking before it hits the headlines, with no timeline to scroll and no noise, just the accounts that matter.",
    reason: "This feed runs on paid data, so I open it by hand, one person at a time.",
    button: "Request access from Harold",
  },
  copilot: {
    name: "Copilot",
    headline: "Your personal AI analyst, with the whole terminal in view",
    body: `It sees what you see: live price, trading sessions, institutional positioning (COT), breaking news, the economic calendar, your portfolio and your entire trade journal. Ask a question in plain language and it cross-checks everything in seconds, with a summary that would take you 20 minutes to build. It knows your own stats: it tells you where you lose money, on which setup, at what time of day. And it keeps growing: options, insiders, Congress trades, crypto and quantitative analysis are on their way into its toolkit. It never tells you to "buy" or "sell". It sharpens your view, and the decision stays yours.`,
    reason: "Every question has a real cost, so access is managed by Harold.",
    button: "Request access from Harold",
  },
  ais: {
    name: "Vessels",
    headline: "Global trade, live on the map",
    body: "Thousands of ships in real time: tankers, cargo vessels, strategic chokepoints. See the physical flows before they show up in the numbers.",
    reason: "This feed runs on a live data stream, so access is managed by Harold.",
    button: "Request access from Harold",
  },
};

/**
 * Inspects a proxy response for the server's feature-lock verdict. Updates the
 * shared lock flag either way (so a restored allowlist clears the locked panel
 * on the next call) and throws FeatureLockedError when the feature is locked.
 */
export function applyFeatureLock(feature: LockableFeature, res: Response, body: unknown): void {
  const locked = res.status === 403 && (body as { error?: string } | null)?.error === "feature_locked";
  useFeatureLock.getState().setLocked(feature, locked);
  if (locked) throw new FeatureLockedError(feature);
}

/** A pre-filled mailto to Harold requesting access, in English, carrying the
 *  signed-in user's email so he knows which account to add to the allowlist. */
export function buildAccessMailtoHref(feature: LockableFeature): string {
  const { name } = FEATURE_LOCK_COPY[feature];
  const email = useAuth.getState().email;
  const subject = `Access request: ${name}`;
  const body = [
    "Hi Harold,",
    "",
    `I'd like access to the ${name} feature in ABDEL KHADER.`,
    `My account: ${email ?? "(signed-in email)"}`,
    "",
    "Thanks",
  ].join("\n");
  return `mailto:harold@xenasolution.be?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
