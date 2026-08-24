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
  const last = data?.[data.length - 1]?.month_3;
  return last != null ? last / 100 : DEFAULT_RISK_FREE_RATE;
}
