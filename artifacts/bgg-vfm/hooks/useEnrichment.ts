import AsyncStorage from "@react-native-async-storage/async-storage";
import { getBaseUrl } from "@workspace/api-client-react";
import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "bgg-enrichment-v1";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const BATCH_SIZE = 100;
const CONCURRENCY = 3;

export interface EnrichmentEntry {
  categories: string[];
  mechanics: string[];
  cachedAt: number;
}

type EnrichmentMap = Record<string, EnrichmentEntry>;

export type EnrichmentStatus = "idle" | "loading" | "ready" | "error";

interface UseEnrichmentResult {
  enrichment: EnrichmentMap;
  status: EnrichmentStatus;
  progress: number; // 0–1
}

async function loadStoredEnrichment(): Promise<EnrichmentMap> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EnrichmentMap) : {};
  } catch {
    return {};
  }
}

async function saveEnrichment(map: EnrichmentMap): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal — in-memory map is still usable
  }
}

async function runConcurrent<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

export function useEnrichment(gameIds: string[]): UseEnrichmentResult {
  const [enrichment, setEnrichment] = useState<EnrichmentMap>({});
  const [status, setStatus] = useState<EnrichmentStatus>("idle");
  const [progress, setProgress] = useState(0);
  const abortRef = useRef(false);

  const enrich = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    abortRef.current = false;
    setStatus("loading");
    setProgress(0);

    // Load whatever is already in AsyncStorage
    const stored = await loadStoredEnrichment();
    const now = Date.now();

    // Apply cached entries immediately so filters work right away for known games
    const fresh: EnrichmentMap = {};
    for (const [id, entry] of Object.entries(stored)) {
      if (now - entry.cachedAt < TTL_MS) fresh[id] = entry;
    }
    setEnrichment({ ...fresh });

    // Find IDs that are missing or stale
    const needed = ids.filter((id) => !fresh[id]);
    if (needed.length === 0) {
      setStatus("ready");
      setProgress(1);
      return;
    }

    const base = getBaseUrl();
    const batches: string[][] = [];
    for (let i = 0; i < needed.length; i += BATCH_SIZE) {
      batches.push(needed.slice(i, i + BATCH_SIZE));
    }

    let completed = 0;
    const accumulated = { ...fresh };

    const tasks = batches.map((batch) => async () => {
      if (abortRef.current) return;
      const resp = await fetch(`${base}/api/bgg/thing-batch?ids=${batch.join(",")}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data: Record<string, { categories: string[]; mechanics: string[] }> = await resp.json();
      const batchEntries: EnrichmentMap = {};
      for (const [id, val] of Object.entries(data)) {
        batchEntries[id] = { categories: val.categories, mechanics: val.mechanics, cachedAt: Date.now() };
        accumulated[id] = batchEntries[id];
      }
      if (!abortRef.current) {
        setEnrichment((prev) => ({ ...prev, ...batchEntries }));
      }
      completed++;
      setProgress(completed / batches.length);
    });

    await runConcurrent(tasks, CONCURRENCY);

    if (!abortRef.current) {
      await saveEnrichment(accumulated);
      setStatus("ready");
      setProgress(1);
    }
  }, []);

  useEffect(() => {
    if (gameIds.length === 0) return;
    enrich(gameIds);
    return () => { abortRef.current = true; };
  }, [gameIds.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return { enrichment, status, progress };
}
