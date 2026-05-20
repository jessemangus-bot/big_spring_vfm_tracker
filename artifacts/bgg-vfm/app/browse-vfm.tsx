import { Feather } from "@expo/vector-icons";
import { getBaseUrl } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppFooter } from "@/components/AppFooter";
import { useVFM } from "@/context/VFMContext";
import { useColors } from "@/hooks/useColors";

type Relationship = "mine" | "purchased" | "offer" | "auction" | "unrelated";
type BrowseFilter = "unrelated" | "available" | "all" | "related";

interface VfmItem {
  id: string;
  objectId?: string;
  gameTitle: string;
  price: number;
  seller: string;
  status: "listed" | "sold" | "withdrawn" | "expired";
  type: "sale" | "purchase";
  condition?: string;
  relationship: Relationship;
  bggUrl: string;
}

interface BrowseResponse {
  listTitle: string;
  totalItems: number;
  relationshipCounts: Record<Relationship, number>;
  items: VfmItem[];
}

const FILTER_LABELS: Record<BrowseFilter, string> = {
  unrelated: "Unrelated",
  available: "Available",
  all: "All",
  related: "Related",
};

const RELATIONSHIP_LABELS: Record<Relationship, string> = {
  mine: "Mine",
  purchased: "Purchased",
  offer: "Offer",
  auction: "Auction",
  unrelated: "Unrelated",
};

function extractListId(url: string): string | null {
  const match = url.match(/geeklist\/(\d+)/);
  return match ? match[1] : null;
}

function money(value: number) {
  return `$${value.toFixed(2)}`;
}

