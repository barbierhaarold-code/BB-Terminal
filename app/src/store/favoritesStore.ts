import { create } from "zustand";
import { persist } from "zustand/middleware";

interface FavoritesState {
  favorites: string[];
  toggleFavorite: (symbol: string) => void;
  isFavorite: (symbol: string) => boolean;
}

/**
 * Persisted favorite tickers — mirrors the storage approach used by
 * `workspaceStore` (zustand + `persist`) so QCARD favorites survive reloads.
 */
export const useFavorites = create<FavoritesState>()(
  persist(
    (set, get) => ({
      favorites: [],
      toggleFavorite: (symbol) => {
        const s = symbol.toUpperCase();
        const { favorites } = get();
        set({
          favorites: favorites.includes(s)
            ? favorites.filter((f) => f !== s)
            : [...favorites, s],
        });
      },
      isFavorite: (symbol) => get().favorites.includes(symbol.toUpperCase()),
    }),
    { name: "bbterminal-favorites" }
  )
);
