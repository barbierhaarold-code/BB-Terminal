import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchOptions, type OptionsRow } from "@/lib/api";

export function useOptionsChain(symbol: string) {
  const { data = [], isLoading, error } = useQuery({
    queryKey: ["options", symbol], queryFn: () => fetchOptions(symbol), staleTime: 60_000,
  });

  const expirations = useMemo(
    () => Array.from(new Set(data.map((o) => o.expiration))).sort(),
    [data]
  );
  const underlying = data[0]?.underlying_price;

  return { data, isLoading, error, expirations, underlying } as {
    data: OptionsRow[]; isLoading: boolean; error: unknown;
    expirations: string[]; underlying: number | undefined;
  };
}
