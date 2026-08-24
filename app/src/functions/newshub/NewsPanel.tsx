import { fetchGeneralNews, fetchStocksNews, fetchCryptoNews, fetchForexNews } from "@/lib/api";
import { NewsCategoryPanel } from "./NewsCategoryPanel";

export function NewsPanel() {
  return (
    <div className="h-full grid grid-cols-2 grid-rows-2 gap-1 p-1">
      <NewsCategoryPanel label="General" sourceNote="yfinance · major index ETFs" queryKey="general" fetcher={fetchGeneralNews} />
      <NewsCategoryPanel label="Stocks" sourceNote="yfinance · top mega-caps" queryKey="stocks" fetcher={fetchStocksNews} />
      <NewsCategoryPanel label="Crypto" sourceNote="yfinance · top coins" queryKey="crypto" fetcher={fetchCryptoNews} />
      <NewsCategoryPanel label="Forex" sourceNote="yfinance · FX / metals / USD" queryKey="forex" fetcher={fetchForexNews} />
    </div>
  );
}
