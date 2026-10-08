import { QueryClient } from "@tanstack/react-query";

/** The app's one QueryClient. Exported (not just created in main.tsx) so non-React code, such as the Copilot tools, can share the same cache as the panels. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
