// Static, plain-English explainers for every World Map layer — no AI call, no cost.
// Market notes describe where a layer is *relevant context*; none of these events
// reliably moves a market on its own, so wording stays at "can matter / worth watching".

export interface LayerInfo {
  what: string;
  source: string;
  updates: string;
  markets: string;
}

export type LayerId =
  | "terminator" | "quakes" | "fires" | "volcanoes" | "ports" | "chokepoints"
  | "military" | "nuclear" | "gdelt" | "weather" | "country" | "ais" | "gpsjam";

export const LAYER_INFO: Record<LayerId, LayerInfo> = {
  terminator: {
    what: "The line between day and night on Earth right now.",
    source: "Computed in your browser from the current time.",
    updates: "Recalculated live.",
    markets: "Shows which regions are in daylight, a rough guide to which financial centres are likely open. It carries no data about events.",
  },
  quakes: {
    what: "Earthquakes of every magnitude, sized and coloured by strength. The 24H / 7D / 30D buttons change how far back the list goes; a longer window shows more (mostly small) quakes.",
    source: "USGS earthquake feeds.",
    updates: "About every minute.",
    markets: "A strong quake near factories, ports or mines can disrupt supply chains (chips, autos, metals) and insurers. Most quakes have no market effect; magnitude and location matter far more than the count.",
  },
  fires: {
    what: "Heat spots that satellites detected as active fires in the last 24 hours.",
    source: "NASA FIRMS (VIIRS satellite detections).",
    updates: "Satellite passes, refreshed here every 5 minutes.",
    markets: "Fires near farmland or forests can matter for crops and timber (e.g. wheat, palm oil, coffee, lumber), and near energy or mining sites for local output. A detection is a heat spot, not a confirmed damaged area, and many are routine agricultural burns.",
  },
  volcanoes: {
    what: "Historic significant eruptions worldwide, plus volcanoes currently under US-monitored alert.",
    source: "NOAA NCEI eruption database; USGS alerts (US volcanoes only).",
    updates: "Eruption history is static; alerts refresh every 5 minutes.",
    markets: "Large eruptions can disrupt air travel through ash clouds and, rarely, local farming or shipping. Alerts cover US volcanoes only, so a quiet map is not a global all-clear.",
  },
  ports: {
    what: "Commercial ports around the world. The size buttons filter between large and medium harbours.",
    source: "NGA World Port Index (US National Geospatial-Intelligence Agency).",
    updates: "Static directory (not live traffic).",
    markets: "Ports are where trade physically moves: container, oil, grain and metals flows. Useful for placing a news event (strike, storm, closure) against the infrastructure it could affect. This layer shows locations only, not congestion or volumes.",
  },
  chokepoints: {
    what: "Seven narrow straits and canals that much of the world's oil passes through, with the share of oil flow each carries.",
    source: "US Energy Information Administration (EIA) World Oil Transit Chokepoints report.",
    updates: "Static; figures are the latest published by EIA and are not live.",
    markets: "A disruption at a chokepoint (Hormuz, Suez, Malacca) can lift oil, tanker and freight prices and shipping insurance, because few alternative routes exist. Whether prices react depends on duration and spare capacity, so treat it as context, not a signal.",
  },
  military: {
    what: "Major, publicly documented military installations.",
    source: "Public records such as the US DoD Base Structure Report and national defence publications.",
    updates: "Static curated list; not live and not troop or fleet movements.",
    markets: "Gives geographic context for geopolitical news. Markets tend to react to escalation (defence stocks, oil, gold, safe-haven currencies), but the base locations themselves are not a signal.",
  },
  nuclear: {
    what: "Major nuclear power plants worldwide.",
    source: "IAEA Power Reactor Information System and World Nuclear Association.",
    updates: "Static curated list; status reflects the latest public information, not live operations.",
    markets: "Relevant to electricity supply and to uranium and utility stocks, and for putting an incident or outage into context. The map does not show whether any plant is running at a given moment.",
  },
  gdelt: {
    what: "News-derived events such as protests, fighting and unrest, colour-coded by category.",
    source: "GDELT Project (machine-coded from news reports).",
    updates: "Every 15 minutes, covering roughly the last 4 hours.",
    markets: "A cluster of unrest or conflict near an energy, grain or shipping hub is worth watching for commodities and regional assets. The coding is automated, so locations and categories can be wrong and repeated reports can inflate counts. Treat it as a lead to verify, not a fact.",
  },
  weather: {
    what: "Official severe-weather warnings.",
    source: "NOAA/NWS (US), MeteoAlarm (Europe), Environment Canada. Not global.",
    updates: "Every 5 minutes.",
    markets: "Storms, floods, heat or cold can affect crops, natural gas and power demand, refining and transport. Regions outside the US, Europe and Canada are not covered, so empty space here does not mean calm weather.",
  },
  country: {
    what: "Click a country to see a risk and macro profile: economic indicators, inflation, human development, US sanctions footprint and the US State Department travel advisory.",
    source: "World Bank, CPI, UNDP HDI, OFAC sanctions list, US State Department.",
    updates: "Cached for up to a day on the server; the underlying statistics themselves update monthly or annually.",
    markets: "A quick way to judge macro and political backdrop for a country you trade or hold exposure to. These are slow-moving indicators and advisories, not forecasts.",
  },
  ais: {
    what: "Positions of ships broadcasting AIS in the part of the world you are viewing.",
    source: "AISStream community feed.",
    updates: "Live while the feed is connected; shows nothing when it is not.",
    markets: "Concentrations of tankers or bulk carriers near chokepoints and ports can add context for oil, gas and freight. Coverage depends on receivers, so some areas show few ships, and ships that switch off AIS do not appear.",
  },
  gpsjam: {
    what: "Areas where aircraft report degraded GPS, a possible sign of jamming or interference.",
    source: "GPSJam.org (derived from aircraft ADS-B data).",
    updates: "Daily; the date is shown and old data is not drawn.",
    markets: "Interference is mostly relevant for aviation and shipping risk and as a geopolitical indicator. It is inferred from aircraft data, so it shows where aircraft fly, and it is a weak market signal on its own.",
  },
};
