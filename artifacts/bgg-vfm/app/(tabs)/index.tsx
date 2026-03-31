import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AddEditModal } from "@/components/AddEditModal";
import { GameRow } from "@/components/GameRow";
import { StatCard } from "@/components/StatCard";
import { Game, useVFM } from "@/context/VFMContext";
import { useColors } from "@/hooks/useColors";

type FilterType = "all" | "sale" | "purchase";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { games, stats } = useVFM();
  const [modalVisible, setModalVisible] = useState(false);
  const [editGame, setEditGame] = useState<Game | null>(null);
  const [filter, setFilter] = useState<FilterType>("all");
  const [search, setSearch] = useState("");

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const filtered = games.filter((g) => {
    const matchFilter = filter === "all" || g.type === filter;
    const matchSearch =
      search.length === 0 ||
      g.title.toLowerCase().includes(search.toLowerCase()) ||
      (g.buyerSeller ?? "").toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const handleEdit = (game: Game) => {
    setEditGame(game);
    setModalVisible(true);
  };

  const handleAdd = () => {
    setEditGame(null);
    setModalVisible(true);
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
        <View>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Spring 2026
          </Text>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            BGG VFM Tracker
          </Text>
        </View>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={handleAdd}
          activeOpacity={0.8}
        >
          <Feather name="plus" size={20} color={colors.primaryForeground} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[
          styles.list,
          { paddingBottom: bottomPad + 100 },
        ]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={filtered.length > 0}
        ListHeaderComponent={
          <>
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

            <View
              style={[
                styles.searchBar,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
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
              {(["all", "sale", "purchase"] as FilterType[]).map((f) => (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor:
                        filter === f ? colors.primary : colors.secondary,
                      borderColor:
                        filter === f ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setFilter(f)}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      {
                        color:
                          filter === f
                            ? colors.primaryForeground
                            : colors.foreground,
                      },
                    ]}
                  >
                    {f === "all" ? "All" : f === "sale" ? "Sales" : "Purchases"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {filtered.length === 0 && (
              <View style={styles.empty}>
                <Feather
                  name="package"
                  size={40}
                  color={colors.mutedForeground}
                />
                <Text
                  style={[styles.emptyTitle, { color: colors.foreground }]}
                >
                  No entries yet
                </Text>
                <Text
                  style={[
                    styles.emptyText,
                    { color: colors.mutedForeground },
                  ]}
                >
                  Tap the + button to add your first game listing or purchase
                </Text>
              </View>
            )}
          </>
        }
        renderItem={({ item }) => (
          <GameRow game={item} onEdit={handleEdit} />
        )}
      />

      <AddEditModal
        visible={modalVisible}
        editGame={editGame}
        onClose={() => {
          setModalVisible(false);
          setEditGame(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
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
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  list: {
    padding: 16,
  },
  statsGrid: {
    marginBottom: 20,
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
    gap: 8,
    marginBottom: 16,
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
