import type { Currency, FeedDef } from "./types";

// ────────────────────────────────────────────────────────────
// The feeds. Each URL was probed on 2026-10-09 with the terminal's honest User-Agent. Feeds that did not work then
// but could work later are KEPT (RBA, IMF) so the health strip says plainly why they are unavailable; feeds with no
// working URL at all (US Treasury press releases, World Bank, Eurostat, OECD) are not listed.
// Currency comes from the institution below, never from text.
// ────────────────────────────────────────────────────────────

const MIN = 60_000;
const f = (id: string, institution: string, institutionType: FeedDef["institutionType"], currency: Currency | null, contentType: FeedDef["contentType"], label: string, url: string, cacheMs = 15 * MIN): FeedDef =>
  ({ id, institution, institutionType, currency, contentType, label, url, cacheMs });

export const FEEDS: FeedDef[] = [
  f("fed-press", "Federal Reserve", "central bank", "USD", "press release", "Press releases", "https://www.federalreserve.gov/feeds/press_all.xml"),
  f("fed-speeches", "Federal Reserve", "central bank", "USD", "speech", "Speeches", "https://www.federalreserve.gov/feeds/speeches.xml"),
  f("fed-testimony", "Federal Reserve", "central bank", "USD", "speech", "Testimony", "https://www.federalreserve.gov/feeds/testimony.xml"),
  f("fed-feds", "Federal Reserve", "central bank", "USD", "research", "FEDS Notes", "https://www.federalreserve.gov/feeds/feds_notes.xml"),
  f("fed-wp", "Federal Reserve", "central bank", "USD", "research", "Working papers", "https://www.federalreserve.gov/feeds/working_papers.xml"),
  f("ecb-press", "European Central Bank", "central bank", "EUR", "press release", "Press", "https://www.ecb.europa.eu/rss/press.xml"),
  f("boe-news", "Bank of England", "central bank", "GBP", "press release", "News", "https://www.bankofengland.co.uk/rss/news"),
  f("boe-speeches", "Bank of England", "central bank", "GBP", "speech", "Speeches", "https://www.bankofengland.co.uk/rss/speeches"),
  f("boe-pubs", "Bank of England", "central bank", "GBP", "research", "Publications", "https://www.bankofengland.co.uk/rss/publications"),
  f("boe-stats", "Bank of England", "central bank", "GBP", "statistics", "Statistics", "https://www.bankofengland.co.uk/rss/statistics"),
  f("boj-new", "Bank of Japan", "central bank", "JPY", "press release", "What's new", "https://www.boj.or.jp/en/rss/whatsnew.xml"),
  f("snb-press", "Swiss National Bank", "central bank", "CHF", "press release", "Press releases", "https://www.snb.ch/public/rss/en/pressrel"),
  f("snb-speeches", "Swiss National Bank", "central bank", "CHF", "speech", "Speeches", "https://www.snb.ch/public/rss/en/speeches"),
  f("boc-press", "Bank of Canada", "central bank", "CAD", "press release", "Press releases", "https://www.bankofcanada.ca/content_type/press-releases/feed/"),
  f("boc-speeches", "Bank of Canada", "central bank", "CAD", "speech", "Speeches", "https://www.bankofcanada.ca/content_type/speeches/feed/"),
  f("boc-pubs", "Bank of Canada", "central bank", "CAD", "research", "Publications", "https://www.bankofcanada.ca/content_type/publications/feed/"),
  f("rbnz-news", "Reserve Bank of New Zealand", "central bank", "NZD", "press release", "News", "https://www.rbnz.govt.nz/feeds/news"),
  f("riks-press", "Sveriges Riksbank", "central bank", "SEK", "press release", "Press releases", "https://www.riksbank.se/en-gb/rss/press-releases/"),
  f("rba-media", "Reserve Bank of Australia", "central bank", "AUD", "press release", "Media releases", "https://www.rba.gov.au/rss/rss-cb-media-releases.xml"),
  f("rba-speeches", "Reserve Bank of Australia", "central bank", "AUD", "speech", "Speeches", "https://www.rba.gov.au/rss/rss-cb-speeches.xml"),
  f("bis-press", "Bank for International Settlements", "multilateral", null, "press release", "Press releases", "https://www.bis.org/doclist/all_pressrels.rss"),
  f("bis-cbspeeches", "Bank for International Settlements", "multilateral", null, "speech", "Central bankers' speeches", "https://www.bis.org/doclist/cbspeeches.rss"),
  f("bis-wp", "Bank for International Settlements", "multilateral", null, "research", "Working papers", "https://www.bis.org/doclist/wppubls.rss"),
  f("bis-papers", "Bank for International Settlements", "multilateral", null, "research", "BIS papers", "https://www.bis.org/doclist/bispapers.rss"),
  f("bis-fsi", "Bank for International Settlements", "multilateral", null, "research", "FSI publications", "https://www.bis.org/doclist/bis_fsi_publs.rss"),
  f("imf-news", "International Monetary Fund", "multilateral", null, "press release", "News", "https://www.imf.org/en/News/rss?language=eng"),
];

export const FEED_BY_ID: Record<string, FeedDef> = Object.fromEntries(FEEDS.map((x) => [x.id, x]));
export const INSTITUTIONS = [...new Set(FEEDS.map((x) => x.institution))];
export const CURRENCIES = [...new Set(FEEDS.map((x) => x.currency).filter((c): c is Currency => !!c))];
export const MAX_ITEMS = 400;
export const EXCERPT_MAX = 300;

export const POLICY_NOTE =
  "Official feeds of central banks and multilateral institutions, shown as published: title, institution, type, date and a link to the institution's own page. "
  + "An excerpt appears only where the feed itself provides one (never a summary written by this terminal). The currency is that of the issuing central bank; BIS and IMF items have none. "
  + "It is a reading list, not a signal: nothing here is scored, ranked or interpreted.";
