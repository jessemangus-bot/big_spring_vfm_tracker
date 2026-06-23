import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";
import { getBaseUrl } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppFooter } from "@/components/AppFooter";
import { AddToVfmReviewModal, VfmPostItem } from "@/components/AddToVfmReviewModal";
import { useVFM } from "@/context/VFMContext";
import { useColors } from "@/hooks/useColors";

const TRACKED_AUCTIONS_KEY = "auctionTracker:trackedLists";

interface TrackedAuction {
  listId: string;
  title: string;
}

interface Destination {
  label: string;
  geeklistUrl: string;
}

interface ForTradeItem {
  id: string;
  collectionId: string;
  objectId: string;
  gameTitle: string;
  yearPublished?: number;
  version?: string;
  language?: string;
  tradeCondition?: string;
  thumbnail?: string;
  image?: string;
  bggUrl?: string;
}

interface ForTradeResponse {
  username: string;
  totalForTrade: number;
  items: ForTradeItem[];
}

function extractListId(url: string): string | null {
  const match = url.match(/geeklist\/(\d+)/);
  return match ? match[1] : null;
}

function extractBggImageId(item: ForTradeItem): string | null {
  const match = (item.image ?? item.thumbnail ?? "").match(/\/pic(\d+)\./);
  return match ? match[1] : null;
}

function itemToVfmPostItem(item: ForTradeItem): VfmPostItem | null {
  if (!item.objectId) return null;
  return {
    objectId: item.objectId,
    gameTitle: item.gameTitle,
    version: item.version,
    language: item.language,
    tradeCondition: item.tradeCondition,
    imageId: extractBggImageId(item) ?? undefined,
  };
}

type PostMode = "fp" | "auction";

function buildFpPostUrl(geeklistUrl: string, item: ForTradeItem): string | null {
  const listId = extractListId(geeklistUrl);
  if (!listId || !item.objectId) return null;
  const body = [
    `[B]Version:[/B] ${item.version ?? ""}`,
    `[B]Language:[/B] ${item.language ?? ""}`,
    `[B]Condition:[/B] ${item.tradeCondition ?? ""}`,
    "",
    "[B]FP:[/B] $",
  ].join("\n");
  const url = new URL(`https://boardgamegeek.com/geeklist/${listId}`);
  url.searchParams.set("addListitem", "1");
  url.searchParams.set("addListitemType", "things");
  url.searchParams.set("addListitemId", item.objectId);
  url.searchParams.set("addListitemBody", body);
  const imageId = extractBggImageId(item);
  if (imageId) url.searchParams.set("addListitemImageid", imageId);
  return url.toString();
}

