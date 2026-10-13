import { describe, expect, it } from "vitest";
import { parseMacroUrl, withMacroUrl } from "./urlState";
import { fmtDelta, fmtIn, transformUnit } from "./format";
import { docItems } from "./docs";
import { ALL_BY_ID } from "./catalog";
import { parseMofCsv } from "../../../vite-plugins/macroDirect";
import type { PolicyItem } from "../policy/types";

describe("deep-link URL state", () => {
  it("round-trips the detail view state and keeps unrelated parameters", () => {
    const q = withMacroUrl("?foo=1", { id: "us.cpi", transform: "mom", range: "5Y", overlay: "us.pce" });
    expect(q).toBe("?foo=1&macro=us.cpi&mt=mom&mr=5Y&mo=us.pce");
    expect(parseMacroUrl(q)).toEqual({ id: "us.cpi", transform: "mom", range: "5Y", overlay: "us.pce" });
  });
  it("closing the view removes every macro key; junk values are ignored, never trusted", () => {
    expect(withMacroUrl("?foo=1&macro=us.cpi&mt=yoy&mo=us.pce", { id: null })).toBe("?foo=1");
    expect(parseMacroUrl("?macro=<script>&mt=evil&mr=99Y")).toEqual({ id: null, transform: null, range: null, overlay: null });
  });
});

describe("unit-aware formatting", () => {
  it("formats money, thousands, ratios and deltas without changing signs", () => {
    expect(fmtIn(40305316210829.72, "usd", 2)).toBe("$40.31 tn");
    expect(fmtIn(-105572, "usd_mn", 1)).toBe("−$105.6 bn");
    expect(fmtIn(6747560, "usd_mn", 1)).toBe("$6.7 tn");
    expect(fmtIn(29, "k", 0)).toBe("29k");
    expect(fmtIn(2.77, "ratio", 2)).toBe("2.77×");
    expect(fmtDelta(-0.1, "%", 1)).toBe("−0.1 pp");
    expect(fmtDelta(-12744, "usd_mn", 1)).toBe("−$12.7 bn");
  });
  it("chart units follow the transformation", () => {
    expect(transformUnit(ALL_BY_ID["us.cpi"], "level")).toBe("index");
    expect(transformUnit(ALL_BY_ID["us.cpi"], "yoy")).toBe("%");
    expect(transformUnit(ALL_BY_ID["us.payrolls"], "diff")).toBe("k");
    expect(transformUnit(ALL_BY_ID["us.unemp"], "diff")).toBe("pp");
  });
});

describe("official documents from the Policy Feed", () => {
  const it0 = (o: Partial<PolicyItem>): PolicyItem => ({ id: o.title!, feedId: "f", title: "", link: "https://x", publishedAt: null, excerpt: null, institution: "Federal Reserve", institutionType: "central bank", contentType: "press release", currency: "USD", ...o });
  it("filters by institution and title, newest first, undated last", () => {
    const items = [
      it0({ title: "Federal Reserve issues FOMC statement", publishedAt: "2026-09-16T18:00:00Z" }),
      it0({ title: "Federal Reserve issues FOMC statement", publishedAt: "2026-10-28T18:00:00Z", id: "b" }),
      it0({ title: "FOMC statement (undated)", publishedAt: null, id: "c" }),
      it0({ title: "FOMC statement", institution: "European Central Bank", id: "d" }),
    ];
    const r = docItems(items, { institutions: ["Federal Reserve"], match: /FOMC statement/ }, 5);
    expect(r.map((x) => x.id)).toEqual(["b", "Federal Reserve issues FOMC statement", "c"]);
    expect(docItems(items, undefined, 5)).toEqual([]);
  });
});

describe("Ministry of Finance JGB CSV", () => {
  it("reads YYYY/M/D dates, picks the column by header and keeps '-' as a missing value", () => {
    const csv = "Interest Rate,,(Unit : %)\nDate,1Y,10Y\n1974/9/24,10.327,-\n2026/9/30,1.684,3.057\n";
    expect(parseMofCsv(csv, "10Y")).toEqual([["1974-09-24", "-"], ["2026-09-30", "3.057"]]);
    expect(() => parseMofCsv(csv, "50Y")).toThrow(/no "50Y" column/);
  });
});

import { ordinal } from "../../functions/macro/DetailPanel";
import { FED_POLICY_FEED } from "./explainBase";
describe("display details found in the live check", () => {
  it("percentiles use correct English ordinals", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 53, 63, 73, 100, 101, 112].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "53rd", "63rd", "73rd", "100th", "101st", "112th"]);
  });
  it("the SEP match takes the projections press release, not a speech that mentions the SEP", () => {
    expect(FED_POLICY_FEED.match.test("Federal Reserve Board and Federal Open Market Committee release economic projections from the September 15-16 FOMC meeting")).toBe(true);
    expect(FED_POLICY_FEED.match.test("Waller, The Signaling Value of the Summary of Economic Projections")).toBe(false);
  });
});
