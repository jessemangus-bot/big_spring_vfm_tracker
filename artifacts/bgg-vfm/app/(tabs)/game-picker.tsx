import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Feather } from "@expo/vector-icons";
import { getBaseUrl } from "@workspace/api-client-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useVFM } from "@/context/VFMContext";
import { useColors } from "@/hooks/useColors";

interface CollectionGame {
  objectId: string;
  title: string;
  thumbnail?: string;
  minPlayers?: number;
  maxPlayers?: number;
  baseMinPlayers?: number;
  baseMaxPlayers?: number;
  expansionPlayerRanges: { name: string; min: number; max: number }[];
  playTime?: number;
  weight?: number;
  categories: string[];
  mechanics: string[];
}

type PlayTimeFilter = "short" | "medium" | "long" | "verylong";
type ComplexityFilter = "light" | "medium" | "heavy" | "veryheavy";

interface ActiveFilters {
  players: number | null;
  playTime: PlayTimeFilter | null;
  complexity: ComplexityFilter | null;
  category: string | null;
  mechanic: string | null;
}

const PLAY_TIME_OPTIONS: { label: string; value: PlayTimeFilter }[] = [
  { label: "< 30 min", value: "short" },
  { label: "30–60 min", value: "medium" },
  { label: "1–2 hours", value: "long" },
  { label: "2+ hours", value: "verylong" },
];

const COMPLEXITY_OPTIONS: { label: string; value: ComplexityFilter }[] = [
  { label: "Light (≤ 2)", value: "light" },
  { label: "Medium (2–3)", value: "medium" },
  { label: "Heavy (3–4)", value: "heavy" },
  { label: "Very Heavy (4+)", value: "veryheavy" },
];

function playTimeLabel(v: PlayTimeFilter | null): string {
  return PLAY_TIME_OPTIONS.find((o) => o.value === v)?.label ?? "Any";
}

function complexityLabel(v: ComplexityFilter | null): string {
  return COMPLEXITY_OPTIONS.find((o) => o.value === v)?.label ?? "Any";
}

function filterGames(games: CollectionGame[], filters: ActiveFilters): CollectionGame[] {
  return games.filter((game) => {
    if (filters.players !== null) {
      const p = filters.players;
      if (p === 6) {
        if (!game.maxPlayers || game.maxPlayers < 6) return false;
      } else {
        if (!game.minPlayers || !game.maxPlayers) return false;
        if (p < game.minPlayers || p > game.maxPlayers) return false;
      }
    }
    if (filters.playTime !== null) {
      if (!game.playTime) return false;
      if (filters.playTime === "short" && game.playTime > 30) return false;
      if (filters.playTime === "medium" && (game.playTime < 30 || game.playTime > 60)) return false;
      if (filters.playTime === "long" && (game.playTime < 60 || game.playTime > 120)) return false;
      if (filters.playTime === "verylong" && game.playTime < 120) return false;
    }
    if (filters.complexity !== null) {
      if (!game.weight) return false;
      if (filters.complexity === "light" && game.weight >= 2) return false;
      if (filters.complexity === "medium" && (game.weight < 2 || game.weight >= 3)) return false;
      if (filters.complexity === "heavy" && (game.weight < 3 || game.weight >= 4)) return false;
      if (filters.complexity === "veryheavy" && game.weight < 4) return false;
    }
    if (filters.category !== null && !game.categories.includes(filters.category)) return false;
    if (filters.mechanic !== null && !game.mechanics.includes(filters.mechanic)) return false;
    return true;
  });
}

interface PickerModalProps {
  visible: boolean;
  title: string;
  options: { label: string; value: string | number }[];
  selected: string | number | null;
  onSelect: (v: string | number | null) => void;
  onClose: () => void;
}

