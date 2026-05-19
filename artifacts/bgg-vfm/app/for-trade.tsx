import { Feather } from "@expo/vector-icons";
import { getBaseUrl } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppFooter } from "@/components/AppFooter";
import { useVFM } from "@/context/VFMContext";
import { useColors } from "@/hooks/useColors";

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

function buildVfmPostUrl(geeklistUrl: string, item: ForTradeItem): string | null {
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
  if (imageId) {
    url.searchParams.set("addListitemImageid", imageId);
  }

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
  const listId = useMemo(
    () => extractListId(bggSettings.geeklistUrl),
    [bggSettings.geeklistUrl],
  );

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
              const postUrl = buildVfmPostUrl(bggSettings.geeklistUrl, item);

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
                      {postUrl ? (
                        <TouchableOpacity
                          style={[styles.postBtn, { backgroundColor: colors.primary }]}
                          onPress={() => {
                            Linking.openURL(postUrl).catch(() => {});
                          }}
                          activeOpacity={0.75}
                        >
                          <Feather name="send" size={13} color={colors.primaryForeground} />
                          <Text style={[styles.postBtnText, { color: colors.primaryForeground }]}>
                            Add to VFM
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
  refreshBtn: {
    marginTop: 6,
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
