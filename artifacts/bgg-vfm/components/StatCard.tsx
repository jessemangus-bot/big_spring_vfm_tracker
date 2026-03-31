import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "primary" | "success" | "warning" | "info" | "destructive";
}

export function StatCard({ label, value, sub, accent = "primary" }: StatCardProps) {
  const colors = useColors();

  const accentColor = {
    primary: colors.primary,
    success: colors.success,
    warning: colors.warning,
    info: colors.info,
    destructive: colors.destructive,
  }[accent];

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.bar, { backgroundColor: accentColor }]} />
      <View style={styles.content}>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
        <Text style={[styles.value, { color: accentColor }]}>{value}</Text>
        {sub ? <Text style={[styles.sub, { color: colors.mutedForeground }]}>{sub}</Text> : null}
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
  bar: {
    width: 5,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  value: {
    fontSize: 28,
    fontFamily: "Inter_700Bold",
    marginBottom: 2,
  },
  sub: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
