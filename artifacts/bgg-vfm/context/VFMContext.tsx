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
export type GameSource = "manual" | "bgg";

export interface Game {
  id: string;
  title: string;
  price: number;
  status: ListingStatus;
  type: TransactionType;
  buyerSeller?: string;
  condition?: string;
  notes?: string;
  source: GameSource;
  createdAt: string;
  updatedAt: string;
}

export interface BggSettings {
  geeklistUrl: string;
  username: string;
  apiToken: string;
  realName: string;
}

interface VFMContextValue {
  games: Game[];
  addGame: (game: Omit<Game, "id" | "createdAt" | "updatedAt" | "source">) => void;
  updateGame: (id: string, updates: Partial<Omit<Game, "id" | "createdAt">>) => void;
  deleteGame: (id: string) => void;
  replaceBggGames: (newGames: Omit<Game, "createdAt" | "updatedAt">[]) => void;
  stats: {
    listedCount: number;
    soldCount: number;
    purchasedCount: number;
    amountOwed: number;
    amountEarned: number;
  };
  bggSettings: BggSettings;
  saveBggSettings: (s: BggSettings) => void;
  lastSyncedAt: string | null;
  setLastSyncedAt: (v: string | null) => void;
}

const VFMContext = createContext<VFMContextValue | null>(null);

const STORAGE_KEY = "bgg_vfm_games_v2";
const SETTINGS_KEY = "bgg_vfm_settings_v1";
const SYNC_KEY = "bgg_vfm_last_synced";

const DEFAULT_SETTINGS: BggSettings = {
  geeklistUrl: "",
  username: "",
  apiToken: "",
  realName: "",
};

export function VFMProvider({ children }: { children: React.ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);
  const [bggSettings, setBggSettings] = useState<BggSettings>(DEFAULT_SETTINGS);
  const [lastSyncedAt, setLastSyncedAtState] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(STORAGE_KEY),
      AsyncStorage.getItem(SETTINGS_KEY),
      AsyncStorage.getItem(SYNC_KEY),
    ]).then(([rawGames, rawSettings, rawSync]) => {
      if (rawGames) {
        try { setGames(JSON.parse(rawGames)); } catch {}
      }
      if (rawSettings) {
        try { setBggSettings(JSON.parse(rawSettings)); } catch {}
      }
      if (rawSync) {
        setLastSyncedAtState(rawSync);
      }
    });
  }, []);

  const persist = useCallback((updated: Game[]) => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  const addGame = useCallback(
    (game: Omit<Game, "id" | "createdAt" | "updatedAt" | "source">) => {
      const now = new Date().toISOString();
      const newGame: Game = {
        ...game,
        source: "manual",
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
          g.id === id
            ? { ...g, ...updates, updatedAt: new Date().toISOString() }
            : g
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

  const replaceBggGames = useCallback(
    (newGames: Omit<Game, "createdAt" | "updatedAt">[]) => {
      const now = new Date().toISOString();
      setGames((prev) => {
        const manualGames = prev.filter((g) => g.source === "manual");
        const bggGames: Game[] = newGames.map((g) => ({
          ...g,
          createdAt: now,
          updatedAt: now,
        }));
        const updated = [...bggGames, ...manualGames];
        persist(updated);
        return updated;
      });
    },
    [persist]
  );

  const saveBggSettings = useCallback((s: BggSettings) => {
    setBggSettings(s);
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }, []);

  const setLastSyncedAt = useCallback((v: string | null) => {
    setLastSyncedAtState(v);
    if (v) AsyncStorage.setItem(SYNC_KEY, v);
    else AsyncStorage.removeItem(SYNC_KEY);
  }, []);

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
    <VFMContext.Provider
      value={{
        games,
        addGame,
        updateGame,
        deleteGame,
        replaceBggGames,
        stats,
        bggSettings,
        saveBggSettings,
        lastSyncedAt,
        setLastSyncedAt,
      }}
    >
      {children}
    </VFMContext.Provider>
  );
}

export function useVFM() {
  const ctx = useContext(VFMContext);
  if (!ctx) throw new Error("useVFM must be used within VFMProvider");
  return ctx;
}
