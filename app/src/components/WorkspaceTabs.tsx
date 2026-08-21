import { X } from "lucide-react";
import { useWorkspace } from "@/store/workspaceStore";
import { FN_BY_CODE } from "@/lib/functions";
import { cn } from "@/lib/cn";

export function WorkspaceTabs() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useWorkspace();

  return (
    <div className="flex h-7 bg-term-bg2 border-b border-term-border overflow-x-auto scroll-thin">
      {tabs.map((t) => {
        const isActive = t.id === activeTabId;
        const name = FN_BY_CODE[t.code]?.name ?? t.code;
        const label = t.symbol ? `${t.symbol} · ${name}` : name;
        return (
          <div
            key={t.id}
            title={t.code}
            onClick={() => setActiveTab(t.id)}
            className={cn(
              "flex items-center gap-2 h-full px-3 cursor-pointer border-r border-term-border text-[11px] tracking-wider uppercase whitespace-nowrap",
              isActive
                ? "bg-term-panel text-term-amber border-t-2 border-t-term-amber"
                : "text-term-muted hover:text-term-text hover:bg-term-panel/40"
            )}
          >
            <span className="font-semibold">{label}</span>
            {tabs.length > 1 && (
              <X
                size={11}
                className="opacity-40 hover:opacity-100 hover:text-term-red"
                onClick={(e) => { e.stopPropagation(); closeTab(t.id); }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
