// Optimistic write queue + visible save status, shared by the journal and plan
// stores in server mode. One queue, strictly in order, so "add plan" is always
// sent before the "update plan" that follows it. A failed write is NEVER
// silent: it and everything queued behind it is rolled back in memory and a
// banner (SaveStatusBanner) shows the reason with Retry.
import { create } from "zustand";
import type { UserDataAdapter } from "./adapter";
import { getAdapter } from "./runtime";

export interface WriteOp {
  label: string;
  /** optimistic change to the in-memory store */
  apply(): void;
  /** exact inverse of apply */
  undo(): void;
  remote(a: UserDataAdapter): Promise<void>;
}

export interface SaveError {
  message: string;
  /** rolled-back operations that Retry re-applies, in their original order (empty = nothing to retry) */
  ops: WriteOp[];
}

interface SyncState {
  pending: number;
  saveError: SaveError | null;
  offline: boolean;
}

export const useSync = create<SyncState>(() => ({ pending: 0, saveError: null, offline: false }));

let queue: WriteOp[] = [];
let running = false;
let epoch = 0;

const setPending = () => useSync.setState({ pending: queue.length });

/** Queue a write. Returns false (nothing applied) when it was refused. */
export function submitWrite(op: WriteOp): boolean {
  if (useSync.getState().offline) {
    useSync.setState({ saveError: { message: "You are offline — Track Record and Plans are read-only until the connection is back. This change was not saved.", ops: [] } });
    return false;
  }
  op.apply();
  queue.push(op);
  setPending();
  void pump();
  return true;
}

/** Refuse a write with a visible message (e.g. data not loaded yet). */
export function refuseWrite(message: string): void {
  useSync.setState({ saveError: { message, ops: [] } });
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  const mine = epoch;
  try {
    while (queue.length > 0 && mine === epoch) {
      const op = queue[0];
      try {
        await op.remote(getAdapter());
      } catch (e) {
        if (mine === epoch) rollbackAll(e);
        return;
      }
      if (mine !== epoch) return;
      queue.shift();
      setPending();
    }
  } finally {
    if (mine === epoch) running = false;
  }
}

function rollbackAll(e: unknown): void {
  const failed = queue;
  queue = [];
  for (let i = failed.length - 1; i >= 0; i--) {
    try { failed[i].undo(); } catch { /* the inverse is plain state surgery; never mask the real error */ }
  }
  const raw = e instanceof Error ? e.message : String(e);
  const hint = /jwt|token|401/i.test(raw) ? " Your session may have expired — sign in again." : "";
  const more = failed.length > 1 ? ` ${failed.length} changes were rolled back.` : " The change was rolled back.";
  useSync.setState({ pending: 0, saveError: { message: `${failed[0].label} failed: ${raw}.${more}${hint}`, ops: failed } });
}

export function retrySave(): void {
  const err = useSync.getState().saveError;
  if (!err) return;
  useSync.setState({ saveError: null });
  for (const op of err.ops) if (!submitWrite(op)) break;
}

export function dismissSaveError(): void { useSync.setState({ saveError: null }); }

/** Drop everything pending (user switched/signed out). In-flight results are ignored. */
export function resetSync(): void {
  epoch++;
  running = false;
  queue = [];
  useSync.setState({ pending: 0, saveError: null });
}

export function setOffline(offline: boolean): void { useSync.setState({ offline }); }
