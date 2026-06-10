import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "primary" | "success" | "warning" | "info" | "destructive";
  /** Smaller paddings/type for two-column phone grids. */
  compact?: boolean;
}

export function StatCard({
  label,
  value,
  sub,
  accent = "primary",
  compact = false,
}: StatCardProps) {
  const colors = useColors();

  const accentColor = {
    primary: colors.primary,
    success: colors.success,
    warning: colors.warning,
    info: colors.info,
    destructive: colors.destructive,
  }[accent];

  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: accentColor }]} />
      <View style={[styles.content, compact && styles.contentCompact]}>
        <Text
          style={[
            styles.label,
            compact && styles.labelCompact,
            { color: colors.mutedForeground },
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
        <Text
          style={[
            styles.value,
            compact && styles.valueCompact,
            { color: accentColor },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {value}
        </Text>
        {sub && !compact ? (
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            {sub}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
  },
  cardCompact: {
    marginBottom: 0,
    flex: 1,
  },
  bar: {
    width: 5,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  contentCompact: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  labelCompact: {
    fontSize: 10,
    letterSpacing: 0.3,
    marginBottom: 2,
  },
  value: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 2,
  },
  valueCompact: {
    fontSize: 20,
    marginBottom: 0,
  },
  sub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