export default function BrowseVfmScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { bggSettings } = useVFM();

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [filter, setFilter] = useState<BrowseFilter>("unrelated");
  const [search, setSearch] = useState("");

  const listId = useMemo(
    () => extractListId(bggSettings.geeklistUrl),
    [bggSettings.geeklistUrl],
  );

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
        if (bggSettings.realName) params.set("realName", bggSettings.realName);

        const base = getBaseUrl();
        const resp = await fetch(
          `${base}/api/bgg/geeklist/all-items?${params.toString()}`,
        );

        if (resp.status === 202) {
          const body = await resp.json().catch(() => ({
            error: "BGG is still preparing your data.",
          }));
          throw new Error(
            body.error ??
              "BGG is still preparing your data. Please try again shortly.",
          );
        }

        if (!resp.ok) {
          const body = await resp
            .json()
            .catch(() => ({ error: "Unknown error" }));
          throw new Error(body.error ?? `HTTP ${resp.status}`);
        }

        setData((await resp.json()) as BrowseResponse);
      } catch (err: any) {
        setData(null);
        setError(err?.message ?? "Failed to load VFM items.");
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [bggSettings.realName, bggSettings.username, listId],
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return (data?.items ?? []).filter((item) => {
      const matchesFilter =
        filter === "all" ||
        (filter === "unrelated" && item.relationship === "unrelated") ||
        (filter === "available" &&
          item.relationship === "unrelated" &&
          item.type === "sale" &&
          item.status === "listed") ||
        (filter === "related" && item.relationship !== "unrelated");

      if (!matchesFilter) return false;
      if (!query) return true;

      return (
        item.gameTitle.toLowerCase().includes(query) ||
        item.seller.toLowerCase().includes(query)
      );
    });
  }, [data?.items, filter, search]);

  const openItem = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {});
  }, []);

  return (
    <>
      <Stack.Screen options={{ title: "Browse VFM" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text
              style={[styles.helperText, { color: colors.mutedForeground }]}
            >
              Loading VFM items A-Z...
            </Text>
          </View>
        ) : (
          <FlatList
            data={visibleItems}
            keyExtractor={(item) => item.id}
            contentContainerStyle={[
              styles.listContent,
              { paddingBottom: insets.bottom + 24 },
            ]}
            ListHeaderComponent={
              <View style={styles.headerWrap}>
                <Text style={[styles.pageTitle, { color: colors.foreground }]}>
                  Browse VFM Items
                </Text>
                <Text
                  style={[
                    styles.pageSubtitle,
                    { color: colors.mutedForeground },
                  ]}
                >
                  {data?.listTitle ?? "BGG Geeklist"}
                </Text>
                <View style={styles.summaryRow}>
                  <Text
                    style={[
                      styles.summaryText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {visibleItems.length} shown
                  </Text>
                  <Text
                    style={[
                      styles.summaryText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {data?.totalItems ?? 0} total
                  </Text>
                  <Text
                    style={[
                      styles.summaryText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    A-Z by title
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.refreshBtn,
                    { backgroundColor: colors.primary },
                  ]}
                  onPress={() => load(true)}
                  disabled={isRefreshing}
                  activeOpacity={0.8}
                >
                  {isRefreshing ? (
                    <ActivityIndicator
                      color={colors.primaryForeground}
                      size="small"
                    />
                  ) : (
                    <Feather
                      name="refresh-cw"
                      size={16}
                      color={colors.primaryForeground}
                    />
                  )}
                  <Text
                    style={[
                      styles.refreshText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    Refresh
                  </Text>
                </TouchableOpacity>

                {error ? (
                  <Text
                    style={[styles.errorText, { color: colors.destructive }]}
                  >
                    {error}
                  </Text>
                ) : null}

                <View
                  style={[
                    styles.searchBar,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Feather
                    name="search"
                    size={16}
                    color={colors.mutedForeground}
                  />
                  <TextInput
                    style={[styles.searchInput, { color: colors.foreground }]}
                    placeholder="Search games or sellers..."
                    placeholderTextColor={colors.mutedForeground}
                    value={search}
                    onChangeText={setSearch}
                    autoCapitalize="none"
                  />
                  {search.length > 0 ? (
                    <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
                      <Feather
                        name="x-circle"
                        size={16}
                        color={colors.mutedForeground}
                      />
                    </TouchableOpacity>
                  ) : null}
                </View>

                <View style={styles.filterRow}>
                  {(
                    [
                      "unrelated",
                      "available",
                      "all",
                      "related",
                    ] as BrowseFilter[]
                  ).map((f) => {
                    const isActive = filter === f;

                    return (
                      <TouchableOpacity
                        key={f}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: isActive
                              ? colors.primary
                              : colors.secondary,
                            borderColor: isActive
                              ? colors.primary
                              : colors.border,
                          },
                        ]}
                        onPress={() => setFilter(f)}
                        activeOpacity={0.8}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            {
                              color: isActive
                                ? colors.primaryForeground
                                : colors.foreground,
                            },
                          ]}
                        >
                          {FILTER_LABELS[f]}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            }
            renderItem={({ item }) => {
              const isUnavailable =
                item.status !== "listed" || item.type !== "sale";
              const relationColor =
                item.relationship === "unrelated"
                  ? colors.info
                  : item.relationship === "purchased"
                    ? colors.success
                    : item.relationship === "offer" ||
                        item.relationship === "auction"
                      ? colors.warning
                      : colors.primary;

              return (
                <TouchableOpacity
                  style={[
                    styles.card,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      opacity: isUnavailable ? 0.72 : 1,
                    },
                  ]}
                  onPress={() => openItem(item.bggUrl)}
                  activeOpacity={0.7}
                >
                  <View style={styles.cardHeader}>
                    <Text
                      style={[styles.cardTitle, { color: colors.foreground }]}
                      numberOfLines={2}
                    >
                      {item.gameTitle}
                    </Text>
                    <Feather
                      name="external-link"
                      size={13}
                      color={colors.mutedForeground}
                    />
                  </View>

                  <View style={styles.badgeRow}>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: relationColor + "18",
                          borderColor: relationColor + "55",
                        },
                      ]}
                    >
                      <Text
                        style={[styles.badgeText, { color: relationColor }]}
                      >
                        {RELATIONSHIP_LABELS[item.relationship]}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.badge,
                        {
                          backgroundColor: colors.secondary,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Text
                        style={[styles.badgeText, { color: colors.foreground }]}
                      >
                        {item.status === "listed" ? "Listed" : item.status}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.metaRow}>
                    <Text
                      style={[styles.priceText, { color: colors.foreground }]}
                    >
                      {money(item.price)}
                    </Text>
                    <Text
                      style={[
                        styles.metaText,
                        { color: colors.mutedForeground },
                      ]}
                      numberOfLines={1}
                    >
                      Seller: {item.seller || "Unknown"}
                    </Text>
                  </View>

                  {item.condition ? (
                    <Text
                      style={[
                        styles.conditionText,
                        { color: colors.mutedForeground },
                      ]}
                      numberOfLines={2}
                    >
                      Condition: {item.condition}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              !error ? (
                <View style={styles.centerState}>
                  <Text
                    style={[styles.emptyTitle, { color: colors.foreground }]}
                  >
                    No Items Found
                  </Text>
                  <Text
                    style={[
                      styles.helperText,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    Try another filter or search term.
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
    gap: 10,
  },
  pageTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  pageSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  summaryText: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  refreshBtn: {
    marginTop: 4,
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
  searchBar: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 21,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  badge: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    textTransform: "capitalize",
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  priceText: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  metaText: {
    flex: 1,
    textAlign: "right",
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  conditionText: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
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
