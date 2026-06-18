import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Game, useVFM } from "@/context/VFMContext";
import { useColors } from "@/hooks/useColors";

interface UserBalance {
  username: string;
  earned: number;
  owed: number;
  delta: number;
  soldCount: number;
  purchaseCount: number;
  items: ExchangeItem[];
}

interface ExchangeItem {
  id: string;
  title: string;
  price: number;
  direction: "sold" | "purchased";
  bggUrl?: string;
}

const SETTLED_USERS_KEY = "bgg_vfm_settled_users_v1";
const ADVANCE_PAID_USERS_KEY = "bgg_vfm_advance_paid_users_v1";

function getUser(game: Game) {
  const user = game.buyerSeller?.trim();
  return user && user.length > 0 ? user : "Unknown user";
}

function money(value: number) {
  return `$${Math.abs(value).toFixed(2)}`;
}

function openBggUrl(url: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("Could not open link", url);
  });
}

function parseUserFlagMap(raw: string | null): Record<string, boolean> {
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(([, value]) => value === true)
    ) as Record<string, boolean>;
  } catch {
    return {};
  }
}

export default function BalancesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { games } = useVFM();
  const [settledUsers, setSettledUsers] = useState<Record<string, boolean>>({});
  const [advancePaidUsers, setAdvancePaidUsers] = useState<Record<string, boolean>>({});

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(SETTLED_USERS_KEY),
      AsyncStorage.getItem(ADVANCE_PAID_USERS_KEY),
    ]).then(([rawSettled, rawAdvancePaid]) => {
      setSettledUsers(parseUserFlagMap(rawSettled));
      setAdvancePaidUsers(parseUserFlagMap(rawAdvancePaid));
    });
  }, []);

  const toggleSettled = useCallback((username: string) => {
    const key = username.toLowerCase();
    setSettledUsers((current) => {
      const next = { ...current, [key]: !current[key] };
      if (!next[key]) delete next[key];
      AsyncStorage.setItem(SETTLED_USERS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleAdvancePaid = useCallback((username: string) => {
    const key = username.toLowerCase();
    setAdvancePaidUsers((current) => {
      const next = { ...current, [key]: !current[key] };
      if (!next[key]) delete next[key];
      AsyncStorage.setItem(ADVANCE_PAID_USERS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const balances = useMemo(() => {
    const byUser = new Map<string, UserBalance>();

    games.forEach((game) => {
      const isEarnedSale = game.type === "sale" && game.status === "sold";
      const isOwedPurchase = game.type === "purchase";
      if (!isEarnedSale && !isOwedPurchase) return;

      const username = getUser(game);
      const key = username.toLowerCase();
      const current =
        byUser.get(key) ??
        {
          username,
          earned: 0,
          owed: 0,
          delta: 0,
          soldCount: 0,
          purchaseCount: 0,
          items: [],
        };

      if (isEarnedSale) {
        current.earned += game.price;
        current.soldCount += 1;
        current.items.push({
          id: game.id,
          title: game.title,
          price: game.price,
          direction: "sold",
          bggUrl: game.bggUrl,
        });
      } else {
        current.owed += game.price;
        current.purchaseCount += 1;
        current.items.push({
          id: game.id,
          title: game.title,
          price: game.price,
          direction: "purchased",
          bggUrl: game.bggUrl,
        });
      }

      current.delta = current.earned - current.owed;
      byUser.set(key, current);
    });

    return Array.from(byUser.values())
      .map((user) => ({
        ...user,
        items: user.items.sort((a, b) => {
          if (a.direction !== b.direction) {
            return a.direction === "sold" ? -1 : 1;
          }

          return a.title.localeCompare(b.title, undefined, {
            sensitivity: "base",
            numeric: true,
          });
        }),
      }))
      .sort((a, b) =>
        a.username.localeCompare(b.username, undefined, {
          sensitivity: "base",
          numeric: true,
        })
      );
  }, [games]);

  const totals = useMemo(
    () =>
      balances.reduce(
        (sum, user) => ({
          earned: sum.earned + user.earned,
          owed: sum.owed + user.owed,
          delta: sum.delta + user.delta,
        }),
        { earned: 0, owed: 0, delta: 0 }
      ),
    [balances]
  );

  const renderBalance = ({ item }: { item: UserBalance }) => {
    const isPositive = item.delta > 0;
    const isNegative = item.delta < 0;
    const isSettled = !!settledUsers[item.username.toLowerCase()];
    const isAdvancePaid = !!advancePaidUsers[item.username.toLowerCase()];
    const deltaColor = isPositive
      ? colors.success
      : isNegative
      ? colors.destructive
      : colors.mutedForeground;
    const deltaLabel = isPositive
      ? "They owe you"
      : isNegative
      ? "You owe them"
      : "Settled";

    return (
      <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={[styles.avatar, { backgroundColor: colors.secondary }]}>
          <Feather name="user" size={18} color={colors.foreground} />
        </View>

        <View style={styles.rowMain}>
          <View style={styles.rowHeader}>
            <Text style={[styles.username, { color: colors.foreground }]} numberOfLines={1}>
              {item.username}
            </Text>
            <Text style={[styles.delta, { color: deltaColor }]}>
              {item.delta < 0 ? "-" : ""}{money(item.delta)}
            </Text>
          </View>

          <Text style={[styles.deltaLabel, { color: deltaColor }]}>
            {deltaLabel}
          </Text>

          <View style={styles.statusControls}>
            <TouchableOpacity
              style={styles.statusToggle}
              onPress={() => toggleSettled(item.username)}
              activeOpacity={0.75}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSettled }}
              accessibilityLabel={`Mark exchange with ${item.username} as made`}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: isSettled ? colors.success : colors.card,
                    borderColor: isSettled ? colors.success : colors.border,
                  },
                ]}
              >
                {isSettled ? (
                  <Feather name="check" size={14} color={colors.primaryForeground} />
                ) : null}
              </View>
              <Text
                style={[
                  styles.statusToggleText,
                  { color: isSettled ? colors.success : colors.mutedForeground },
                ]}
              >
                Exchange made
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.statusToggle}
              onPress={() => toggleAdvancePaid(item.username)}
              activeOpacity={0.75}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isAdvancePaid }}
              accessibilityLabel={`Mark payment with ${item.username} as paid in advance`}
            >
              <View
                style={[
                  styles.checkbox,
                  {
                    backgroundColor: isAdvancePaid ? colors.success : colors.card,
                    borderColor: isAdvancePaid ? colors.success : colors.border,
                  },
                ]}
              >
                {isAdvancePaid ? (
                  <Feather name="check" size={14} color={colors.primaryForeground} />
                ) : null}
              </View>
              <Text
                style={[
                  styles.statusToggleText,
                  { color: isAdvancePaid ? colors.success : colors.mutedForeground },
                ]}
              >
                Paid in advance
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.amountGrid}>
            <View style={[styles.amountPill, { backgroundColor: colors.success + "16" }]}>
              <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>
                Earned
              </Text>
              <Text style={[styles.amountValue, { color: colors.success }]}>
                {money(item.earned)}
              </Text>
            </View>
            <View style={[styles.amountPill, { backgroundColor: colors.destructive + "14" }]}>
              <Text style={[styles.amountLabel, { color: colors.mutedForeground }]}>
                Owed
              </Text>
              <Text style={[styles.amountValue, { color: colors.destructive }]}>
                {money(item.owed)}
              </Text>
            </View>
          </View>

          <Text style={[styles.counts, { color: colors.mutedForeground }]}>
            {item.soldCount} sold · {item.purchaseCount} purchased
          </Text>

          <View style={[styles.exchangeList, { borderTopColor: colors.border }]}>
            {item.items.map((exchange) => {
              const isSold = exchange.direction === "sold";
              const accentColor = isSold ? colors.success : colors.destructive;
              const content = (
                <>
                  <View
                    style={[
                      styles.exchangeIcon,
                      { backgroundColor: accentColor + "18" },
                    ]}
                  >
                    <Feather
                      name={isSold ? "arrow-down-left" : "arrow-up-right"}
                      size={13}
                      color={accentColor}
                    />
                  </View>
                  <View style={styles.exchangeInfo}>
                    <Text
                      style={[styles.exchangeTitle, { color: colors.foreground }]}
                      numberOfLines={1}
                    >
                      {exchange.title}
                    </Text>
                    <Text style={[styles.exchangeMeta, { color: colors.mutedForeground }]}>
                      {isSold ? "You receive payment" : "You pick up"} · {money(exchange.price)}
                    </Text>
                  </View>
                  {exchange.bggUrl ? (
                    <Feather
                      name="external-link"
                      size={12}
                      color={colors.mutedForeground}
                    />
                  ) : null}
                </>
              );

              if (exchange.bggUrl) {
                return (
                  <TouchableOpacity
                    key={exchange.id}
                    style={styles.exchangeRow}
                    onPress={() => openBggUrl(exchange.bggUrl!)}
                    activeOpacity={0.65}
                  >
                    {content}
                  </TouchableOpacity>
                );
              }

              return (
                <View key={exchange.id} style={styles.exchangeRow}>
                  {content}
                </View>
              );
            })}
          </View>
        </View>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
          Sales Settlement
        </Text>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>
          Balances by User
        </Text>
      </View>

      <FlatList
        data={balances}
        keyExtractor={(item) => item.username}
        renderItem={renderBalance}
        contentContainerStyle={[styles.list, { paddingBottom: bottomPad + 100 }]}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <View style={[styles.summary, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View>
                <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>
                  Net Delta
                </Text>
                <Text
                  style={[
                    styles.summaryDelta,
                    {
                      color:
                        totals.delta > 0
                          ? colors.success
                          : totals.delta < 0
                          ? colors.destructive
                          : colors.foreground,
                    },
                  ]}
                >
                  {totals.delta < 0 ? "-" : ""}{money(totals.delta)}
                </Text>
              </View>
              <View style={styles.summaryTotals}>
                <Text style={[styles.summaryText, { color: colors.success }]}>
                  Earned {money(totals.earned)}
                </Text>
                <Text style={[styles.summaryText, { color: colors.destructive }]}>
                  Owed {money(totals.owed)}
                </Text>
              </View>
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Feather name="users" size={36} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No settled sales yet
            </Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              Sold games and purchases with a BGG user will appear here.
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerSub: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
  },
  list: {
    padding: 16,
  },
  summary: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    marginBottom: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 16,
  },
  summaryLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  summaryDelta: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginTop: 2,
  },
  summaryTotals: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 4,
  },
  summaryText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  row: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 12,
    marginBottom: 10,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  rowMain: {
    flex: 1,
    gap: 8,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  username: {
    flex: 1,
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  delta: {
    fontSize: 16,
    fontFamily: "Inter_700Bold",
  },
  deltaLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  statusControls: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 28,
  },
  statusToggleText: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  amountGrid: {
    flexDirection: "row",
    gap: 8,
  },
  amountPill: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  amountLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  amountValue: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
  },
  counts: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  exchangeList: {
    borderTopWidth: 1,
    paddingTop: 8,
    gap: 8,
  },
  exchangeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 34,
  },
  exchangeIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  exchangeInfo: {
    flex: 1,
  },
  exchangeTitle: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  exchangeMeta: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 1,
  },
  empty: {
    alignItems: "center",
    paddingTop: 48,
    gap: 8,
    paddingHorizontal: 32,
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
});
