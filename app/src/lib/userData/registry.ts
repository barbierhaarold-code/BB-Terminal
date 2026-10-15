// Lets the session layer reset/load every user-data store without importing
// them (stores import this, so there is no import cycle). A store that registers
// late is brought up to date by replaying the last event.
import type { UserDataSnapshot } from "./adapter";

export interface UserDataStoreHooks {
  /** empty everything in memory, status "idle", no owner */
  reset(): void;
  loading(userId: string): void;
  loaded(userId: string, snap: UserDataSnapshot): void;
  failed(userId: string, message: string): void;
}

const hooks = new Set<UserDataStoreHooks>();
let replay: ((h: UserDataStoreHooks) => void) | null = null;

export function registerUserDataStore(h: UserDataStoreHooks): void {
  hooks.add(h);
  replay?.(h);
}

export function broadcast(fn: (h: UserDataStoreHooks) => void): void {
  replay = fn;
  hooks.forEach(fn);
}
