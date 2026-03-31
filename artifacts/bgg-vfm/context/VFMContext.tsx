import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

export type ListingStatus = "listed" | "sold" | "expired" | "withdrawn";
export type TransactionType = "sale" | "purchase";

export interface Game {
  id: string;
  title: string;
  price: number;
  status: ListingStatus;
  type: TransactionType;
  buyerSeller?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface VFMContextValue {
  games: Game[];
  addGame: (game: Omit<Game, "id" | "createdAt" | "updatedAt">) => void;
  updateGame: (id: string, updates: Partial<Omit<Game, "id" | "createdAt">>) => void;
  deleteGame: (id: string) => void;
  stats: {
    listedCount: number;
    soldCount: number;
    purchasedCount: number;
    amountOwed: number;
    amountEarned: number;
  };
}

const VFMContext = createContext<VFMContextValue | null>(null);

const STORAGE_KEY = "bgg_vfm_games_v1";

export function VFMProvider({ children }: { children: React.ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (raw) {
        try {
          setGames(JSON.parse(raw));
        } catch {}
      }
    });
  }, []);

  const persist = useCallback((updated: Game[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const addGame = useCallback(
    (game: Omit<Game, "id" | "createdAt" | "updatedAt">) => {
      const now = new Date().toISOString();
      const newGame: Game = {
        ...game,
        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
        createdAt: now,
        updatedAt: now,
      };
      setGames((prev) => {
        const updated = [newGame, ...prev];
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const updateGame = useCallback(
    (id: string, updates: Partial<Omit<Game, "id" | "createdAt">>) => {
      setGames((prev) => {
        const updated = prev.map((g) =>
          g.id === id ? { ...g, ...updates, updatedAt: new Date().toISOString() } : g
        );
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const deleteGame = useCallback(
    (id: string) => {
      setGames((prev) => {
        const updated = prev.filter((g) => g.id !== id);
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const stats = {
    listedCount: games.filter(
      (g) => g.type === "sale" && g.status === "listed"
    ).length,
    soldCount: games.filter(
      (g) => g.type === "sale" && g.status === "sold"
    ).length,
    purchasedCount: games.filter((g) => g.type === "purchase").length,
    amountOwed: games
      .filter((g) => g.type === "purchase")
      .reduce((sum, g) => sum + g.price, 0),
    amountEarned: games
      .filter((g) => g.type === "sale" && g.status === "sold")
      .reduce((sum, g) => sum + g.price, 0),
  };

  return (
    <VFMContext.Provider value={{ games, addGame, updateGame, deleteGame, stats }}>
      {children}
    </VFMContext.Provider>
  );
}

export function useVFM() {
  const ctx = useContext(VFMContext);
  if (!ctx) throw new Error("useVFM must be used within VFMProvider");
  return ctx;
}
