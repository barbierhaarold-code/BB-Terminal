import { useState } from "react";
import { useJournal } from "@/store/journalStore";
import { cn } from "@/lib/cn";

export function SetupsManager() {
  const { setups, trades, addSetup, renameSetup, deleteSetup } = useJournal();
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const countBySetup = new Map<string, number>();
  for (const t of trades) if (t.setupId) countBySetup.set(t.setupId, (countBySetup.get(t.setupId) ?? 0) + 1);

  function create() {
    const name = newName.trim();
    if (!name) return;
    addSetup(name);
    setNewName("");
  }

  function startRename(id: string, current: string) {
    setRenamingId(id);
    setRenameValue(current);
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) renameSetup(renamingId, renameValue);
    setRenamingId(null);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <span>SETUPS</span>
        <span className="sub-header normal-case tracking-normal font-normal">{setups.length} defined</span>
      </div>
      <div className="p-2 flex flex-col gap-1">
        {setups.length === 0 && <div className="text-term-muted text-[11px] px-1 py-1">No setups yet — add one below.</div>}
        {setups.map((s) => (
          <div key={s.id} className="flex items-center gap-2 px-1.5 py-1 hover:bg-term-panel2 text-[11px]">
            {renamingId === s.id ? (
              <input
                autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commitRename()}
                onBlur={commitRename}
                className="flex-1 min-w-0 bg-term-panel border border-term-amber px-1.5 py-0.5 text-term-text focus:outline-none"
              />
            ) : (
              <span className="flex-1 text-term-text cursor-pointer" onClick={() => startRename(s.id, s.name)}>{s.name}</span>
            )}
            <span className="num text-term-muted">{countBySetup.get(s.id) ?? 0}</span>
            <button onClick={() => startRename(s.id, s.name)} className="text-term-muted hover:text-term-amber">rename</button>
            <button
              onClick={() => { if (confirm(`Delete setup "${s.name}"? Trades using it become unassigned.`)) deleteSetup(s.id); }}
              className="text-term-muted hover:text-term-red">delete</button>
          </div>
        ))}
        <div className="flex gap-1 mt-1 pt-2 border-t border-term-borderSoft">
          <input
            value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="New setup…"
            className={cn("flex-1 min-w-0 bg-term-panel border border-term-border px-1.5 py-0.5 text-term-text placeholder:text-term-muted focus:outline-none focus:border-term-amber text-[11px]")}
          />
          <button onClick={create} className="px-2 border border-term-amber text-term-amber text-[11px]">+ Add</button>
        </div>
      </div>
    </div>
  );
}
