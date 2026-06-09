import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { getBaseUrl } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

interface AuctionHighBid {
  amount: number;
  username: string;
  viaBin: boolean;
  flags: string[];
  raw: string;
}

interface AuctionItem {
  id: string;
  objectId?: string;
  gameTitle: string;
  seller: string;
  startingBid: number;
  binPrice: number;
  bidCount: number;
  highBid: AuctionHighBid | null;
  yourStatus: "winning" | "outbid" | null;
  yourBest: number | null;
  bids: Array<{ username: string; amount: number }>;
  bggUrl: string;
}

interface AuctionResponse {
  listId: string;
  listTitle: string;
  totalItems: number;
  itemsWithBids: number;
  highBidTotal: number;
  yourWinning: number | null;
  yourOutbid: number | null;
  items: AuctionItem[];
}

interface TrackedAuction {
  listId: string;
  title: string;
}

type Filter = "all" | "withBids" | "noBids" | "mine";

const TRACKED_KEY = "auctionTracker:trackedLists";
const USERNAME_KEY = "auctionTracker:username";
const WINNING_GREEN = "#1D9E55";
const OUTBID_RED = "#C73A2F";

function extractListId(input: string): string | null {
  const m = input.match(/geeklist\/(\d+)/i) ?? input.match(/^(\d+)$/);
  return m ? m[1] : null;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export default function AuctionTrackerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [tracked, setTracked] = useState<TrackedAuction[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [addInput, setAddInput] = useState("");
  const [username, setUsername] = useState("");
  const [data, setData] = useState<AuctionResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ── Persistence ──────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [storedTracked, storedUsername] = await Promise.all([
          AsyncStorage.getItem(TRACKED_KEY),
          AsyncStorage.getItem(USERNAME_KEY),
        ]);
        if (storedTracked) {
          const parsed: TrackedAuction[] = JSON.parse(storedTracked);
          setTracked(parsed);
          if (parsed.length > 0) setSelectedListId(parsed[0].listId);
        }
        if (storedUsername) setUsername(storedUsername);
      } catch {
        // First run or corrupted storage — start fresh.
      }
    })();
  }, []);

  const persistTracked = useCallback(async (next: TrackedAuction[]) => {
    setTracked(next);
    try {
      await AsyncStorage.setItem(TRACKED_KEY, JSON.stringify(next));
    } catch {
      // Non-fatal: list lives in memory for this session.
    }
  }, []);

  const persistUsername = useCallback(async (value: string) => {
    setUsername(value);
    try {
      await AsyncStorage.setItem(USERNAME_KEY, value.trim());
    } catch {
      // Non-fatal.
    }
  }, []);

  // ── Data loading ─────────────────────────────────────────────────────────
  const loadAuction = useCallback(
    async (listId: string, attempt = 0) => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ listId });
        const trimmedUsername = username.trim();
        if (trimmedUsername) params.set("username", trimmedUsername);

        const base = getBaseUrl();
        const resp = await fetch(
          `${base}/api/bgg/auction/bids?${params.toString()}`,
        );

        if (resp.status === 202) {
          if (attempt < 5) {
            setTimeout(() => loadAuction(listId, attempt + 1), 3000);
            return;
          }
          throw new Error("BGG is still preparing this list. Try refresh.");
        }
        if (!resp.ok) {
          const body = await resp.json().catch(() => null);
          throw new Error(body?.error ?? `Request failed (${resp.status})`);
        }

        const json: AuctionResponse = await resp.json();
        setData(json);

        // Backfill a friendly title onto the tracked entry.
        setTracked((prev) => {
          const next = prev.map((t) =>
            t.listId === listId && t.title !== json.listTitle
              ? { ...t, title: json.listTitle }
              : t,
          );
          if (JSON.stringify(next) !== JSON.stringify(prev)) {
            AsyncStorage.setItem(TRACKED_KEY, JSON.stringify(next)).catch(
              () => {},
            );
          }
          return next;
        });
      } catch (err: any) {
        setError(err?.message ?? "Failed to load auction");
        setData(null);
      } finally {
        setIsLoading(false);
      }
    },
    [username],
  );

  useEffect(() => {
    if (selectedListId) loadAuction(selectedListId);
    else setData(null);
  }, [selectedListId, loadAuction]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleAdd = useCallback(() => {
    const listId = extractListId(addInput.trim());
    if (!listId) {
      setError("Enter a geeklist URL or numeric ID");
      return;
    }
    setError(null);
    setAddInput("");
    if (!tracked.some((t) => t.listId === listId)) {
      persistTracked([...tracked, { listId, title: `Geeklist ${listId}` }]);
    }
    setSelectedListId(listId);
  }, [addInput, tracked, persistTracked]);

  const handleRemove = useCallback(
    (listId: string) => {
      const next = tracked.filter((t) => t.listId !== listId);
      persistTracked(next);
      if (selectedListId === listId) {
        setSelectedListId(next.length > 0 ? next[0].listId : null);
      }
    },
    [tracked, selectedListId, persistTracked],
  );

  // ── Derived ──────────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => {
    if (!data) return [];
    let items = data.items;
    if (filter === "withBids") items = items.filter((i) => i.highBid);
    if (filter === "noBids") items = items.filter((i) => !i.highBid);
    if (filter === "mine") items = items.filter((i) => i.yourStatus !== null);
    return [...items].sort(
      (a, b) => (b.highBid?.amount ?? -1) - (a.highBid?.amount ?? -1),
    );
  }, [data, filter]);

  const filters: Array<{ key: Filter; label: string }> = useMemo(() => {
    const base: Array<{ key: Filter; label: string }> = [
      { key: "all", label: "All" },
      { key: "withBids", label: "Has bids" },
      { key: "noBids", label: "No bids" },
    ];
    if (username.trim()) base.push({ key: "mine", label: "My bids" });
    return base;
  }, [username]);

  // ── Render ───────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: AuctionItem }) => {
      const expanded = expandedId === item.id;
      return (
        <TouchableOpacity
          style={[
            styles.card,
            { backgroundColor: colors.secondary, borderColor: colors.border },
          ]}
          onPress={() => setExpandedId(expanded ? null : item.id)}
          activeOpacity={0.85}
        >
          <View style={styles.cardHeader}>
            <View style={styles.cardTitleWrap}>
              <Text
                style={[styles.cardTitle, { color: colors.foreground }]}
                numberOfLines={2}
              >
                {item.gameTitle}
              </Text>
              <Text
                style={[styles.cardMeta, { color: colors.mutedForeground }]}
              >
                {item.seller ? `seller ${item.seller} · ` : ""}
                {item.bidCount} bid{item.bidCount === 1 ? "" : "s"}
                {item.startingBid > 0 ? ` · SB ${money(item.startingBid)}` : ""}
                {item.binPrice > 0 ? ` · BIN ${money(item.binPrice)}` : ""}
              </Text>
            </View>
            <View style={styles.cardFigure}>
              {item.highBid ? (
                <>
                  <Text style={[styles.amount, { color: colors.foreground }]}>
                    {money(item.highBid.amount)}
                  </Text>
                  <Text
                    style={[
                      styles.bidder,
                      { color: colors.mutedForeground },
                    ]}
                    numberOfLines={1}
                  >
                    {item.highBid.viaBin ? "BIN · " : ""}
                    {item.highBid.username}
                  </Text>
                </>
              ) : (
                <Text
                  style={[styles.noBids, { color: colors.mutedForeground }]}
                >
                  no bids
                </Text>
              )}
            </View>
          </View>

          {item.yourStatus ? (
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor:
                    item.yourStatus === "winning" ? WINNING_GREEN : OUTBID_RED,
                },
              ]}
            >
              <Text style={styles.statusPillText}>
                {item.yourStatus === "winning"
                  ? "You're winning"
                  : `Outbid — yours ${money(item.yourBest ?? 0)}`}
              </Text>
            </View>
          ) : null}

          {item.highBid && item.highBid.flags.length > 0 ? (
            <View
              style={[styles.flagBox, { borderLeftColor: OUTBID_RED }]}
            >
              <Text style={[styles.flagText, { color: colors.foreground }]}>
                ⚑ {item.highBid.flags.join("; ")}
              </Text>
              <Text
                style={[styles.flagRaw, { color: colors.mutedForeground }]}
                numberOfLines={2}
              >
                “{item.highBid.raw}” — verify on BGG
              </Text>
            </View>
          ) : null}

          {expanded ? (
            <View style={[styles.expanded, { borderTopColor: colors.border }]}>
              {item.bids.length > 0 ? (
                item.bids.map((b, idx) => (
                  <Text
                    key={`${item.id}-bid-${idx}`}
                    style={[
                      styles.bidRow,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {money(b.amount)} — {b.username}
                    {username.trim() &&
                    b.username.toLowerCase() ===
                      username.trim().toLowerCase()
                      ? " (you)"
                      : ""}
                  </Text>
                ))
              ) : (
                <Text
                  style={[styles.bidRow, { color: colors.mutedForeground }]}
                >
                  No parsed bids yet
                </Text>
              )}
              <TouchableOpacity
                style={[styles.bggLink, { borderColor: colors.border }]}
                onPress={() => Linking.openURL(item.bggUrl)}
                activeOpacity={0.8}
              >
                <Feather
                  name="external-link"
                  size={14}
                  color={colors.primary}
                />
                <Text style={[styles.bggLinkText, { color: colors.primary }]}>
                  View / bid on BGG
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </TouchableOpacity>
      );
    },
    [colors, expandedId, username],
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Auction Tracker" }} />

      <View style={styles.controls}>
        <View style={styles.addRow}>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.secondary,
              },
            ]}
            value={addInput}
            onChangeText={setAddInput}
            placeholder="Geeklist URL or ID to track"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={handleAdd}
          />
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary }]}
            onPress={handleAdd}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={18} color={colors.background} />
          </TouchableOpacity>
        </View>

        <TextInput
          style={[
            styles.input,
            {
              color: colors.foreground,
              borderColor: colors.border,
              backgroundColor: colors.secondary,
            },
          ]}
          value={username}
          onChangeText={persistUsername}
          placeholder="Your BGG username (optional — highlights your bids)"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => selectedListId && loadAuction(selectedListId)}
        />

        {tracked.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipRow}
          >
            {tracked.map((t) => {
              const selected = t.listId === selectedListId;
              return (
                <TouchableOpacity
                  key={t.listId}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: selected
                        ? colors.primary
                        : colors.secondary,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => setSelectedListId(t.listId)}
                  onLongPress={() => handleRemove(t.listId)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: selected
                          ? colors.background
                          : colors.foreground,
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {t.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null}
      </View>

      {data ? (
        <View style={styles.summary}>
          <Text style={[styles.summaryText, { color: colors.mutedForeground }]}>
            {data.itemsWithBids}/{data.totalItems} items with bids · total{" "}
            {money(data.highBidTotal)}
            {data.yourWinning !== null
              ? ` · you lead ${data.yourWinning}, outbid on ${data.yourOutbid}`
              : ""}
          </Text>
          <View style={styles.filterRow}>
            {filters.map((f) => (
              <TouchableOpacity
                key={f.key}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor:
                      filter === f.key ? colors.primary : colors.secondary,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    {
                      color:
                        filter === f.key
                          ? colors.background
                          : colors.foreground,
                    },
                  ]}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.filterChip, { borderColor: colors.border }]}
              onPress={() => selectedListId && loadAuction(selectedListId)}
              activeOpacity={0.8}
            >
              <Feather name="refresh-cw" size={14} color={colors.foreground} />
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {error ? (
        <Text style={[styles.error, { color: OUTBID_RED }]}>{error}</Text>
      ) : null}

      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>
            Fetching bids… BGG can take a few seconds
          </Text>
        </View>
      ) : data ? (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 24 },
          ]}
        />
      ) : (
        <View style={styles.empty}>
          <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
            Add a geeklist auction above to start tracking bids.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  controls: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  addRow: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  addBtn: {
    width: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  chipRow: { flexGrow: 0 },
  chip: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    maxWidth: 220,
  },
  chipText: { fontSize: 13, fontFamily: "Inter_500Medium" },
  summary: { paddingHorizontal: 16, paddingTop: 12, gap: 8 },
  summaryText: { fontSize: 12 },
  filterRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  filterChip: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  filterChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  error: { paddingHorizontal: 16, paddingTop: 8, fontSize: 13 },
  loading: { padding: 32, alignItems: "center", gap: 10 },
  loadingText: { fontSize: 13 },
  list: { padding: 16, gap: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  cardHeader: { flexDirection: "row", gap: 12 },
  cardTitleWrap: { flex: 1 },
  cardTitle: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  cardMeta: { fontSize: 12, marginTop: 2 },
  cardFigure: { alignItems: "flex-end", minWidth: 80 },
  amount: { fontSize: 18, fontFamily: "Inter_700Bold" },
  bidder: { fontSize: 12, marginTop: 2, maxWidth: 110 },
  noBids: { fontSize: 13, fontStyle: "italic" },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginTop: 8,
  },
  statusPillText: {
    color: "#FFFFFF",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  flagBox: { borderLeftWidth: 3, paddingLeft: 8, marginTop: 8 },
  flagText: { fontSize: 12 },
  flagRaw: { fontSize: 11, marginTop: 2 },
  expanded: { borderTopWidth: 1, marginTop: 10, paddingTop: 8, gap: 4 },
  bidRow: { fontSize: 12 },
  bggLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 6,
  },
  bggLinkText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  empty: { padding: 40, alignItems: "center" },
  emptyText: { fontSize: 14, textAlign: "center" },
});
