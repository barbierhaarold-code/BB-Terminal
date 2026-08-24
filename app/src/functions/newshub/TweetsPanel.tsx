import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAccountTweets, isHighImpact } from "@/lib/getx";
import { useTweetsSettings } from "@/store/tweetsStore";
import { fmtTime } from "@/lib/format";
import { ExternalLink, RefreshCw, Settings, X } from "lucide-react";
import { cn } from "@/lib/cn";

type Filter = "all" | "high-impact";

export function TweetsPanel() {
  const [filter, setFilter] = useState<Filter>("all");
  const [showSettings, setShowSettings] = useState(false);
  const { accounts, keywords, pollMinutes, addAccount, removeAccount, addKeyword, removeKeyword, setPollMinutes } =
    useTweetsSettings();

  const { data = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["newshub-tweets", accounts],
    queryFn: () => fetchAccountTweets(accounts),
    refetchInterval: pollMinutes * 60_000,
    staleTime: pollMinutes * 60_000 - 5_000,
    enabled: accounts.length > 0,
    // A missing/invalid GetXAPI key is a permanent misconfiguration, not a
    // transient network blip — retrying it just delays the "key not
    // configured" message from reaching the user for no benefit.
    retry: false,
  });

  const filtered = useMemo(
    () => (filter === "high-impact" ? data.filter((t) => isHighImpact(t.text, keywords)) : data),
    [data, filter, keywords]
  );

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 h-8 px-3 border-b border-term-border bg-term-panel2 text-[11px] uppercase tracking-wider">
        {(["all", "high-impact"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-2 py-0.5 border",
              filter === f ? "border-term-amber text-term-amber" : "border-transparent text-term-muted hover:text-term-text"
            )}
          >
            {f === "all" ? "All" : "High-Impact"}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-1 text-term-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-term-green shadow-[0_0_6px_rgba(34,238,34,0.7)]" />
          poll {pollMinutes}m · {accounts.length} accounts
        </span>
        <button onClick={() => refetch()} title="Refresh" className="text-term-muted hover:text-term-amber">
          <RefreshCw size={12} className={cn(isFetching && "animate-spin")} />
        </button>
        <button
          onClick={() => setShowSettings((s) => !s)}
          title="Settings"
          className={cn("hover:text-term-amber", showSettings ? "text-term-amber" : "text-term-muted")}
        >
          <Settings size={12} />
        </button>
      </div>

      {showSettings && <TweetsSettingsPanel
        accounts={accounts} keywords={keywords} pollMinutes={pollMinutes}
        addAccount={addAccount} removeAccount={removeAccount}
        addKeyword={addKeyword} removeKeyword={removeKeyword} setPollMinutes={setPollMinutes}
      />}

      <div className="flex-1 min-h-0 overflow-auto scroll-thin divide-y divide-term-borderSoft text-[12px]">
        {isLoading && <div className="p-4 text-term-muted uppercase text-[11px] tracking-widest">Loading…</div>}
        {error && <div className="p-4 text-term-red">{(error as Error).message}</div>}
        {!isLoading && !error && filtered.map((t, i) => {
          const highImpact = isHighImpact(t.text, keywords);
          return (
            <a
              key={t.id + i}
              href={t.url}
              target="_blank"
              rel="noreferrer noopener"
              className="flex items-start gap-3 px-4 py-2 hover:bg-term-amberSubtle group"
            >
              <div className="num text-term-muted w-28 shrink-0">{fmtTime(t.date)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-term-amberBright font-bold">@{t.author}</span>
                  {highImpact && (
                    <span className="text-[9px] uppercase tracking-widest text-term-red border border-term-red/50 px-1">
                      High-Impact
                    </span>
                  )}
                </div>
                <div className="text-term-heading group-hover:text-term-amber leading-snug mt-0.5">{t.text}</div>
              </div>
              <ExternalLink size={12} className="text-term-muted group-hover:text-term-amber mt-1 shrink-0" />
            </a>
          );
        })}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="p-4 text-term-muted">
            {accounts.length === 0 ? "No accounts configured — add one in settings." : "No tweets."}
          </div>
        )}
      </div>
    </div>
  );
}

interface SettingsProps {
  accounts: string[];
  keywords: string[];
  pollMinutes: number;
  addAccount: (h: string) => void;
  removeAccount: (h: string) => void;
  addKeyword: (k: string) => void;
  removeKeyword: (k: string) => void;
  setPollMinutes: (m: number) => void;
}

function TweetsSettingsPanel({ accounts, keywords, pollMinutes, addAccount, removeAccount, addKeyword, removeKeyword, setPollMinutes }: SettingsProps) {
  const [newAccount, setNewAccount] = useState("");
  const [newKeyword, setNewKeyword] = useState("");

  return (
    <div className="border-b border-term-border bg-term-bg2 p-3 flex flex-col gap-3 text-[11px]">
      <div>
        <div className="sub-header mb-1">Tracked Accounts</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {accounts.map((a) => (
            <span key={a} className="flex items-center gap-1 border border-term-border px-1.5 py-0.5">
              @{a}
              <button onClick={() => removeAccount(a)} className="text-term-muted hover:text-term-red">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => { e.preventDefault(); addAccount(newAccount); setNewAccount(""); }}
        >
          <input
            value={newAccount}
            onChange={(e) => setNewAccount(e.target.value)}
            placeholder="handle (no @)"
            className="bg-term-panel border border-term-border px-2 py-1 flex-1 min-w-0 focus:outline-none focus:border-term-amber"
          />
          <button type="submit" className="border border-term-amberDim px-2 py-1 hover:bg-term-amberSubtle text-term-amber">Add</button>
        </form>
      </div>

      <div>
        <div className="sub-header mb-1">High-Impact Keywords</div>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {keywords.map((k) => (
            <span key={k} className="flex items-center gap-1 border border-term-border px-1.5 py-0.5">
              {k}
              <button onClick={() => removeKeyword(k)} className="text-term-muted hover:text-term-red">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => { e.preventDefault(); addKeyword(newKeyword); setNewKeyword(""); }}
        >
          <input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            placeholder="keyword"
            className="bg-term-panel border border-term-border px-2 py-1 flex-1 min-w-0 focus:outline-none focus:border-term-amber"
          />
          <button type="submit" className="border border-term-amberDim px-2 py-1 hover:bg-term-amberSubtle text-term-amber">Add</button>
        </form>
      </div>

      <div className="flex items-center gap-2">
        <span className="sub-header">Poll interval</span>
        <input
          type="number"
          min={1}
          value={pollMinutes}
          onChange={(e) => setPollMinutes(Number(e.target.value) || 1)}
          className="bg-term-panel border border-term-border px-2 py-1 w-16 num focus:outline-none focus:border-term-amber"
        />
        <span className="text-term-muted">minutes · ~${(accounts.length * (30 * 24 * 60 / pollMinutes) * 0.001).toFixed(2)}/mo est. (GetXAPI, $0.001/call)</span>
      </div>
    </div>
  );
}
