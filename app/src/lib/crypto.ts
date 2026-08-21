export interface Coin {
  sym: string;
  name: string;
}

/** Tracked coins — shared by the CRYPTO board and the global symbol search. */
export const COINS: Coin[] = [
  { sym: "BTC-USD", name: "Bitcoin" },
  { sym: "ETH-USD", name: "Ethereum" },
  { sym: "SOL-USD", name: "Solana" },
  { sym: "BNB-USD", name: "BNB" },
  { sym: "XRP-USD", name: "XRP" },
  { sym: "ADA-USD", name: "Cardano" },
  { sym: "DOGE-USD", name: "Dogecoin" },
  { sym: "AVAX-USD", name: "Avalanche" },
  { sym: "LINK-USD", name: "Chainlink" },
  { sym: "LTC-USD", name: "Litecoin" },
  { sym: "MATIC-USD", name: "Polygon" },
  { sym: "DOT-USD", name: "Polkadot" },
];
