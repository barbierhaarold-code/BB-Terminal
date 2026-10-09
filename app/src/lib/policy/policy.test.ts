import { describe, expect, it } from "vitest";
import { cleanText, decodeEntities, excerptOf, looksLikeFeed, parseDate, parseFeed } from "./parse";
import { filterItems, isNew, mergeItems } from "./filter";
import { FEEDS, FEED_BY_ID, EXCERPT_MAX } from "./config";

const def = (id: string) => FEED_BY_ID[id];

const FED = `﻿<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>FRB</title><item>
<title>Federal Reserve Board releases results of the 2025 Survey of Consumer Finances</title>
<link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm]]></link>
<guid><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm]]></guid>
<description><![CDATA[Federal Reserve Board releases results of the 2025 Survey of Consumer Finances]]></description>
<category>Other Announcements</category><pubDate><![CDATA[Fri, 9 Oct 2026 14:00:00 GMT]]></pubDate></item></channel></rss>`;
const BIS = `<?xml version="1.0"?><rdf:RDF xmlns:rdf="x" xmlns:dc="y"><item rdf:about="https://www.bis.org/speeches/20261007-update-and-outlook-jamaican-economy"><title>Update &amp; outlook for the Jamaican economy</title><link>https://www.bis.org/speeches/20261007-update-and-outlook-jamaican-economy</link><description>Speech by Mr Brian Langrin, Governor of the Bank of Jamaica, at the Monetary Policy Decision Press Briefing, Kingston, 29 September 2026.</description><dc:date>2026-10-08T00:00:00Z</dc:date></item></rdf:RDF>`;
const BOE = `<rss><channel><item><guid isPermaLink="false">{95A8}</guid><link>https://www.bankofengland.co.uk/news/2026/october/cmorg</link><title>CMORG holds sector-wide cloud outage simulation exercise</title><description>The Cross-Market Operational Resilience Group completed its exercise.</description><pubDate>Fri, 09 Oct 2026 10:00:00 +0100</pubDate></item></channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom entry</title><link rel="alternate" href="https://example.test/a?x=1&amp;y=2"/><updated>2026-10-05T12:30:00Z</updated><summary>&lt;p&gt;Some &lt;b&gt;bold&lt;/b&gt; summary&lt;/p&gt;</summary></entry></feed>`;