function PickerModal({ visible, title, options, selected, onSelect, onClose }: PickerModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[pickerStyles.container, { backgroundColor: colors.background, paddingTop: insets.top + 16 }]}>
        <View style={[pickerStyles.header, { borderBottomColor: colors.border }]}>
          <Text style={[pickerStyles.title, { color: colors.foreground }]}>{title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
          <TouchableOpacity
            style={[pickerStyles.option, { borderBottomColor: colors.border }]}
            onPress={() => { onSelect(null); onClose(); }}
          >
            <Text style={[pickerStyles.optionText, { color: selected === null ? colors.accent : colors.foreground, fontFamily: selected === null ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
              Any
            </Text>
            {selected === null && <Feather name="check" size={16} color={colors.accent} />}
          </TouchableOpacity>
          {options.map((opt) => (
            <TouchableOpacity
              key={String(opt.value)}
              style={[pickerStyles.option, { borderBottomColor: colors.border }]}
              onPress={() => { onSelect(opt.value); onClose(); }}
            >
              <Text style={[pickerStyles.optionText, { color: selected === opt.value ? colors.accent : colors.foreground, fontFamily: selected === opt.value ? "Inter_600SemiBold" : "Inter_400Regular" }]}>
                {opt.label}
              </Text>
              {selected === opt.value && <Feather name="check" size={16} color={colors.accent} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  optionText: { fontSize: 16 },
});

interface FilterRowProps {
  label: string;
  value: string;
  onPress: () => void;
}

function FilterRow({ label, value, onPress }: FilterRowProps) {
  const colors = useColors();
  return (
    <TouchableOpacity
      style={[filterRowStyles.row, { borderColor: colors.border, backgroundColor: colors.card }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[filterRowStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={filterRowStyles.right}>
        <Text style={[filterRowStyles.value, { color: colors.foreground }]} numberOfLines={1}>{value}</Text>
        <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
      </View>
    </TouchableOpacity>
  );
}

const filterRowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  label: { fontSize: 14, fontFamily: "Inter_500Medium" },
  right: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1, justifyContent: "flex-end" },
  value: { fontSize: 14, fontFamily: "Inter_400Regular", maxWidth: 180 },
});

export default function GamePickerScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { bggSettings } = useVFM();

  const [games, setGames] = useState<CollectionGame[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CollectionGame | null>(null);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  const [filters, setFilters] = useState<ActiveFilters>({
    players: null,
    playTime: null,
    complexity: null,
    category: null,
    mechanic: null,
  });

  const [openPicker, setOpenPicker] = useState<keyof ActiveFilters | null>(null);

  const loadCollection = useCallback(async () => {
    if (!bggSettings.username) {
      setError("Set your BGG username in Settings first.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const base = getBaseUrl();
      const resp = await fetch(`${base}/api/bgg/my-collection?username=${encodeURIComponent(bggSettings.username)}`);
      if (resp.status === 202) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? "BGG is preparing your collection. Try again shortly.");
      }
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setGames(data.games ?? []);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load collection.");
    } finally {
      setIsLoading(false);
    }
  }, [bggSettings.username]);

  useEffect(() => { loadCollection(); }, [loadCollection]);

  const playerOptions = useMemo(() => {
    const counts = new Set<number>();
    for (const g of games) {
      if (g.minPlayers && g.maxPlayers) {
        for (let p = g.minPlayers; p <= Math.min(g.maxPlayers, 6); p++) counts.add(p);
      }
    }
    return [...counts].sort((a, b) => a - b).map((p) => ({
      label: p === 6 ? "6+" : String(p),
      value: p,
    }));
  }, [games]);

  const categoryOptions = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => g.categories.forEach((c) => set.add(c)));
    return [...set].sort().map((c) => ({ label: c, value: c }));
  }, [games]);

  const mechanicOptions = useMemo(() => {
    const set = new Set<string>();
    games.forEach((g) => g.mechanics.forEach((m) => set.add(m)));
    return [...set].sort().map((m) => ({ label: m, value: m }));
  }, [games]);

  const handleGo = () => {
    const filtered = filterGames(games, filters);
    setMatchCount(filtered.length);
    if (filtered.length === 0) {
      setResult(null);
      return;
    }
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    setResult(pick);
  };

  const handleRollAgain = () => {
    const filtered = filterGames(games, filters);
    if (filtered.length === 0) { setResult(null); return; }
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    setResult(pick);
  };

  const isFiltersActive = Object.values(filters).some((v) => v !== null);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.headerBar, { paddingTop: insets.top + 16, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Game Picker</Text>
        {isFiltersActive && (
          <TouchableOpacity
            hitSlop={8}
            onPress={() => setFilters({ players: null, playTime: null, complexity: null, category: null, mechanic: null })}
          >
            <Text style={[styles.clearBtn, { color: colors.accent }]}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
        keyboardShouldPersistTaps="handled"
      >
        {isLoading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.accent} size="large" />
            <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
              Loading your collection...
            </Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
            <TouchableOpacity
              style={[styles.retryBtn, { backgroundColor: colors.primary }]}
              onPress={loadCollection}
            >
              <Text style={[styles.retryBtnText, { color: colors.primaryForeground }]}>Try Again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              {games.length > 0 ? `${games.length} games in your collection` : "No games found"}
            </Text>

            <FilterRow
              label="Players"
              value={filters.players !== null ? (filters.players === 6 ? "6+" : String(filters.players)) : "Any"}
              onPress={() => setOpenPicker("players")}
            />
            <FilterRow
              label="Play Time"
              value={playTimeLabel(filters.playTime)}
              onPress={() => setOpenPicker("playTime")}
            />
            <FilterRow
              label="Complexity"
              value={complexityLabel(filters.complexity)}
              onPress={() => setOpenPicker("complexity")}
            />
            <FilterRow
              label="Category"
              value={filters.category ?? "Any"}
              onPress={() => setOpenPicker("category")}
            />
            <FilterRow
              label="Mechanic"
              value={filters.mechanic ?? "Any"}
              onPress={() => setOpenPicker("mechanic")}
            />

            {result && (
              <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {result.thumbnail ? (
                  <Image source={{ uri: result.thumbnail }} style={styles.resultImage} resizeMode="contain" />
                ) : (
                  <View style={[styles.resultImageFallback, { backgroundColor: colors.secondary }]}>
                    <MaterialCommunityIcons name="dice-6" size={40} color={colors.mutedForeground} />
                  </View>
                )}
                <Text style={[styles.resultTitle, { color: colors.foreground }]}>{result.title}</Text>

                <View style={styles.resultMeta}>
                  {result.minPlayers != null && result.maxPlayers != null && (
                    <View style={[styles.metaChip, { backgroundColor: colors.secondary }]}>
                      <Feather name="users" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>
                        {result.minPlayers === result.maxPlayers
                          ? `${result.minPlayers}`
                          : `${result.minPlayers}–${result.maxPlayers}`}
                      </Text>
                    </View>
                  )}
                  {result.playTime != null && result.playTime > 0 && (
                    <View style={[styles.metaChip, { backgroundColor: colors.secondary }]}>
                      <Feather name="clock" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>
                        {result.playTime >= 60
                          ? `${Math.round(result.playTime / 60 * 10) / 10}h`
                          : `${result.playTime}m`}
                      </Text>
                    </View>
                  )}
                  {result.weight != null && result.weight > 0 && (
                    <View style={[styles.metaChip, { backgroundColor: colors.secondary }]}>
                      <Feather name="activity" size={12} color={colors.mutedForeground} />
                      <Text style={[styles.metaChipText, { color: colors.mutedForeground }]}>
                        {result.weight.toFixed(1)}
                      </Text>
                    </View>
                  )}
                </View>

                {result.categories.length > 0 && (
                  <Text style={[styles.resultCategories, { color: colors.mutedForeground }]}>
                    {result.categories.slice(0, 3).join(" · ")}
                  </Text>
                )}

                {result.expansionPlayerRanges.length > 0 && (() => {
                  const selectedPlayers = filters.players;
                  const needsExpansion = selectedPlayers != null
                    ? selectedPlayers < (result.baseMinPlayers ?? Infinity) ||
                      selectedPlayers > (result.baseMaxPlayers ?? -Infinity)
                    : false;
                  if (!needsExpansion && result.baseMinPlayers != null && result.baseMaxPlayers != null) {
                    // Always show if range is extended, even with no player filter
                    const extendedMin = result.minPlayers ?? result.baseMinPlayers;
                    const extendedMax = result.maxPlayers ?? result.baseMaxPlayers;
                    if (extendedMin === result.baseMinPlayers && extendedMax === result.baseMaxPlayers) return null;
                  }
                  const names = result.expansionPlayerRanges.map((r) => r.name).join(", ");
                  const base = result.baseMinPlayers != null && result.baseMaxPlayers != null
                    ? `${result.baseMinPlayers}–${result.baseMaxPlayers}`
                    : null;
                  return (
                    <View style={[styles.expansionNote, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                      <Feather name="info" size={13} color={colors.mutedForeground} />
                      <Text style={[styles.expansionNoteText, { color: colors.mutedForeground }]}>
                        {base ? `Base game supports ${base} players. ` : ""}
                        {names} required for this player count.
                      </Text>
                    </View>
                  );
                })()}

                <View style={styles.resultActions}>
                  <TouchableOpacity
                    style={[styles.rollAgainBtn, { backgroundColor: colors.primary }]}
                    onPress={handleRollAgain}
                    activeOpacity={0.8}
                  >
                    <MaterialCommunityIcons name="dice-6" size={18} color={colors.primaryForeground} />
                    <Text style={[styles.rollAgainText, { color: colors.primaryForeground }]}>Roll Again</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.bggLink}
                    onPress={() => Linking.openURL(`https://boardgamegeek.com/boardgame/${result.objectId}`).catch(() => {})}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.bggLinkText, { color: colors.accent }]}>View on BGG</Text>
                  </TouchableOpacity>
                </View>

                {matchCount !== null && (
                  <Text style={[styles.matchCount, { color: colors.mutedForeground }]}>
                    {matchCount} game{matchCount !== 1 ? "s" : ""} match your filters
                  </Text>
                )}
              </View>
            )}

            {matchCount === 0 && (
              <View style={styles.centerState}>
                <Text style={[styles.noMatchText, { color: colors.foreground }]}>No matches</Text>
                <Text style={[styles.helperText, { color: colors.mutedForeground }]}>
                  Try broadening your filters.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* GO button */}
      {!isLoading && !error && games.length > 0 && (
        <View style={[styles.goBar, { paddingBottom: insets.bottom + 12, backgroundColor: colors.background, borderTopColor: colors.border }]}>
          <TouchableOpacity style={[styles.goBtn, { backgroundColor: colors.primary }]} onPress={handleGo} activeOpacity={0.85}>
            <MaterialCommunityIcons name="dice-6" size={22} color={colors.primaryForeground} />
            <Text style={[styles.goBtnText, { color: colors.primaryForeground }]}>GO</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Pickers */}
      <PickerModal
        visible={openPicker === "players"}
        title="Number of Players"
        options={playerOptions}
        selected={filters.players}
        onSelect={(v) => setFilters((f) => ({ ...f, players: v as number | null }))}
        onClose={() => setOpenPicker(null)}
      />
      <PickerModal
        visible={openPicker === "playTime"}
        title="Play Time"
        options={PLAY_TIME_OPTIONS}
        selected={filters.playTime}
        onSelect={(v) => setFilters((f) => ({ ...f, playTime: v as PlayTimeFilter | null }))}
        onClose={() => setOpenPicker(null)}
      />
      <PickerModal
        visible={openPicker === "complexity"}
        title="Complexity"
        options={COMPLEXITY_OPTIONS}
        selected={filters.complexity}
        onSelect={(v) => setFilters((f) => ({ ...f, complexity: v as ComplexityFilter | null }))}
        onClose={() => setOpenPicker(null)}
      />
      <PickerModal
        visible={openPicker === "category"}
        title="Category"
        options={categoryOptions}
        selected={filters.category}
        onSelect={(v) => setFilters((f) => ({ ...f, category: v as string | null }))}
        onClose={() => setOpenPicker(null)}
      />
      <PickerModal
        visible={openPicker === "mechanic"}
        title="Mechanic"
        options={mechanicOptions}
        selected={filters.mechanic}
        onSelect={(v) => setFilters((f) => ({ ...f, mechanic: v as string | null }))}
        onClose={() => setOpenPicker(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 22, fontFamily: "Inter_700Bold" },
  clearBtn: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  scroll: { padding: 16 },
  sectionLabel: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    marginBottom: 14,
  },
  centerState: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 48,
    gap: 12,
  },
  helperText: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
  errorText: { fontSize: 14, fontFamily: "Inter_500Medium", textAlign: "center" },
  noMatchText: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  retryBtn: {
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  retryBtnText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  resultCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
    marginTop: 20,
    alignItems: "center",
    gap: 12,
  },
  resultImage: {
    width: 140,
    height: 140,
    borderRadius: 10,
  },
  resultImageFallback: {
    width: 140,
    height: 140,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  resultTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
    lineHeight: 26,
  },
  resultMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "center",
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  metaChipText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  resultCategories: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
  resultActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 4,
  },
  rollAgainBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  rollAgainText: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  bggLink: { paddingVertical: 4 },
  bggLinkText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  matchCount: { fontSize: 12, fontFamily: "Inter_400Regular" },
  expansionNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginTop: 4,
  },
  expansionNoteText: {
    flex: 1,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  goBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  goBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 14,
    paddingVertical: 16,
  },
  goBtnText: { fontSize: 18, fontFamily: "Inter_700Bold", letterSpacing: 1 },
});
