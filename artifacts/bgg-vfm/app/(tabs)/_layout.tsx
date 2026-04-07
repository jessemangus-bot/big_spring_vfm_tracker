import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs, useRouter } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, TouchableOpacity, View, useColorScheme } from "react-native";

import { PoweredByBGG } from "@/components/PoweredByBGG";
import { useColors } from "@/hooks/useColors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "chart.bar", selected: "chart.bar.fill" }} />
        <Label>Dashboard</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: isIOS ? "transparent" : colors.background,
          borderTopWidth: isWeb ? 1 : 0,
          borderTopColor: colors.border,
          elevation: 0,
          ...(isWeb ? { height: 84 } : {}),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={100}
              tint={isDark ? "dark" : "light"}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}>
              <View pointerEvents="box-none" style={styles.bottomActionsLayer}>
                <View style={styles.bottomActionLeft}>
                  <TouchableOpacity
                    style={[styles.wishlistBtn, { backgroundColor: colors.primary }]}
                    onPress={() => router.push("/wishlist")}
                    activeOpacity={0.8}
                  >
                    <Feather name="heart" size={16} color={colors.primaryForeground} />
                    <Text style={[styles.wishlistBtnText, { color: colors.primaryForeground }]}>
                      Wishlist
                    </Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.bottomActionRight}>
                  <PoweredByBGG compact />
                </View>
              </View>
            </View>
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="chart.bar.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="bar-chart-2" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({
  bottomActionsLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === "web" ? 8 : 10,
  },
  bottomActionLeft: {
    position: "absolute",
    left: 16,
    bottom: Platform.OS === "web" ? 8 : 10,
  },
  bottomActionRight: {
    position: "absolute",
    right: 16,
    bottom: Platform.OS === "web" ? 8 : 10,
  },
  wishlistBtn: {
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  wishlistBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
