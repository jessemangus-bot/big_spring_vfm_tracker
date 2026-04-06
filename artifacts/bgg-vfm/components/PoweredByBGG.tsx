import React from "react";
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useColors } from "@/hooks/useColors";

const BGG_HOME_URL = "https://boardgamegeek.com";
const POWERED_BY_BGG_LOGO_URL =
  "https://cf.geekdo-images.com/HZy35cmzmmyV9BarSuk6ug__small/img/gbE7sulIurZE_Tx8EQJXnZSKI6w=/fit-in/200x150/filters:strip_icc()/pic7779581.png";

interface PoweredByBGGProps {
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export function PoweredByBGG({ style, compact = false }: PoweredByBGGProps) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[
        styles.card,
        compact ? styles.cardCompact : null,
        { backgroundColor: colors.card, borderColor: colors.border },
        style,
      ]}
      onPress={() => {
        Linking.openURL(BGG_HOME_URL).catch(() => {});
      }}
      activeOpacity={0.8}
      accessibilityRole="link"
      accessibilityLabel="Powered by BGG. Opens BoardGameGeek"
    >
      <Text style={[styles.text, compact ? styles.textCompact : null, { color: colors.mutedForeground }]}>
        Powered by
      </Text>
      <Image
        source={{ uri: POWERED_BY_BGG_LOGO_URL }}
        style={[styles.logo, compact ? styles.logoCompact : null]}
        resizeMode="contain"
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    width: "100%",
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  cardCompact: {
    width: "auto",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: "row",
    gap: 6,
  },
  text: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    marginBottom: 6,
  },
  textCompact: {
    marginBottom: 0,
    fontSize: 11,
  },
  logo: {
    width: 190,
    height: 72,
  },
  logoCompact: {
    width: 66,
    height: 18,
  },
});
