import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { getBaseUrl } from "@workspace/api-client-react";

export type ListingStatus = "listed" | "sold" | "expired" | "withdrawn";
export type TransactionType = "sale" | "purchase" | "auction";
export type AuctionStatus = "winning" | "outbid";
export type GameSource = "manual" | "bgg";

export interface Game {
  id: string;
  title: string;
  price: number;
  status: ListingStatus;
  type: TransactionType;
  auctionStatus?: AuctionStatus;
  myBid?: number;
  buyerSeller?: string;
  condition?: string;
  notes?: string;
  bggUrl?: string;
  source: GameSource;
  createdAt: string;
  updatedAt: string;
}

export interface BggSettings {
  geeklistUrl: string;
  username: string;
  realName: string;
}

export interface SyncResult {
  sales: number;
  purchases: number;
  auctionsWinning: number;
  auctionsOutbid: number;
  listTitle: string;
}

const DEFAULT_GEEKLIST_URL =
  "https://boardgamegeek.com/geeklist/375812/bgg-spring-2026-virtual-flea-market-vfm";

function extractListId(url: string): string | null {
  const m = url.match(/geeklist\/(\d+)/);
  return m ? m[1] : null;
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
    winningCount: number;
    outbidCount: number;
    amountOwed: number;
    amountEarned: number;
  };
  bggSettings: BggSettings;
  saveBggSettings: (s: BggSettings) => void;
  lastSyncedAt: string | null;
  setLastSyncedAt: (v: string | null) => void;
  syncFromBgg: (overrideSettings?: BggSettings) => Promise<SyncResult>;
  isSyncing: boolean;
}

const VFMContext = createContext<VFMContextValue | null>(null);

const STORAGE_KEY = "bgg_vfm_games_v2";
const SETTINGS_KEY = "bgg_vfm_settings_v1";
const SYNC_KEY = "bgg_vfm_last_synced";
const AUTO_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const AUTO_SYNC_POLL_MS = 60 * 1000;
const BGG_PROCESSING_MAX_ATTEMPTS = 8;
const BGG_PROCESSING_FALLBACK_DELAY_MS = 3000;

const DEFAULT_SETTINGS: BggSettings = {
  geeklistUrl: DEFAULT_GEEKLIST_URL,
  username: "",
  realName: "",
};

function normalizeBggSettings(raw: unknown): BggSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;

  const value = raw as Record<string, unknown>;
  const geeklistUrl =
    typeof value.geeklistUrl === "string" && value.geeklistUrl.trim().length > 0
      ? value.geeklistUrl
      : DEFAULT_SETTINGS.geeklistUrl;
  const username = typeof value.username === "string" ? value.username : "";
  const realName = typeof value.realName === "string" ? value.realName : "";

  return { geeklistUrl, username, realName };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryDelayMs(response: Response, body: any): number {
  const bodySeconds =
    typeof body?.retryAfterSeconds === "number"
      ? body.retryAfterSeconds
      : typeof body?.commentEnrichment?.retryAfterSeconds === "number"
      ? body.commentEnrichment.retryAfterSeconds
      : null;
  const headerSeconds = Number(response.headers.get("Retry-After"));
  const seconds =
    bodySeconds && bodySeconds > 0
      ? bodySeconds
      : Number.isFinite(headerSeconds) && headerSeconds > 0
      ? headerSeconds
      : null;

  return seconds ? seconds * 1000 : BGG_PROCESSING_FALLBACK_DELAY_MS;
}

