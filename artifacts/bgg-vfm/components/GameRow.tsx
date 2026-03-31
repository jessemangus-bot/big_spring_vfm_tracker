import { Feather } from "@expo/vector-icons";
import React from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { Game, useVFM } from "@/context/VFMContext";

interface GameRowProps {
  game: Game;
  onEdit: (game: Game) => void;
}

const STATUS_LABELS: Record<string, string> = {
  listed: "Listed",
  sold: "Sold",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

export function GameRow({ game, onEdit }: GameRowProps) {
  const colors = useColors();
  const { deleteGame } = useVFM();

  const statusColor =
    game.status === "sold"
      ? colors.success
      : game.status === "listed"
      ? colors.info
      : colors.mutedForeground;

  const typeColor =
    game.type === "purchase" ? colors.warning : colors.primary;

  const handleDelete = () => {
    Alert.alert("Delete Entry", `Remove "${game.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteGame(game.id),
      },
    ]);
  };

  return (
    <View style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
        <Feather
          name={game.type === "purchase" ? "shopping-bag" : "tag"}
          size={14}
          color={typeColor}
        />
      </View>
      <View style={styles.info}>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={1}>
          {game.title}
        </Text>
        <View style={styles.meta}>
          {game.type === "sale" ? (
            <Text style={[styles.status, { color: statusColor }]}>
              {STATUS_LABELS[game.status]}
            </Text>
          ) : (
            <Text style={[styles.status, { color: typeColor }]}>Purchase</Text>
          )}
          {game.buyerSeller ? (
            <Text style={[styles.person, { color: colors.mutedForeground }]}>
              · {game.buyerSeller}
            </Text>
          ) : null}
        </View>
      </View>
      <Text style={[styles.price, { color: colors.foreground }]}>
        ${game.price.toFixed(2)}
      </Text>
      <TouchableOpacity style={styles.iconBtn} onPress={() => onEdit(game)} hitSlop={8}>
        <Feather name="edit-2" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.iconBtn} onPress={handleDelete} hitSlop={8}>
        <Feather name="trash-2" size={16} color={colors.destructive} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 10,
  },
  typeBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 2,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
  },
  status: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
  },
  person: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  price: {
    fontSize: 14,
    fontFamily: "Inter_700Bold",
    minWidth: 56,
    textAlign: "right",
  },
  iconBtn: {
    padding: 4,
  },
});
