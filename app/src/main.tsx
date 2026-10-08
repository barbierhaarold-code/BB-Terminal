import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { AuthGate } from "@/components/auth/AuthGate";
import { installProxyAuth } from "@/lib/proxyAuth";
import { queryClient as qc } from "@/lib/queryClient";
import "./index.css";

// Attach the Supabase token to every call to the server-side proxies (one place; see lib/proxyAuth.ts).
installProxyAuth();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <AuthGate />
    </QueryClientProvider>
  </React.StrictMode>
);
