import { Feather } from "@expo/vector-icons";
import React, { useMemo } from "react";
import {
  FlatList,
  Platform,
  StyleSheet,
  Text,
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
}

function getUser(game: Game) {
  const user = game.buyerSeller?.trim();
  return user && user.length > 0 ? user : "Unknown user";
}

function money(value: number) {
  return `$${Math.abs(value).toFixed(2)}`;
}

export default function BalancesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { games } = useVFM();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const balances = useMemo(() => {
    const byUser = new Map<string, UserBalance>();

    games.forEach((game) => {
      const isEarnedSale = game.type === "sale" && game.status === "sold";
      const isOwedPurchase = game.type === "purchase";
      if (!isEarnedSale && !isOwedPurchase) return;

      const username = getUser(game);
      const current =
        byUser.get(username) ??
        {
          username,
          earned: 0,
          owed: 0,
          delta: 0,
          soldCount: 0,
          purchaseCount: 0,
        };

      if (isEarnedSale) {
        current.earned += game.price;
        current.soldCount += 1;
      } else {
        current.owed += game.price;
        current.purchaseCount += 1;
      }

      current.delta = current.earned - current.owed;
      byUser.set(username, current);
    });

    return Array.from(byUser.values()).sort((a, b) =>
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
