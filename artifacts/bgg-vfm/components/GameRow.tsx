import { Feather } from "@expo/vector-icons";
import React from "react";
import { Alert, Linking, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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

  const isAuction = game.type === "auction";
  const isOffer = game.type === "offer";
  const isWinning = isAuction && game.auctionStatus === "winning";
  const isOutbid = isAuction && game.auctionStatus === "outbid";

  const typeColor =
    isWinning
      ? colors.success
      : isOutbid
      ? colors.destructive
      : isOffer
      ? colors.info
      : game.type === "purchase"
      ? colors.warning
      : colors.primary;

  const statusColor =
    game.status === "sold"
      ? colors.success
      : game.status === "listed"
      ? colors.info
      : colors.mutedForeground;

  const badgeIcon: React.ComponentProps<typeof Feather>["name"] =
    isWinning
      ? "trending-up"
      : isOutbid
      ? "trending-down"
      : isOffer
      ? "clock"
      : game.type === "purchase"
      ? "shopping-bag"
      : "tag";

  const handleDelete = () => {
    if (Platform.OS === "web") {
      // React Native Web's Alert.alert with buttons is a silent no-op, so
      // the trash icon did nothing in browsers. Use the native dialog.
      const confirmFn = (globalThis as { confirm?: (msg: string) => boolean })
        .confirm;
      const confirmed = confirmFn
        ? confirmFn(`Remove "${game.title}" from the tracker?`)
        : true;
      if (confirmed) deleteGame(game.id);
      return;
    }
    Alert.alert("Delete Entry", `Remove "${game.title}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => deleteGame(game.id),
      },
    ]);
  };

  const handleOpenBgg = () => {
    if (game.bggUrl) {
      Linking.openURL(game.bggUrl).catch(() => {
        Alert.alert("Could not open link", game.bggUrl);
      });
    }
  };

  const priceLabel = isAuction
    ? `Bid: $${game.price.toFixed(2)}`
    : `$${game.price.toFixed(2)}`;

  const rowBorderColor = isOutbid
    ? colors.destructive + "40"
    : colors.border;

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: colors.card, borderColor: rowBorderColor },
      ]}
    >
      <TouchableOpacity
        style={styles.mainContent}
        onPress={game.bggUrl ? handleOpenBgg : undefined}
        activeOpacity={game.bggUrl ? 0.65 : 1}
        disabled={!game.bggUrl}
      >
        <View style={[styles.typeBadge, { backgroundColor: typeColor + "20" }]}>
          <Feather name={badgeIcon} size={14} color={typeColor} />
        </View>
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <Text
              style={[styles.title, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {game.title}
            </Text>
            {game.bggUrl ? (
              <Feather
                name="external-link"
                size={11}
                color={colors.mutedForeground}
                style={styles.linkIcon}
              />
            ) : null}
          </View>
          <View style={styles.meta}>
            {isAuction ? (
              <Text style={[styles.status, { color: typeColor }]}>
                {isWinning ? "Winning" : "Outbid"}
              </Text>
            ) : isOffer ? (
              <Text style={[styles.status, { color: typeColor }]}>
                Offer
              </Text>
            ) : game.type === "sale" ? (
              <Text style={[styles.status, { color: statusColor }]}>
                {STATUS_LABELS[game.status]}
              </Text>
            ) : (
              <Text style={[styles.status, { color: typeColor }]}>
                Purchase
              </Text>
            )}
            {game.buyerSeller ? (
              <Text
                style={[styles.person, { color: colors.mutedForeground }]}
                numberOfLines={1}
              >
                · {game.buyerSeller}
              </Text>
            ) : null}
          </View>
        </View>
        <Text
          style={[
            styles.price,
            { color: isAuction ? typeColor : colors.foreground },
          ]}
        >
          {priceLabel}
        </Text>
      </TouchableOpacity>

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
    paddingRight: 8,
    paddingVertical: 10,
    marginBottom: 8,
    gap: 4,
  },
  mainContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 12,
    paddingRight: 4,
  },
  typeBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  info: {
    flex: 1,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 2,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
    flexShrink: 1,
  },
  linkIcon: {
    flexShrink: 0,
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
    flexShrink: 1,
  },
  price: {
    fontSize: 13,
    fontFamily: "Inter_700Bold",
    minWidth: 56,
    textAlign: "right",
    flexShrink: 0,
  },
  iconBtn: {
    padding: 6,
  },
});
