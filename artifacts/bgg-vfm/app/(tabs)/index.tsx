import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AddEditModal } from "@/components/AddEditModal";
import { GameRow } from "@/components/GameRow";
import { SettingsModal } from "@/components/SettingsModal";
import { StatCard } from "@/components/StatCard";
import { Game, useVFM } from "@/context/VFMContext";
import { useColors } from "@/hooks/useColors";

type FilterType = "all" | "listed" | "sold" | "purchase" | "offer" | "winning" | "outbid";
type SortType = "listing" | "title" | "username";

function extractListingNumber(game: Game): number | null {
  const urlMatch = game.bggUrl?.match(/\/item\/(\d+)/i);
  if (urlMatch?.[1]) return Number(urlMatch[1]);

  const idMatch = game.id.match(/^bgg_(\d+)$/);
  if (idMatch?.[1]) return Number(idMatch[1]);

  return null;
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { games, stats, lastSyncedAt, syncFromBgg, isSyncing, bggSettings } = useVFM();
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortType>("listing");
  const [search, setSearch] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const filtered = games.filter((g) => {
    let matchFilter = true;
    if (filter === "listed") matchFilter = g.type === "sale" && g.status === "listed";
    else if (filter === "sold") matchFilter = g.type === "sale" && g.status === "sold";
    else if (filter === "purchase") matchFilter = g.type === "purchase";
    else if (filter === "offer") matchFilter = g.type === "offer";
    else if (filter === "winning") matchFilter = g.type === "auction" && g.auctionStatus === "winning";
    else if (filter === "outbid") matchFilter = g.type === "auction" && g.auctionStatus === "outbid";
    const matchSearch =
      search.length === 0 ||
      g.title.toLowerCase().includes(search.toLowerCase()) ||
      (g.buyerSeller ?? "").toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const sortedFiltered = useMemo(() => {
    const rows = [...filtered];
    rows.sort((a, b) => {
      if (sortBy === "username") {
        const aUser = (a.buyerSeller ?? "").trim();
        const bUser = (b.buyerSeller ?? "").trim();

        if (!aUser && !bUser) {
          return a.title.localeCompare(b.title, undefined, {
            sensitivity: "base",
            numeric: true,
          });
        }
        if (!aUser) return 1;
        if (!bUser) return -1;

        const userCmp = aUser.localeCompare(bUser, undefined, {
          sensitivity: "base",
          numeric: true,
        });
        if (userCmp !== 0) return userCmp;

        return a.title.localeCompare(b.title, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      }

      if (sortBy === "title") {
        return a.title.localeCompare(b.title, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      }

      const aNumber = extractListingNumber(a);
      const bNumber = extractListingNumber(b);

      if (aNumber === null && bNumber === null) {
        return a.title.localeCompare(b.title, undefined, {
          sensitivity: "base",
          numeric: true,
        });
      }
      if (aNumber === null) return 1;
      if (bNumber === null) return -1;
      if (aNumber !== bNumber) return aNumber - bNumber;

      return a.title.localeCompare(b.title, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
    return rows;
  }, [filtered, sortBy]);

  const handleEdit = (game: Game) => {
    setEditGame(game);
    setAddModalVisible(true);
  };

  const handleAdd = () => {
    setEditGame(null);
    setAddModalVisible(true);
  };

  const handleRefresh = async () => {
    if (!bggSettings.username) {
      setSettingsVisible(true);
      return;
    }
    try {
      await syncFromBgg();
    } catch (err: any) {
      Alert.alert("Sync Failed", err.message ?? "Could not sync from BGG.");
    }
  };

  const syncLabel = lastSyncedAt
    ? `Synced ${new Date(lastSyncedAt).toLocaleDateString()} ${new Date(lastSyncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : null;

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
        <View style={styles.headerLeft}>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Spring 2026
          </Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            BGG VFM Tracker
          </Text>
          {syncLabel ? (
            <Text style={[styles.syncLabel, { color: colors.mutedForeground }]}>
              {syncLabel}
            </Text>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.secondary }]}
            onPress={() => setSettingsVisible(true)}
            activeOpacity={0.8}
          >
            <Feather name="settings" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.secondary }]}
            onPress={() => router.push("/wishlist")}
            activeOpacity={0.8}
          >
            <Feather name="heart" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.secondary }]}
            onPress={() => router.push("/for-trade" as any)}
            activeOpacity={0.8}
          >
            <Feather name="repeat" size={18} color={colors.foreground} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.secondary, opacity: isSyncing ? 0.5 : 1 }]}
            onPress={handleRefresh}
            disabled={isSyncing}
            activeOpacity={0.8}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <Feather name="refresh-cw" size={18} color={colors.foreground} />
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.iconBtn, { backgroundColor: colors.primary }]}
            onPress={handleAdd}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={sortedFiltered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPad + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={true}
        ListHeaderComponent={
          <>
            <Text style={[styles.dashboardTitle, { color: colors.foreground }]}>
              Dashboard
            </Text>

            <View style={styles.statsGrid}>
              <StatCard
                label="Listed for Sale"
                value={stats.listedCount}
                sub="active listings"
                accent="info"
              />
              <StatCard
                label="Games Sold"
                value={stats.soldCount}
                sub="completed sales"
                accent="success"
              />
              <StatCard
                label="Games Purchased"
                value={stats.purchasedCount}
                sub="acquisitions"
                accent="warning"
              />
              <StatCard
                label="Offers"
                value={stats.offerCount}
                sub="awaiting confirmation"
                accent="info"
              />
              <StatCard
                label="Auctions Winning"
                value={stats.winningCount}
                sub="currently highest bidder"
                accent="success"
              />
              <StatCard
                label="Auctions Outbid"
                value={stats.outbidCount}
                sub="someone bid higher"
                accent="destructive"
              />
              <StatCard
                label="Amount Owed"
                value={`$${stats.amountOwed.toFixed(2)}`}
                sub="total owed for purchases"
                accent="destructive"
              />
              <StatCard
                label="Amount Earned"
                value={`$${stats.amountEarned.toFixed(2)}`}
                sub="from completed sales"
                accent="success"
              />
            </View>

            {games.length === 0 ? (
              <View style={[styles.emptySync, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="refresh-cw" size={20} color={colors.accent} />
                <Text style={[styles.emptySyncTitle, { color: colors.foreground }]}>
                  Sync from BGG
                </Text>
                <Text style={[styles.emptySyncText, { color: colors.mutedForeground }]}>
                  Tap the settings icon to connect your BGG account and import your VFM listings automatically.
                </Text>
                <TouchableOpacity
                  style={[styles.emptySyncBtn, { backgroundColor: colors.primary }]}
                  onPress={() => setSettingsVisible(true)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.emptySyncBtnText, { color: colors.primaryForeground }]}>
                    Open Settings
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View
                  style={[
                    styles.searchBar,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Feather name="search" size={16} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.searchInput, { color: colors.foreground }]}
                    placeholder="Search games or users..."
                    placeholderTextColor={colors.mutedForeground}
                    value={search}
                    onChangeText={setSearch}
                  />
                  {search.length > 0 && (
                    <TouchableOpacity onPress={() => setSearch("")} hitSlop={8}>
                      <Feather name="x-circle" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>

                <View style={styles.filterRow}>
                  {(["all", "listed", "sold", "purchase", "offer", "winning", "outbid"] as FilterType[]).map((f) => {
                    const label =
                      f === "all" ? "All" :
                      f === "listed" ? "Listed" :
                      f === "sold" ? "Sold" :
                      f === "purchase" ? "Purchased" :
                      f === "offer" ? "Offers" :
                      f === "winning" ? "Winning" : "Outbid";
                    const isAuctionTab = f === "winning" || f === "outbid";
                    const activeColor = f === "offer"
                      ? colors.info
                      : isAuctionTab
                      ? (f === "winning" ? colors.success : colors.destructive)
                      : colors.primary;
                    const isActive = filter === f;
                    return (
                      <TouchableOpacity
                        key={f}
                        style={[
                          styles.filterChip,
                          {
                            backgroundColor: isActive ? activeColor : colors.secondary,
                            borderColor: isActive ? activeColor : colors.border,
                          },
                        ]}
                        onPress={() => setFilter(f)}
                      >
                        <Text
                          style={[
                            styles.filterChipText,
                            {
                              color: isActive ? colors.primaryForeground : colors.foreground,
                            },
                          ]}
                        >
                          {label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View style={styles.sortSection}>
                  <Text style={[styles.sortLabel, { color: colors.mutedForeground }]}>
                    Sort by
                  </Text>
                  <View style={styles.sortRow}>
                    <TouchableOpacity
                      style={[
                        styles.sortChip,
                        {
                          backgroundColor: sortBy === "listing" ? colors.primary : colors.secondary,
                          borderColor: sortBy === "listing" ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setSortBy("listing")}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.sortChipText,
                          {
                            color:
                              sortBy === "listing" ? colors.primaryForeground : colors.foreground,
                          },
                        ]}
                      >
                        Listing #
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.sortChip,
                        {
                          backgroundColor: sortBy === "title" ? colors.primary : colors.secondary,
                          borderColor: sortBy === "title" ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setSortBy("title")}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.sortChipText,
                          {
                            color: sortBy === "title" ? colors.primaryForeground : colors.foreground,
                          },
                        ]}
                      >
                        Title
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.sortChip,
                        {
                          backgroundColor: sortBy === "username" ? colors.primary : colors.secondary,
                          borderColor: sortBy === "username" ? colors.primary : colors.border,
                        },
                      ]}
                      onPress={() => setSortBy("username")}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.sortChipText,
                          {
                            color:
                              sortBy === "username" ? colors.primaryForeground : colors.foreground,
                          },
                        ]}
                      >
                        BGG User
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

                {sortedFiltered.length === 0 && search.length > 0 && (
                  <View style={styles.empty}>
                    <Feather name="search" size={36} color={colors.mutedForeground} />
                    <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                      No results
                    </Text>
                    <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                      No games matched your search
                    </Text>
                  </View>
                )}
              </>
            )}
          </>
        }
        renderItem={({ item }) => (
          <GameRow game={item} onEdit={handleEdit} />
        )}
      />

      <AddEditModal
        visible={addModalVisible}
        editGame={editGame}
        onClose={() => {
          setAddModalVisible(false);
          setEditGame(null);
        }}
      />

      <SettingsModal
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        onSyncComplete={() => setSettingsVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerLeft: { flex: 1 },
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
  syncLabel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  list: { padding: 16 },
  statsGrid: { marginBottom: 20 },
  dashboardTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 14,
  },
  emptySync: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    alignItems: "center",
    gap: 8,
    marginBottom: 16,
  },
  emptySyncTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    marginTop: 4,
  },
  emptySyncText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 18,
  },
  emptySyncBtn: {
    marginTop: 8,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  emptySyncBtnText: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    marginBottom: 12,
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
    marginBottom: 12,
  },
  sortSection: {
    marginBottom: 16,
    gap: 8,
  },
  sortLabel: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  sortRow: {
    flexDirection: "row",
    gap: 8,
  },
  sortChip: {
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  sortChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  filterChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  filterChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
  empty: {
    alignItems: "center",
    paddingTop: 40,
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
