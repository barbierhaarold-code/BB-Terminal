// Nuclear power plants worldwide — a static, curated list of the world's
// major nuclear facilities. Sourced from public data published by the
// International Atomic Energy Agency's Power Reactor Information System
// (IAEA PRIS, https://pris.iaea.org/) and the World Nuclear Association
// (https://world-nuclear.org/). Coordinates are each facility's publicly
// documented location. Status reflects the most recent publicly available
// information from these sources.

export type NuclearStatus = "Operational" | "Under Construction" | "Decommissioned" | "Suspended";

export interface NuclearFacility {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  status: NuclearStatus;
  reactors: number;
  capacityMW: number;
  description: string;
}

export const NUCLEAR_STATUS_COLOR: Record<NuclearStatus, string> = {
  Operational: "#22c55e",
  "Under Construction": "#eab308",
  Decommissioned: "#6e6e6e",
  Suspended: "#ef4444",
};

export const NUCLEAR_FACILITIES: NuclearFacility[] = [
  // --- France ---
  {
    id: "gravelines",
    name: "Gravelines",
    country: "France",
    lat: 50.9917,
    lon: 2.1056,
    status: "Operational",
    reactors: 6,
    capacityMW: 5460,
    description: "Largest nuclear power station in Western Europe by reactor count.",
  },
  {
    id: "cattenom",
    name: "Cattenom",
    country: "France",
    lat: 49.4067,
    lon: 6.2178,
    status: "Operational",
    reactors: 4,
    capacityMW: 5200,
    description: "Four 1300 MW PWR units near the Luxembourg border.",
  },
  {
    id: "flamanville",
    name: "Flamanville",
    country: "France",
    lat: 49.5375,
    lon: -1.8814,
    status: "Operational",
    reactors: 3,
    capacityMW: 2660,
    description: "Includes the EPR unit 3, France's first European Pressurized Reactor.",
  },
  // --- United States ---
  {
    id: "palo-verde",
    name: "Palo Verde",
    country: "United States",
    lat: 33.3886,
    lon: -112.8617,
    status: "Operational",
    reactors: 3,
    capacityMW: 3937,
    description: "Largest nuclear generating facility in the US by net capacity.",
  },
  {
    id: "vogtle",
    name: "Vogtle",
    country: "United States",
    lat: 33.1414,
    lon: -81.7631,
    status: "Operational",
    reactors: 4,
    capacityMW: 4540,
    description: "Largest nuclear plant in the US — Units 3 and 4 are AP1000 reactors completed in 2023–2024.",
  },
  {
    id: "south-texas",
    name: "South Texas Project",
    country: "United States",
    lat: 28.7950,
    lon: -96.0489,
    status: "Operational",
    reactors: 2,
    capacityMW: 2708,
    description: "Two large PWR units in Matagorda County, Texas.",
  },
  {
    id: "diablo-canyon",
    name: "Diablo Canyon",
    country: "United States",
    lat: 35.2119,
    lon: -120.8544,
    status: "Operational",
    reactors: 2,
    capacityMW: 2256,
    description: "California's last operating nuclear plant — license extended to continue operations.",
  },
  // --- China ---
  {
    id: "yangjiang",
    name: "Yangjiang",
    country: "China",
    lat: 21.7097,
    lon: 112.2564,
    status: "Operational",
    reactors: 6,
    capacityMW: 6516,
    description: "Six CPR-1000+ and ACPR-1000 reactors in Guangdong province.",
  },
  {
    id: "tianwan",
    name: "Tianwan",
    country: "China",
    lat: 34.6869,
    lon: 119.4608,
    status: "Operational",
    reactors: 8,
    capacityMW: 8060,
    description: "China's largest nuclear power station by reactor count — Russian VVER-1000 and Chinese CNP-1000 designs.",
  },
  {
    id: "taishan",
    name: "Taishan",
    country: "China",
    lat: 21.9122,
    lon: 112.9800,
    status: "Operational",
    reactors: 2,
    capacityMW: 3380,
    description: "World's first EPR reactors to enter commercial operation (2018–2019).",
  },
  {
    id: "hualong-fuqing",
    name: "Fuqing",
    country: "China",
    lat: 25.4417,
    lon: 119.4533,
    status: "Operational",
    reactors: 6,
    capacityMW: 6570,
    description: "Includes China's first Hualong One (HPR1000) demonstration units.",
  },
  // --- Russia ---
  {
    id: "leningrad",
    name: "Leningrad NPP / Leningrad II",
    country: "Russia",
    lat: 59.8333,
    lon: 29.0500,
    status: "Operational",
    reactors: 4,
    capacityMW: 4400,
    description: "Two VVER-1200 units (Leningrad II) replacing older RBMK units near St. Petersburg.",
  },
  {
    id: "novovoronezh",
    name: "Novovoronezh NPP / Novovoronezh II",
    country: "Russia",
    lat: 51.2722,
    lon: 39.2139,
    status: "Operational",
    reactors: 3,
    capacityMW: 3400,
    description: "Site of Russia's first VVER-1200 (Generation III+) reactor.",
  },
  // --- Japan ---
  {
    id: "kashiwazaki-kariwa",
    name: "Kashiwazaki-Kariwa",
    country: "Japan",
    lat: 37.4264,
    lon: 138.5981,
    status: "Suspended",
    reactors: 7,
    capacityMW: 8212,
    description: "World's largest nuclear plant by capacity — all units shut since 2012, restart approvals pending.",
  },
  {
    id: "fukushima-daiichi",
    name: "Fukushima Daiichi",
    country: "Japan",
    lat: 37.4211,
    lon: 141.0328,
    status: "Decommissioned",
    reactors: 6,
    capacityMW: 0,
    description: "Site of the 2011 nuclear disaster — all six units permanently shut, decommissioning underway.",
  },
  // --- South Korea ---
  {
    id: "kori-shin-kori",
    name: "Kori / Shin-Kori",
    country: "South Korea",
    lat: 35.3197,
    lon: 129.2847,
    status: "Operational",
    reactors: 7,
    capacityMW: 7411,
    description: "South Korea's largest nuclear complex including APR-1400 reactors.",
  },
  // --- India ---
  {
    id: "kudankulam",
    name: "Kudankulam",
    country: "India",
    lat: 8.1681,
    lon: 77.7103,
    status: "Operational",
    reactors: 2,
    capacityMW: 2000,
    description: "India's largest nuclear plant — Russian-designed VVER-1000 reactors, with additional units under construction.",
  },
  // --- UK ---
  {
    id: "hinkley-point-c",
    name: "Hinkley Point C",
    country: "United Kingdom",
    lat: 51.2075,
    lon: -3.1306,
    status: "Under Construction",
    reactors: 2,
    capacityMW: 3260,
    description: "UK's first new nuclear plant in a generation — two EPR reactors.",
  },
  {
    id: "sizewell",
    name: "Sizewell B",
    country: "United Kingdom",
    lat: 52.2153,
    lon: 1.6194,
    status: "Operational",
    reactors: 1,
    capacityMW: 1198,
    description: "UK's only operating PWR. Sizewell C (two EPRs) approved nearby.",
  },
  // --- Ukraine ---
  {
    id: "zaporizhzhia",
    name: "Zaporizhzhia NPP",
    country: "Ukraine",
    lat: 47.5069,
    lon: 34.5853,
    status: "Suspended",
    reactors: 6,
    capacityMW: 5700,
    description: "Europe's largest nuclear plant — all six VVER-1000 reactors in cold shutdown since the conflict began in 2022.",
  },
  // --- Finland ---
  {
    id: "olkiluoto",
    name: "Olkiluoto",
    country: "Finland",
    lat: 61.2353,
    lon: 21.4472,
    status: "Operational",
    reactors: 3,
    capacityMW: 4180,
    description: "Includes Olkiluoto 3, Europe's largest reactor (EPR, ~1600 MW), operational since 2023.",
  },
  // --- UAE ---
  {
    id: "barakah",
    name: "Barakah",
    country: "United Arab Emirates",
    lat: 23.9583,
    lon: 52.1886,
    status: "Operational",
    reactors: 4,
    capacityMW: 5600,
    description: "Arab world's first nuclear power station — four South Korean APR-1400 reactors.",
  },
  // --- Egypt ---
  {
    id: "el-dabaa",
    name: "El Dabaa",
    country: "Egypt",
    lat: 31.0400,
    lon: 28.5100,
    status: "Under Construction",
    reactors: 4,
    capacityMW: 4800,
    description: "Egypt's first nuclear power plant — four Russian VVER-1200 reactors.",
  },
  // --- Turkey ---
  {
    id: "akkuyu",
    name: "Akkuyu",
    country: "Turkey",
    lat: 36.1478,
    lon: 33.5322,
    status: "Under Construction",
    reactors: 4,
    capacityMW: 4800,
    description: "Turkey's first nuclear power plant — four Russian VVER-1200 reactors, built under a BOO model.",
  },
  // --- Canada ---
  {
    id: "bruce",
    name: "Bruce Nuclear Generating Station",
    country: "Canada",
    lat: 44.3256,
    lon: -81.5972,
    status: "Operational",
    reactors: 8,
    capacityMW: 6384,
    description: "World's largest operating nuclear station by reactor count — eight CANDU reactors in Ontario.",
  },
  // --- Bangladesh ---
  {
    id: "rooppur",
    name: "Rooppur",
    country: "Bangladesh",
    lat: 24.0650,
    lon: 89.0483,
    status: "Under Construction",
    reactors: 2,
    capacityMW: 2400,
    description: "Bangladesh's first nuclear power plant — two Russian VVER-1200 reactors.",
  },
  // --- Chernobyl (historical) ---
  {
    id: "chernobyl",
    name: "Chernobyl NPP",
    country: "Ukraine",
    lat: 51.3894,
    lon: 30.0989,
    status: "Decommissioned",
    reactors: 4,
    capacityMW: 0,
    description: "Site of the 1986 nuclear disaster — all units permanently shut, New Safe Confinement installed over Reactor 4 in 2016.",
  },
];
