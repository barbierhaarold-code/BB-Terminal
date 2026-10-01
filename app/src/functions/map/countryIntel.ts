// Country intelligence profile — geopolitical/macro risk view per country
// (World Bank macro snapshot, CPI, HDI, OFAC SDN footprint, US State Dept
// advisory) from countryIntelProxyPlugin. Complements, does not duplicate,
// Equity Research / Markets, which are company- and market-level.
import { fetchProxyJson } from "./proxyFetch";

export interface WbPoint { value: number; year: string }
type Section<T> = { status: "ok"; data: T } | { status: "error"; error: string } | { status: "empty"; note: string };

export interface CountryProfile {
  iso3: string;
  iso2: string;
  name: string;
  capital: string;
  region: string;
  incomeLevel: string;
  macro: Section<Record<"gdp" | "gdpGrowth" | "gdpPerCapita" | "inflation" | "unemployment" | "population" | "militaryPctGdp", WbPoint | null>>;
  governance: Section<{
    cpi: { score: number; rank: number; year: string } | null;
    hdi: { hdi: number; rank: number | null; group: string; year: string } | null;
    errors: string[];
  }>;
  sanctions: Section<{ addresses: number; entities: number }>;
  travel: Section<{ level: number; title: string; link: string; updated: string | null; summary: string }>;
}

export const fetchCountryProfile = (iso3: string) =>
  fetchProxyJson<CountryProfile>(`/country-intel-proxy/profile?iso3=${encodeURIComponent(iso3)}`, "Country profile");

export const fetchCountryBoundaries = () =>
  fetchProxyJson<GeoJSON.FeatureCollection>("/country-intel-proxy/boundaries", "Country boundaries");

export const TRAVEL_LEVEL_COLOR: Record<number, string> = { 1: "#22ee22", 2: "#eeb022", 3: "#ff8c22", 4: "#ff3b3b" };
