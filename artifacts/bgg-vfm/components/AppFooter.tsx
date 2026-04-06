import React, { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { PoweredByBGG } from "@/components/PoweredByBGG";

interface AppFooterProps {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function AppFooter({ children, style }: AppFooterProps) {
  return (
    <View style={[styles.container, style]}>
      {children ? <View style={styles.actions}>{children}</View> : null}
      <PoweredByBGG />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    marginTop: 16,
    marginBottom: 4,
    gap: 12,
  },
  actions: {
    width: "100%",
  },
});
