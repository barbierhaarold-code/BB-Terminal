import type { Plugin } from "vite";
import { proxyAuthPlugin } from "./auth";
import { gdeltProxyPlugin } from "./gdelt";
import { weatherProxyPlugin } from "./weather";
import { countryIntelProxyPlugin } from "./countryIntel";
import { aisProxyPlugin } from "./ais";
import { gpsJamProxyPlugin } from "./gpsjam";
import { yahooNewsProxyPlugin } from "./yahooNews";
import { cotProxyPlugin } from "./cot";
import { macroProxyPlugin } from "./macro";
import { holdingsProxyPlugin } from "./holdings";
import { policyProxyPlugin } from "./policy";
import {
  apiCachePlugin, quantProxyPlugin, spotMetalsPlugin, getXApiProxyPlugin,
  predictionMarketsProxyPlugin, congressProxyPlugin, copilotProxyPlugin, firmsProxyPlugin, wpiProxyPlugin,
} from "./core";

/**
 * The ONE ordered list of server-side proxies, used by both the Vite dev/preview
 * server (vite.config.ts) and the production gateway (server/index.ts).
 * proxyAuthPlugin MUST stay first: it gates every route registered after it.
 */
export function proxyPlugins(env: Record<string, string | undefined>): Plugin[] {
  return [
    proxyAuthPlugin(env),
    apiCachePlugin(),
    cotProxyPlugin(env.CFTC_SOCRATA_APP_TOKEN, env.COT_ALLOW_SIMULATE === "1"),
    macroProxyPlugin(env.MACRO_ALLOW_SIMULATE === "1", undefined, env),
    holdingsProxyPlugin(env.SEC_CONTACT_EMAIL),
    policyProxyPlugin(),
    quantProxyPlugin(),
    spotMetalsPlugin(env.TWELVE_DATA_API_KEY),
    getXApiProxyPlugin(env.GETX_API_KEY),
    predictionMarketsProxyPlugin(),
    congressProxyPlugin(),
    copilotProxyPlugin(env.ANTHROPIC_API_KEY),
    firmsProxyPlugin(env.FIRMS_MAP_KEY),
    wpiProxyPlugin(),
    gdeltProxyPlugin(),
    weatherProxyPlugin(),
    countryIntelProxyPlugin(),
    aisProxyPlugin(env.AISSTREAM_API_KEY, env.AISSTREAM_WS_URL),
    gpsJamProxyPlugin(),
    yahooNewsProxyPlugin(),
  ];
}
