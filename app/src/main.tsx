import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "@/components/auth/AuthGate";
import { installProxyAuth } from "@/lib/proxyAuth";
import "./index.css";

// Attach the Supabase token to every call to the server-side proxies (one place; see lib/proxyAuth.ts).
installProxyAuth();

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <AuthGate />
    </QueryClientProvider>
  </React.StrictMode>
);
