import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { getBaseUrl } from "@workspace/api-client-react";
import { AppFooter } from "@/components/AppFooter";
import { useVFM } from "@/context/VFMContext";
import { useColors } from "@/hooks/useColors";

type MatchType = "wishlist" | "want_in_trade" | "want_to_buy";

interface WishlistItem {
  id: string;
  objectId: string;
  gameTitle: string;
  price: number;
  seller: string;
  condition?: string;
  matchTypes: MatchType[];
  bggUrl: string;
}

interface WishlistResponse {
  listTitle: string;
  totalItems: number;
  totalMatches: number;
  items: WishlistItem[];
}

function extractListId(url: string): string | null {
  const match = url.match(/geeklist\/(\d+)/);
  return match ? match[1] : null;
}

const MATCH_LABELS: Record<MatchType, string> = {
  wishlist: "Wishlist",
  want_in_trade: "Want in Trade",
  want_to_buy: "Want to Buy",
};

export default function WishlistScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { bggSettings } = useVFM();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<WishlistResponse | null>(null);

  const listId = useMemo(() => extractListId(bggSettings.geeklistUrl), [bggSettings.geeklistUrl]);

  const load = useCallback(
    async (refresh: boolean) => {
      if (!listId || !bggSettings.username) {
        setData(null);
        setError("Set your geeklist URL and BGG username in Settings first.");
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (refresh) setIsRefreshing(true);
      else setIsLoading(true);

      setError(null);
      try {
        const params = new URLSearchParams({
          listId,
          username: bggSettings.username,
        });
        const base = getBaseUrl();
        const resp = await fetch(`${base}/api/bgg/wishlist?${params.toString()}`);

        if (resp.status === 202) {
          const body = await resp.json().catch(() => ({ error: "BGG is still preparing your data." }));
          throw new Error(body.error ?? "BGG is still preparing your data. Please try again shortly.");
        }

        if (!resp.ok) {
          const body = await resp.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(body.error ?? `HTTP ${resp.status}`);
        }

        const payload = (await resp.json()) as WishlistResponse;
        setData(payload);
      } catch (err: any) {
        setData(null);
        setError(err?.message ?? "Failed to load wishlist matches.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [bggSettings.username, listId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  return (
    <>
      <Stack.Screen options={{ title: "Wishlist" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
              Checking active VFM listings...
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
                  Matches In Active Listings
                </Text>
                <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
                  {data?.listTitle ?? "BGG Geeklist"}
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
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.cardTitle, { color: colors.foreground }]}>{item.gameTitle}</Text>
                <View style={styles.badgeRow}>
                  {item.matchTypes.map((matchType) => (
                    <View
                      key={`${item.id}_${matchType}`}
                      style={[styles.badge, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                    >
                      <Text style={[styles.badgeText, { color: colors.foreground }]}>
                        {MATCH_LABELS[matchType]}
                      </Text>
                    </View>
                  ))}
                </View>
                <View style={styles.metaRow}>
                  <Text style={[styles.metaText, { color: colors.foreground }]}>
                    ${item.price.toFixed(2)}
                  </Text>
                  <Text style={[styles.metaText, { color: colors.mutedForeground }]}>
                    Seller: {item.seller || "Unknown"}
                  </Text>
                </View>
                {item.condition ? (
                  <Text style={[styles.conditionText, { color: colors.mutedForeground }]}>
                    Condition: {item.condition}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={styles.linkWrap}
                  onPress={() => {
                    Linking.openURL(item.bggUrl).catch(() => {});
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.linkText, { color: colors.accent }]}>Open BGG Listing</Text>
                </TouchableOpacity>
              </View>
            )}
            ListEmptyComponent={
              !error ? (
                <View style={styles.centerState}>
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    No Matches Right Now
                  </Text>
                  <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
                    No currently listed VFM sale items match your wishlist, want in trade, or want to buy lists.
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
    gap: 12,
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
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  cardTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  badgeText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  metaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
  },
  metaText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  conditionText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
  },
  linkWrap: {
    alignSelf: "flex-start",
    paddingVertical: 2,
  },
  linkText: {
    fontSize: 13,
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
