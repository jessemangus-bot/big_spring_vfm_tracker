import { Feather } from "@expo/vector-icons";
import { getBaseUrl } from "@workspace/api-client-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Linking,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppFooter } from "@/components/AppFooter";
import { useColors } from "@/hooks/useColors";

interface DealItem {
  id: string;
  retailer: string;
  title: string;
  salePrice: number;
  originalPrice?: number;
  discountPercent?: number;
  imageUrl?: string;
  url: string;
}

interface DealsResponse {
  items: DealItem[];
  fetchedAt: string;
  cached: boolean;
}

export default function DealsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DealsResponse | null>(null);
  const [selectedRetailer, setSelectedRetailer] = useState<string | null>(null);

  const retailers = useMemo(() => {
    if (!data) return [];
    const seen = new Set<string>();
    for (const item of data.items) seen.add(item.retailer);
    return Array.from(seen).sort();
  }, [data]);

  const visibleDeals = useMemo(() => {
    if (!data) return [];
    if (!selectedRetailer) return data.items;
    return data.items.filter((d) => d.retailer === selectedRetailer);
  }, [data, selectedRetailer]);

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setIsRefreshing(true);
    else setIsLoading(true);
    setError(null);

    try {
      const base = getBaseUrl();
      const resp = await fetch(`${base}/api/deals`);
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      const payload = (await resp.json()) as DealsResponse;
      setData(payload);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load deals.");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  const formatPrice = (price: number) =>
    price.toLocaleString("en-US", { style: "currency", currency: "USD" });

  const formatAge = (fetchedAt: string) => {
    const diffMs = Date.now() - Date.parse(fetchedAt);
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    return `${Math.floor(diffMin / 60)}h ago`;
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {isLoading ? (
        <View style={[styles.center, { paddingTop: topPad + 60 }]}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
            Fetching deals...
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleDeals}
          keyExtractor={(item) => item.id}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => load(true)}
              tintColor={colors.accent}
            />
          }
          contentContainerStyle={[
            styles.listContent,
            { paddingTop: topPad + 8, paddingBottom: insets.bottom + 80 },
          ]}
          ListHeaderComponent={
            <View style={styles.headerWrap}>
              <Text style={[styles.pageTitle, { color: colors.foreground }]}>
                Game Deals
              </Text>
              {data ? (
                <Text style={[styles.pageSubtitle, { color: colors.mutedForeground }]}>
                  {data.items.length} deals · updated {formatAge(data.fetchedAt)}
                </Text>
              ) : null}

              {error ? (
                <View style={[styles.errorBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="alert-circle" size={14} color={colors.destructive} />
                  <Text style={[styles.errorText, { color: colors.destructive }]}>
                    {error}
                  </Text>
                </View>
              ) : null}

              {retailers.length > 1 ? (
                <View style={styles.filterRow}>
                  <TouchableOpacity
                    style={[
                      styles.filterChip,
                      {
                        backgroundColor: !selectedRetailer ? colors.primary : colors.card,
                        borderColor: !selectedRetailer ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setSelectedRetailer(null)}
                    activeOpacity={0.75}
                  >
                    <Text
                      style={[
                        styles.filterChipText,
                        { color: !selectedRetailer ? colors.primaryForeground : colors.foreground },
                      ]}
                    >
                      All
                    </Text>
                  </TouchableOpacity>
                  {retailers.map((retailer) => (
                    <TouchableOpacity
                      key={retailer}
                      style={[
                        styles.filterChip,
                        {
                          backgroundColor: selectedRetailer === retailer ? colors.primary : colors.card,
                          borderColor: selectedRetailer === retailer ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() =>
                        setSelectedRetailer((prev) => (prev === retailer ? null : retailer))
                      }
                      activeOpacity={0.75}
                    >
                      <Text
                        style={[
                          styles.filterChipText,
                          { color: selectedRetailer === retailer ? colors.primaryForeground : colors.foreground },
                        ]}
                      >
                        {retailer}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => Linking.openURL(item.url).catch(() => {})}
              activeOpacity={0.75}
            >
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={styles.thumbnail}
                  resizeMode="cover"
                />
              ) : (
                <View style={[styles.thumbnailFallback, { backgroundColor: colors.secondary }]}>
                  <Feather name="package" size={22} color={colors.mutedForeground} />
                </View>
              )}
              <View style={styles.cardBody}>
                <View style={styles.cardTop}>
                  <View
                    style={[styles.retailerBadge, { backgroundColor: colors.secondary, borderColor: colors.border }]}
                  >
                    <Text style={[styles.retailerText, { color: colors.mutedForeground }]}>
                      {item.retailer}
                    </Text>
                  </View>
                  {item.discountPercent ? (
                    <View style={[styles.discountBadge, { backgroundColor: colors.success }]}>
                      <Text style={styles.discountText}>-{item.discountPercent}%</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>
                  {item.title}
                </Text>
                <View style={styles.priceRow}>
                  <Text style={[styles.salePrice, { color: colors.accent }]}>
                    {formatPrice(item.salePrice)}
                  </Text>
                  {item.originalPrice ? (
                    <Text style={[styles.originalPrice, { color: colors.mutedForeground }]}>
                      {formatPrice(item.originalPrice)}
                    </Text>
                  ) : null}
                </View>
              </View>
              <Feather name="external-link" size={14} color={colors.mutedForeground} style={styles.externalIcon} />
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !error ? (
              <View style={styles.center}>
                <Feather name="tag" size={32} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                  No Deals Found
                </Text>
                <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
                  Pull down to refresh, or check back later.
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={<AppFooter />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listContent: {
    padding: 16,
    gap: 10,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 48,
    paddingHorizontal: 24,
    gap: 10,
  },
  headerWrap: {
    marginBottom: 12,
    gap: 6,
  },
  pageTitle: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
  },
  pageSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginTop: 4,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  card: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 12,
    alignItems: "flex-start",
  },
  thumbnail: {
    width: 70,
    height: 70,
    borderRadius: 8,
    flexShrink: 0,
  },
  thumbnailFallback: {
    width: 70,
    height: 70,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  cardBody: {
    flex: 1,
    gap: 5,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  retailerBadge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  retailerText: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
  },
  discountBadge: {
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  discountText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    color: "#ffffff",
  },
  cardTitle: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 19,
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  salePrice: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  originalPrice: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textDecorationLine: "line-through",
  },
  externalIcon: {
    marginTop: 4,
    flexShrink: 0,
  },
  emptyTitle: {
    fontSize: 17,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  helperText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
});