export default function ForTradeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { bggSettings } = useVFM();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ForTradeResponse | null>(null);
  const [reviewItem, setReviewItem] = useState<VfmPostItem | null>(null);
  const [trackedAuctions, setTrackedAuctions] = useState<TrackedAuction[]>([]);
  const [selectedDestIndex, setSelectedDestIndex] = useState(0);
  const [showDestPicker, setShowDestPicker] = useState(false);
  const [postMode, setPostMode] = useState<PostMode>("fp");

  const listId = useMemo(
    () => extractListId(bggSettings.geeklistUrl),
    [bggSettings.geeklistUrl],
  );

  // Build destination list: VFM first, then tracked auctions
  const destinations = useMemo<Destination[]>(() => {
    const vfm: Destination = { label: "VFM", geeklistUrl: bggSettings.geeklistUrl };
    const auctions = trackedAuctions.map((a) => ({
      label: a.title || `Auction ${a.listId}`,
      geeklistUrl: `https://boardgamegeek.com/geeklist/${a.listId}`,
    }));
    return [vfm, ...auctions];
  }, [bggSettings.geeklistUrl, trackedAuctions]);

  const selectedDest = destinations[Math.min(selectedDestIndex, destinations.length - 1)];

  // Load tracked auctions from AsyncStorage
  useEffect(() => {
    AsyncStorage.getItem(TRACKED_AUCTIONS_KEY)
      .then((raw) => {
        if (raw) setTrackedAuctions(JSON.parse(raw) as TrackedAuction[]);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!bggSettings.username) {
        setData(null);
        setError("Set your BGG username in Settings first.");
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);

      setError(null);
      try {
        const params = new URLSearchParams({
          username: bggSettings.username,
        });
        const base = getBaseUrl();
        const resp = await fetch(`${base}/api/bgg/for-trade?${params.toString()}`);

        if (resp.status === 202) {
          const body = await resp.json().catch(() => ({ error: "BGG is still preparing your collection." }));
          throw new Error(body.error ?? "BGG is still preparing your collection. Please try again shortly.");
        }

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(body.error ?? `HTTP ${resp.status}`);
        }

        const payload = (await resp.json()) as ForTradeResponse;
        setData(payload);
      } catch (err: any) {
        setData(null);
        setError(err?.message ?? "Failed to load for-trade collection.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [bggSettings.username],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <>
      <Stack.Screen options={{ title: "For Trade" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
              Loading your trade list...
            </Text>
          </View>
        ) : (
          <FlatList
            data={data?.items ?? []}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + 24 },
            ]}
            ListHeaderComponent={
              <View style={styles.headerWrap}>
                <Text style={[styles.pageTitle, { color: colors.foreground }]}>
                  For Trade Collection
                </Text>
                <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
                  {data ? `${data.totalForTrade} games marked for trade` : bggSettings.username}
                </Text>

                {/* Destination picker */}
                <View style={styles.destRow}>
                  <Text style={[styles.destLabel, { color: colors.mutedForeground }]}>
                    Post to:
                  </Text>
                  <TouchableOpacity
                    style={[
                      styles.destBtn,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                    onPress={() => setShowDestPicker((v) => !v)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[styles.destBtnText, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {selectedDest.label}
                    </Text>
                    <Feather
                      name={showDestPicker ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={colors.mutedForeground}
                    />
                  </TouchableOpacity>
                </View>

                {showDestPicker && (
                  <View
                    style={[
                      styles.destDropdown,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                      {destinations.map((dest, idx) => (
                        <TouchableOpacity
                          key={dest.geeklistUrl}
                          style={[
                            styles.destOption,
                            idx < destinations.length - 1 && {
                              borderBottomWidth: 1,
                              borderBottomColor: colors.border,
                            },
                          ]}
                          onPress={() => {
                            setSelectedDestIndex(idx);
                            setShowDestPicker(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.destOptionText,
                              {
                                color:
                                  selectedDestIndex === idx
                                    ? colors.accent
                                    : colors.foreground,
                                fontFamily:
                                  selectedDestIndex === idx
                                    ? "Inter_600SemiBold"
                                    : "Inter_400Regular",
                              },
                            ]}
                            numberOfLines={2}
                          >
                            {dest.label}
                          </Text>
                          {selectedDestIndex === idx && (
                            <Feather name="check" size={16} color={colors.accent} />
                          )}
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                )}

                {/* FP / Auction format toggle */}
                <View style={[styles.modeToggle, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                  {(["fp", "auction"] as const).map((mode) => (
                    <TouchableOpacity
                      key={mode}
                      style={[
                        styles.modeBtn,
                        postMode === mode && { backgroundColor: colors.primary },
                      ]}
                      onPress={() => setPostMode(mode)}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.modeBtnText,
                          { color: postMode === mode ? colors.primaryForeground : colors.mutedForeground },
                        ]}
                      >
                        {mode === "fp" ? "Fixed Price" : "Auction"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <TouchableOpacity
                  style={[styles.refreshBtn, { backgroundColor: colors.primary }]}
                  onPress={() => load(true)}
                  disabled={isRefreshing}
                  activeOpacity={0.8}
                >
                  {isRefreshing ? (
                    <ActivityIndicator color={colors.primaryForeground} size="small" />
                  ) : (
                    <Feather name="refresh-cw" size={16} color={colors.primaryForeground} />
                  )}
                  <Text style={[styles.refreshText, { color: colors.primaryForeground }]}>
                    Refresh
                  </Text>
                </TouchableOpacity>
                {error ? (
                  <Text style={[styles.errorText, { color: colors.destructive }]}>
                    {error}
                  </Text>
                ) : null}
              </View>
            }
            renderItem={({ item }) => {
              const postItem = itemToVfmPostItem(item);
              const fpUrl = postMode === "fp" ? buildFpPostUrl(selectedDest.geeklistUrl, item) : null;

              return (
                <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  {item.thumbnail ? (
                    <Image source={{ uri: item.thumbnail }} style={styles.thumbnail} />
                  ) : (
                    <View style={[styles.thumbnailFallback, { backgroundColor: colors.secondary }]}>
                      <Feather name="box" size={20} color={colors.mutedForeground} />
                    </View>
                  )}
                  <View style={styles.cardBody}>
                    <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>
                      {item.gameTitle}
                    </Text>
                    <View style={styles.metaRow}>
                      {item.yearPublished ? (
                        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                          {item.yearPublished}
                        </Text>
                      ) : null}
                      {item.collectionId ? (
                        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                          Collection #{item.collectionId}
                        </Text>
                      ) : null}
                      {item.version ? (
                        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                          {item.version}
                        </Text>
                      ) : null}
                      {item.language ? (
                        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                          {item.language}
                        </Text>
                      ) : null}
                      {item.tradeCondition ? (
                        <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                          Condition: {item.tradeCondition}
                        </Text>
                      ) : null}
                    </View>
                    <View style={styles.actionRow}>
                      {postMode === "fp" && fpUrl ? (
                        <TouchableOpacity
                          style={[styles.postBtn, { backgroundColor: colors.primary }]}
                          onPress={() => Linking.openURL(fpUrl).catch(() => {})}
                          activeOpacity={0.75}
                        >
                          <Feather name="send" size={13} color={colors.primaryForeground} />
                          <Text style={[styles.postBtnText, { color: colors.primaryForeground }]}>
                            Add to VFM
                          </Text>
                        </TouchableOpacity>
                      ) : postMode === "auction" && postItem ? (
                        <TouchableOpacity
                          style={[styles.postBtn, { backgroundColor: colors.primary }]}
                          onPress={() => setReviewItem(postItem)}
                          activeOpacity={0.75}
                        >
                          <Feather name="send" size={13} color={colors.primaryForeground} />
                          <Text style={[styles.postBtnText, { color: colors.primaryForeground }]}>
                            Post as Auction
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      {item.bggUrl ? (
                        <TouchableOpacity
                          style={styles.linkWrap}
                          onPress={() => {
                            Linking.openURL(item.bggUrl!).catch(() => {});
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.linkText, { color: colors.accent }]}>
                            Open Game
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              !error ? (
                <View style={styles.centerState}>
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    No For-Trade Games
                  </Text>
                  <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
                    {listId
                      ? "Your BGG collection does not have any games marked for trade right now."
                      : "Set your VFM geeklist URL in Settings to post games for sale."}
                  </Text>
                </View>
              ) : null
            }
            ListFooterComponent={<AppFooter />}
          />
        )}
      </View>
      <AddToVfmReviewModal
        visible={reviewItem != null}
        item={reviewItem}
        geeklistUrl={selectedDest.geeklistUrl}
        destinationLabel={selectedDest.label}
        onClose={() => setReviewItem(null)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: {
    padding: 16,
    gap: 10,
  },
  headerWrap: {
    marginBottom: 16,
    gap: 8,
  },
  pageTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  pageSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  destRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  destLabel: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    flexShrink: 0,
  },
  destBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    gap: 6,
  },
  destBtnText: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  destDropdown: {
    borderWidth: 1,
    borderRadius: 10,
    maxHeight: 200,
    overflow: "hidden",
  },
  destOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
  },
  destOptionText: {
    flex: 1,
    fontSize: 14,
  },
  modeToggle: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    alignSelf: "flex-start",
  },
  modeBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  modeBtnText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  refreshBtn: {
    marginTop: 2,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  refreshText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    flexDirection: "row",
    gap: 12,
  },
  thumbnail: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  thumbnailFallback: {
    width: 56,
    height: 56,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  cardBody: {
    flex: 1,
    gap: 5,
  },
  cardTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  linkWrap: {
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  linkText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginTop: 2,
  },
  postBtn: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  postBtnText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  centerState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 48,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  helperText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  errorText: {
    marginTop: 4,
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
  },
});
