import { useQuery } from "@tanstack/react-query";
import { fetchTreasuryRates } from "@/lib/api";
import { DEFAULT_RISK_FREE_RATE } from "@/lib/greeks";

/** 3-month T-bill rate as the risk-free proxy for Black-Scholes, decimal (e.g. 0.045). */
export function useRiskFreeRate(): number {
  const { data } = useQuery({
    queryKey: ["treasury-rf"],
    queryFn: () => fetchTreasuryRates(30),
    staleTime: 3_600_000,
  });
  // The API returns rates as decimals (0.0422 = 4.22%) — NOT percent — so no /100.
  // Pick the newest row by date rather than trusting array order.
  const latest = data?.length ? [...data].sort((a, b) => (a.date > b.date ? 1 : -1))[data.length - 1] : undefined;
  const r = latest?.month_3;
  return r != null && r > 0 && r < 0.25 ? r : DEFAULT_RISK_FREE_RATE;
}