describe("text helpers", () => {
  it("decodes named, decimal and hex entities and leaves unknown ones alone", () => {
    expect(decodeEntities("A &amp; B &#8217; &#x2013; &bogus; &quot;q&quot;")).toBe('A & B ’ – &bogus; "q"');
    expect(decodeEntities("T&uuml;rkiye, S&oslash;rensen, &Ccedil;elik, &Uuml;ber, &eacute;&Eacute;")).toBe("Türkiye, Sørensen, Çelik, Über, éÉ"); // case matters for Latin-1 names
  });
  it("cleanText unwraps CDATA, strips tags (also when double-escaped) and collapses whitespace", () => {
    expect(cleanText("<![CDATA[ Hello \n  <b>world</b> ]]>")).toBe("Hello world");
    expect(cleanText("&lt;p&gt;Some &lt;b&gt;bold&lt;/b&gt;&lt;/p&gt;")).toBe("Some bold");
  });
  it("dates: RFC-822 with single-digit day and numeric offsets, ISO, and garbage → null", () => {
    expect(parseDate("<![CDATA[Fri, 9 Oct 2026 14:00:00 GMT]]>")).toBe("2026-10-09T14:00:00.000Z");
    expect(parseDate("Thu, 08 Oct 2026 13:30:00 +0200")).toBe("2026-10-08T11:30:00.000Z");
    expect(parseDate("Fri, 09 Oct 2026 18:00:00 +0900")).toBe("2026-10-09T09:00:00.000Z");
    expect(parseDate("2026-10-08T00:00:00Z")).toBe("2026-10-08T00:00:00.000Z");
    expect(parseDate("2026-10-08T08:00:44+02:00")).toBe("2026-10-08T06:00:44.000Z");
    expect(parseDate("soon")).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
  it("an excerpt exists only when the feed provides a description that is not the title, capped at 300 characters", () => {
    expect(excerptOf("Same Title!", "same title")).toBeNull();
    expect(excerptOf(null, "t")).toBeNull();
    expect(excerptOf("   ", "t")).toBeNull();
    const long = excerptOf("word ".repeat(200), "t")!;
    expect(long.length).toBeLessThanOrEqual(EXCERPT_MAX);
    expect(long.endsWith("…")).toBe(true);
    expect(excerptOf("Short real description.", "Another title")).toBe("Short real description.");
  });
});

describe("parseFeed", () => {
  it("Fed (CDATA everywhere, BOM): title, link, date; description equal to the title is NOT an excerpt", () => {
    const [it] = parseFeed(FED, def("fed-press"));
    expect(it).toMatchObject({ link: "https://www.federalreserve.gov/newsevents/pressreleases/other20261009a.htm", publishedAt: "2026-10-09T14:00:00.000Z", excerpt: null, institution: "Federal Reserve", currency: "USD", contentType: "press release" });
  });
  it("BIS (RDF): entity-decoded title, dc:date, feed-provided description as excerpt, no currency for a multilateral body", () => {
    const [it] = parseFeed(BIS, def("bis-cbspeeches"));
    expect(it.title).toBe("Update & outlook for the Jamaican economy");
    expect(it.publishedAt).toBe("2026-10-08T00:00:00.000Z");
    expect(it.excerpt).toMatch(/^Speech by Mr Brian Langrin/);
    expect(it).toMatchObject({ currency: null, institutionType: "multilateral", contentType: "speech" });
  });
  it("BoE (RSS with non-URL guid) and Atom (href link, escaped HTML summary)", () => {
    expect(parseFeed(BOE, def("boe-news"))[0]).toMatchObject({ link: "https://www.bankofengland.co.uk/news/2026/october/cmorg", publishedAt: "2026-10-09T09:00:00.000Z", currency: "GBP" });
    const [a] = parseFeed(ATOM, def("boc-press"));
    expect(a).toMatchObject({ link: "https://example.test/a?x=1&y=2", publishedAt: "2026-10-05T12:30:00.000Z", excerpt: "Some bold summary" });
  });
  it("skips entries without a title or a usable link and de-duplicates links; keeps undated items with null date", () => {
    const xml = `<rss><channel><item><title>No link</title></item><item><link>https://a.test/1</link></item><item><title>A</title><link>https://a.test/1</link></item><item><title>A again</title><link>https://a.test/1</link></item><item><title>Undated</title><link>https://a.test/2</link></item></channel></rss>`;
    const items = parseFeed(xml, def("ecb-press"));
    expect(items.map((i) => [i.title, i.publishedAt])).toEqual([["A", null], ["Undated", null]]);
  });
  it("an HTML challenge page is not a feed", () => {
    expect(looksLikeFeed("<html><title>Just a moment...</title>")).toBe(false);
    expect(looksLikeFeed(FED)).toBe(true);
    expect(looksLikeFeed(ATOM)).toBe(true);
    expect(looksLikeFeed(BIS)).toBe(true);
  });
});

describe("merge and filter", () => {
  const mk = (feed: string, title: string, link: string, at: string | null) => ({ ...parseFeed(`<rss><item><title>${title}</title><link>${link}</link>${at ? `<pubDate>${at}</pubDate>` : ""}<description>about ${title}</description></item></rss>`, def(feed))[0] });
  const a = mk("fed-press", "Rate decision", "https://f/1", "Wed, 07 Oct 2026 12:00:00 GMT");
  const b = mk("ecb-press", "Euro area statement", "https://e/1", "Thu, 08 Oct 2026 12:00:00 GMT");
  const c = mk("bis-wp", "Working paper on liquidity", "https://b/1", "Tue, 06 Oct 2026 12:00:00 GMT");
  const d = mk("boe-news", "Undated note", "https://o/1", null);
  const dup = { ...mk("fed-speeches", "Rate decision (dup)", "https://f/1", "Wed, 07 Oct 2026 12:00:00 GMT") };
  const all = mergeItems([[a, c], [b, d], [dup]], 10);
  it("newest first, undated last, duplicates across feeds dropped, capped", () => {
    expect(all.map((i) => i.title)).toEqual(["Euro area statement", "Rate decision", "Working paper on liquidity", "Undated note"]);
    expect(mergeItems([[a, b, c]], 2)).toHaveLength(2);
  });
  it("filters by institution, type, content type, currency (including 'none'), search text and since", () => {
    expect(filterItems(all, { institution: "European Central Bank" }).map((i) => i.title)).toEqual(["Euro area statement"]);
    expect(filterItems(all, { institutionType: "multilateral" }).map((i) => i.title)).toEqual(["Working paper on liquidity"]);
    expect(filterItems(all, { contentType: "research" })).toHaveLength(1);
    expect(filterItems(all, { currency: "USD" }).map((i) => i.title)).toEqual(["Rate decision"]);
    expect(filterItems(all, { currency: "none" }).map((i) => i.title)).toEqual(["Working paper on liquidity"]);
    expect(filterItems(all, { query: "LIQUIDITY" })).toHaveLength(1);
    expect(filterItems(all, { query: "about rate" }).map((i) => i.title)).toEqual(["Rate decision"]);
    expect(filterItems(all, { since: "2026-10-07T13:00:00.000Z" }).map((i) => i.title)).toEqual(["Euro area statement"]);
  });
  it("new-item markers: only items strictly newer than the previous visit; nothing on a first visit; undated never new", () => {
    expect(all.map((i) => isNew(i, "2026-10-07T00:00:00.000Z"))).toEqual([true, true, false, false]);
    expect(all.some((i) => isNew(i, null))).toBe(false);
  });
});

describe("config", () => {
  it("unique ids, https urls, currency derived from the institution (consistent per institution), none for multilaterals", () => {
    expect(new Set(FEEDS.map((x) => x.id)).size).toBe(FEEDS.length);
    expect(FEEDS.every((x) => x.url.startsWith("https://"))).toBe(true);
    const byInst = new Map<string, Set<string | null>>();
    for (const x of FEEDS) byInst.set(x.institution, (byInst.get(x.institution) ?? new Set()).add(x.currency));
    expect([...byInst.values()].every((s) => s.size === 1)).toBe(true);
    expect(FEEDS.filter((x) => x.institutionType === "multilateral").every((x) => x.currency === null)).toBe(true);
  });
});