export function VFMProvider({ children }: { children: React.ReactNode }) {
  const [games, setGames] = useState<Game[]>([]);
  const [bggSettings, setBggSettings] = useState<BggSettings>(DEFAULT_SETTINGS);
  const [lastSyncedAt, setLastSyncedAtState] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const lastAutoSyncAttemptAtRef = useRef<number>(0);

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
        try {
          const normalized = normalizeBggSettings(JSON.parse(rawSettings));
          setBggSettings(normalized);
          const serialized = JSON.stringify(normalized);
          if (serialized !== rawSettings) {
            AsyncStorage.setItem(SETTINGS_KEY, serialized);
          }
        } catch {}
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

  const syncFromBgg = useCallback(
    async (overrideSettings?: BggSettings): Promise<SyncResult> => {
      const settings = overrideSettings ?? bggSettings;
      const listId = extractListId(settings.geeklistUrl);

      if (!listId) throw new Error("No geeklist ID found in the saved URL. Open settings to configure.");
      if (!settings.username) throw new Error("No BGG username saved. Open settings to configure.");

      setIsSyncing(true);
      try {
        const params = new URLSearchParams({
          listId,
          username: settings.username,
        });
        if (settings.realName) params.set("realName", settings.realName);

        const base = getBaseUrl();
        const syncUrl = `${base}/api/bgg/geeklist?${params.toString()}`;
        let data: any = null;

        for (let attempt = 0; attempt < BGG_PROCESSING_MAX_ATTEMPTS; attempt++) {
          const resp = await fetch(syncUrl);
          const body = await resp.json().catch(() => ({}));

          if (resp.status === 202) {
            if (attempt === BGG_PROCESSING_MAX_ATTEMPTS - 1) {
              throw new Error("BGG is still preparing the list. Please try refreshing again in a minute.");
            }

            await sleep(parseRetryDelayMs(resp, body));
            continue;
          }

          if (!resp.ok) {
            throw new Error(body.error ?? `HTTP ${resp.status}`);
          }

          data = body;
          const enrichmentStatus = data?.commentEnrichment?.status;
          const enrichmentItemCount =
            typeof data?.commentEnrichment?.itemCount === "number"
              ? data.commentEnrichment.itemCount
              : 0;
          const canWaitForCommentEnrichment =
            enrichmentItemCount === 0 &&
            (enrichmentStatus === "warming" || enrichmentStatus === "refreshing");

          if (
            canWaitForCommentEnrichment &&
            attempt < BGG_PROCESSING_MAX_ATTEMPTS - 1
          ) {
            await sleep(parseRetryDelayMs(resp, data));
            continue;
          }

          break;
        }

        if (!data) {
          throw new Error("Could not sync from BGG.");
        }

        const { items, listTitle } = data;

        const mapped = items.map((item: any) => ({
          id: `bgg_${item.id}`,
          title: item.gameTitle,
          price: item.price ?? 0,
          type: item.type,
          status: item.status,
          auctionStatus: item.auctionStatus,
          myBid: item.myBid,
          buyerSeller: item.buyerSeller,
          condition: item.condition,
          notes: item.notes,
          bggUrl: `https://boardgamegeek.com/geeklist/${listId}/item/${item.id}`,
          source: "bgg" as const,
        }));

        replaceBggGames(mapped);
        const now = new Date().toISOString();
        setLastSyncedAtState(now);
        AsyncStorage.setItem(SYNC_KEY, now);

        return {
          sales: mapped.filter((g: any) => g.type === "sale").length,
          purchases: mapped.filter((g: any) => g.type === "purchase").length,
          auctionsWinning: mapped.filter((g: any) => g.type === "auction" && g.auctionStatus === "winning").length,
          auctionsOutbid: mapped.filter((g: any) => g.type === "auction" && g.auctionStatus === "outbid").length,
          listTitle,
        };
      } finally {
        setIsSyncing(false);
      }
    },
    [bggSettings, replaceBggGames]
  );

  const shouldAutoSyncNow = useCallback((): boolean => {
    if (isSyncing) return false;
    if (!bggSettings.username) return false;
    if (!extractListId(bggSettings.geeklistUrl)) return false;
    const now = Date.now();
    const lastSuccessfulSyncAt = lastSyncedAt ? Date.parse(lastSyncedAt) : NaN;
    const baseline = Math.max(
      Number.isNaN(lastSuccessfulSyncAt) ? 0 : lastSuccessfulSyncAt,
      lastAutoSyncAttemptAtRef.current,
    );
    return now - baseline >= AUTO_SYNC_INTERVAL_MS;
  }, [bggSettings.geeklistUrl, bggSettings.username, isSyncing, lastSyncedAt]);

  const runAutoSyncIfDue = useCallback(async () => {
    if (!shouldAutoSyncNow()) return;
    lastAutoSyncAttemptAtRef.current = Date.now();
    try {
      await syncFromBgg();
    } catch {
      // Keep auto-sync non-blocking. Manual refresh still surfaces errors.
    }
  }, [shouldAutoSyncNow, syncFromBgg]);

  useEffect(() => {
    const interval = setInterval(() => {
      void runAutoSyncIfDue();
    }, AUTO_SYNC_POLL_MS);

    // Catch up immediately when the app opens if the last sync is stale.
    void runAutoSyncIfDue();

    return () => clearInterval(interval);
  }, [runAutoSyncIfDue]);

  useEffect(() => {
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void runAutoSyncIfDue();
      }
    });

    const webWindow =
      typeof globalThis !== "undefined"
        ? (globalThis as { window?: { addEventListener: (...args: any[]) => void; removeEventListener: (...args: any[]) => void } }).window
        : undefined;
    const webDocument =
      typeof globalThis !== "undefined"
        ? (globalThis as { document?: { visibilityState?: string; addEventListener: (...args: any[]) => void; removeEventListener: (...args: any[]) => void } }).document
        : undefined;

    if (webWindow && webDocument) {
      const onWindowFocus = () => {
        void runAutoSyncIfDue();
      };
      const onVisibilityChange = () => {
        if (webDocument.visibilityState === "visible") {
          void runAutoSyncIfDue();
        }
      };

      webWindow.addEventListener("focus", onWindowFocus);
      webDocument.addEventListener("visibilitychange", onVisibilityChange);

      return () => {
        appStateSub.remove();
        webWindow.removeEventListener("focus", onWindowFocus);
        webDocument.removeEventListener("visibilitychange", onVisibilityChange);
      };
    }

    return () => {
      appStateSub.remove();
    };
  }, [runAutoSyncIfDue]);

  const stats = {
    listedCount: games.filter(
      (g) => g.type === "sale" && g.status === "listed"
    ).length,
    soldCount: games.filter(
      (g) => g.type === "sale" && g.status === "sold"
    ).length,
    purchasedCount: games.filter((g) => g.type === "purchase").length,
    winningCount: games.filter(
      (g) => g.type === "auction" && g.auctionStatus === "winning"
    ).length,
    outbidCount: games.filter(
      (g) => g.type === "auction" && g.auctionStatus === "outbid"
    ).length,
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
        syncFromBgg,
        isSyncing,
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
