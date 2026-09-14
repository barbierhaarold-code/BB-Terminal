// Maritime chokepoints — a static, curated list of the world's major
// strategic oil-transit waterways. Flow figures and shares are taken
// directly from the U.S. Energy Information Administration's dedicated
// "World Oil Transit Chokepoints" report (last updated March 3, 2026;
// figures below are its 1H25 / most-recent-period numbers — never
// estimated in this codebase):
// https://www.eia.gov/international/content/analysis/special_topics/World_Oil_Transit_Chokepoints
// Coordinates are each waterway's approximate navigational midpoint —
// ordinary geographic fact, not a statistic, so it isn't separately cited.

export interface Chokepoint {
  id: string;
  name: string;
  lat: number;
  lon: number;
  description: string;
  oilFlow: string;
  shareOfTrade: string;
  source: string;
}

export const CHOKEPOINTS: Chokepoint[] = [
  {
    id: "hormuz",
    name: "Strait of Hormuz",
    lat: 26.57,
    lon: 56.25,
    description: "Connects the Persian Gulf to the Gulf of Oman and the Arabian Sea — the only sea route out of the Gulf for Saudi, Iraqi, Iranian, UAE, Kuwaiti, and Qatari crude and LNG.",
    oilFlow: "20.9 million b/d (1H 2025)",
    shareOfTrade: "~20% of global petroleum liquids consumption; ~1/4 of total global maritime traded oil",
    source: "EIA, World Oil Transit Chokepoints (updated Mar 3, 2026)",
  },
  {
    id: "malacca",
    name: "Strait of Malacca",
    lat: 2.8,
    lon: 100.9,
    description: "Between Malaysia and Sumatra — the shortest sea route linking the Persian Gulf/Indian Ocean to China, Japan, and South Korea. The world's largest chokepoint by oil-transit volume.",
    oilFlow: "23.2 million b/d (1H 2025)",
    shareOfTrade: "~29% of total maritime oil flows",
    source: "EIA, World Oil Transit Chokepoints (updated Mar 3, 2026)",
  },
  {
    id: "suez",
    name: "Suez Canal / SUMED Pipeline",
    lat: 30.5,
    lon: 32.35,
    description: "Links the Red Sea to the Mediterranean, avoiding the Cape of Good Hope route. The SUMED pipeline is the parallel overland alternative for crude that can't fit the canal's draft.",
    oilFlow: "4.9 million b/d (1H 2025)",
    shareOfTrade: "~6% of total seaborne-traded oil",
    source: "EIA, World Oil Transit Chokepoints (updated Mar 3, 2026)",
  },
  {
    id: "bab-el-mandeb",
    name: "Bab-el-Mandeb Strait",
    lat: 12.58,
    lon: 43.33,
    description: "Between Yemen, Djibouti, and Eritrea — connects the Red Sea to the Gulf of Aden and the Arabian Sea, the southern approach to the Suez Canal.",
    oilFlow: "4.2 million b/d (1H 2025)",
    shareOfTrade: "Southern gateway to the Suez Canal route",
    source: "EIA, World Oil Transit Chokepoints (updated Mar 3, 2026)",
  },
  {
    id: "turkish-straits",
    name: "Turkish Straits (Bosporus & Dardanelles)",
    lat: 41.12,
    lon: 29.06,
    description: "The only sea outlet for Russian and other Black Sea/Caspian-region crude and products to reach world markets, splitting Istanbul in two.",
    oilFlow: "3.7 million b/d (1H 2025)",
    shareOfTrade: "~5% of global maritime trade",
    source: "EIA, World Oil Transit Chokepoints (updated Mar 3, 2026)",
  },
  {
    id: "danish-straits",
    name: "Danish Straits",
    lat: 55.3,
    lon: 11.0,
    description: "The Great Belt, Little Belt and Öresund — the exit from the Baltic Sea to the North Sea, carrying Russian and Baltic-state crude and refined products.",
    oilFlow: "4.9 million b/d (1H 2025)",
    shareOfTrade: "~6% of global maritime trade",
    source: "EIA, World Oil Transit Chokepoints (updated Mar 3, 2026)",
  },
  {
    id: "panama",
    name: "Panama Canal",
    lat: 9.08,
    lon: -79.68,
    description: "Connects the Atlantic and Pacific, cutting weeks off the alternative route around South America — used mostly for LPG and refined products, less so crude.",
    oilFlow: "2.3 million b/d (FY2025, Oct 2024–Sep 2025)",
    shareOfTrade: "~3% of total global maritime petroleum flows",
    source: "EIA, World Oil Transit Chokepoints (updated Mar 3, 2026)",
  },
];
