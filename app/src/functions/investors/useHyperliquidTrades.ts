import { useEffect, useRef, useState } from "react";

export interface HLTrade {
  coin: string; side: "B" | "A"; px: number; sz: number; notional: number;
  time: number; hash: string; tid: number; buyer: string; seller: string;
}

interface WsTradeMsg {
  coin: string; side: "B" | "A"; px: string; sz: string; time: number;
  hash: string; tid: number; users: [string, string];
}

// Trades below this notional are dropped at the socket before ever entering
// state — at 40+ subscribed coins, BTC/ETH alone print many small trades a
// second, and none of that is a "large/notable" whale print. Anything kept
// is a genuine >= $10k single fill, the UI's own threshold buttons just
// narrow further from there.
const MIN_CAPTURE_NOTIONAL = 10_000;
const MAX_BUFFERED = 200;
const RECONNECT_DELAY_MS = 4000;

export type WsStatus = "connecting" | "open" | "closed";

/**
 * Live large-trade feed via Hyperliquid's public `trades` websocket channel
 * — free, no auth, and (verified live) carries both counterparty wallet
 * addresses per fill, not just an anonymous print. One connection, one
 * `subscribe` message per coin.
 */
export function useHyperliquidTrades(coins: string[]) {
  const [trades, setTrades] = useState<HLTrade[]>([]);
  const [status, setStatus] = useState<WsStatus>("connecting");
  const coinsKey = coins.join(",");

  useEffect(() => {
    if (coins.length === 0) return;
    let closedByUs = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      setStatus("connecting");
      ws = new WebSocket("wss://api.hyperliquid.xyz/ws");

      ws.onopen = () => {
        setStatus("open");
        for (const coin of coins) {
          ws?.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin } }));
        }
      };

      ws.onmessage = (ev) => {
        let msg: { channel: string; data: unknown };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.channel !== "trades") return;
        const rows = msg.data as WsTradeMsg[];
        const notable = rows
          .map((r): HLTrade => ({
            coin: r.coin, side: r.side, px: Number(r.px), sz: Number(r.sz),
            notional: Number(r.px) * Number(r.sz), time: r.time, hash: r.hash,
            tid: r.tid, buyer: r.users[0], seller: r.users[1],
          }))
          .filter((t) => t.notional >= MIN_CAPTURE_NOTIONAL);
        if (notable.length === 0) return;
        setTrades((prev) => [...notable, ...prev].slice(0, MAX_BUFFERED));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coinsKey]);

  return { trades, status };
}
