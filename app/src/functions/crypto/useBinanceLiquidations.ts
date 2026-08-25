import { useEffect, useState } from "react";

export interface LiquidationEvent {
  symbol: string;
  side: "BUY" | "SELL"; // side of the liquidation order itself — SELL liquidation = a long got force-closed
  price: number;
  qty: number;
  notional: number;
  time: number;
  id: string;
}

interface ForceOrderMsg {
  o: { s: string; S: "BUY" | "SELL"; p: string; q: string; ap: string; T: number };
}

const MAX_BUFFERED = 300;
const RECONNECT_DELAY_MS = 4000;

export type WsStatus = "connecting" | "open" | "closed";

/**
 * Binance Futures' public "All Market Liquidation Order" stream — free, no
 * auth, market-wide (not per-account). This is a live-only feed: Binance
 * doesn't expose a REST history endpoint for liquidations, only this
 * websocket, so nothing shows here until an event actually fires after the
 * tab connects (surfaced in the UI, not hidden).
 */
export function useBinanceLiquidations() {
  const [events, setEvents] = useState<LiquidationEvent[]>([]);
  const [status, setStatus] = useState<WsStatus>("connecting");

  useEffect(() => {
    let closedByUs = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      setStatus("connecting");
      ws = new WebSocket("wss://fstream.binance.com/ws/!forceOrder@arr");

      ws.onopen = () => setStatus("open");

      ws.onmessage = (ev) => {
        let msg: ForceOrderMsg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        const o = msg.o;
        if (!o) return;
        const price = Number(o.ap || o.p);
        const qty = Number(o.q);
        const event: LiquidationEvent = {
          symbol: o.s, side: o.S, price, qty, notional: price * qty, time: o.T,
          id: `${o.s}-${o.T}-${o.q}`,
        };
        setEvents((prev) => [event, ...prev].slice(0, MAX_BUFFERED));
      };

      ws.onclose = () => {
        setStatus("closed");
        if (!closedByUs) reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    return () => {
      closedByUs = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, []);

  return { events, status };
}
