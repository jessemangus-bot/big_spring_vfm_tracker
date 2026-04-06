import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { AppFooter } from "@/components/AppFooter";
import { useColors } from "@/hooks/useColors";

export default function NotFoundScreen() {
  const colors = useColors();

  return (
    <>
      <Stack.Screen options={{ title: "Oops!" }} />
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.content}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            This screen doesn&apos;t exist.
          </Text>

          <Link href="/" style={styles.link}>
            <Text style={[styles.linkText, { color: colors.primary }]}>
              Go to home screen!
            </Text>
          </Link>
        </View>

        <AppFooter style={styles.footer} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    maxWidth: 320,
    alignSelf: "center",
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
  },
});
