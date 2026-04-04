import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { BggSettings, useVFM } from "@/context/VFMContext";

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onSyncComplete: () => void;
}

export function SettingsModal({ visible, onClose, onSyncComplete }: SettingsModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { bggSettings, saveBggSettings, syncFromBgg, isSyncing } = useVFM();

  const [geeklistUrl, setGeeklistUrl] = useState("");
  const [username, setUsername] = useState("");
  const [realName, setRealName] = useState("");
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setGeeklistUrl(bggSettings.geeklistUrl);
      setUsername(bggSettings.username);
      setRealName(bggSettings.realName ?? "");
      setSyncStatus(null);
      setSyncError(null);
    }
  }, [visible, bggSettings]);

  const buildSettings = (): BggSettings => ({
    geeklistUrl: geeklistUrl.trim(),
    username: username.trim(),
    realName: realName.trim(),
    apiToken: "",
  });

  const handleSave = () => {
    saveBggSettings(buildSettings());
  };

  const handleSync = async () => {
    const settings = buildSettings();
    saveBggSettings(settings);
    setSyncStatus("Connecting to BGG...");
    setSyncError(null);

    try {
      const result = await syncFromBgg(settings);
      const parts = [
        `${result.sales} listing${result.sales !== 1 ? "s" : ""}`,
        `${result.purchases} purchase${result.purchases !== 1 ? "s" : ""}`,
        `${result.auctionsWinning} winning`,
        `${result.auctionsOutbid} outbid`,
      ];
      setSyncStatus(`Synced: ${parts.join(", ")}`);
      onSyncComplete();
    } catch (err: any) {
      setSyncStatus(null);
      setSyncError(err.message ?? "Could not fetch the geeklist.");
    }
  };

  const isConfigured = geeklistUrl.trim().length > 0 && username.trim().length > 0;
  const canSync = isConfigured && !isSyncing;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View
          style={[
            styles.header,
            {
              borderBottomColor: colors.border,
              paddingTop: insets.top + 16,
            },
          ]}
        >
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            BGG Settings
          </Text>
          <TouchableOpacity onPress={handleSave} hitSlop={8}>
            <Text style={[styles.saveBtn, { color: colors.accent }]}>Save</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            GEEKLIST URL
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            value={geeklistUrl}
            onChangeText={setGeeklistUrl}
            placeholder="https://boardgamegeek.com/geeklist/..."
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            YOUR BGG USERNAME
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            value={username}
            onChangeText={setUsername}
            placeholder="your_bgg_username"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            YOUR REAL NAME
          </Text>
          <TextInput
            style={[
              styles.input,
              {
                color: colors.foreground,
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
            value={realName}
            onChangeText={setRealName}
            placeholder="First Last (optional)"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="words"
            autoCorrect={false}
          />
          <Text style={[styles.fieldHint, { color: colors.mutedForeground }]}>
            Used to detect purchases when a seller types your name instead of your BGG username.
          </Text>

          <View style={styles.syncSection}>
            <TouchableOpacity
              style={[
                styles.syncBtn,
                {
                  backgroundColor: canSync ? colors.primary : colors.muted,
                  opacity: isSyncing ? 0.7 : 1,
                },
              ]}
              onPress={handleSync}
              disabled={!canSync}
              activeOpacity={0.8}
            >
              {isSyncing ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Feather
                  name="refresh-cw"
                  size={18}
                  color={canSync ? colors.primaryForeground : colors.mutedForeground}
                />
              )}
              <Text
                style={[
                  styles.syncBtnText,
                  { color: canSync ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                {isSyncing ? "Syncing..." : "Sync from BGG"}
              </Text>
            </TouchableOpacity>

            {syncStatus ? (
              <View
                style={[
                  styles.statusBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Feather name="check-circle" size={16} color={colors.success} />
                <Text style={[styles.statusText, { color: colors.foreground }]}>
                  {syncStatus}
                </Text>
              </View>
            ) : null}

            {syncError ? (
              <View
                style={[
                  styles.statusBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Feather name="alert-circle" size={16} color={colors.destructive} />
                <Text style={[styles.statusText, { color: colors.foreground }]}>
                  {syncError}
                </Text>
              </View>
            ) : null}

            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Syncing replaces all BGG-sourced items with the latest data. Manually added items are never affected.
            </Text>
          </View>

          <View style={styles.donationSection}>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              SUPPORT DEVELOPMENT
            </Text>
            <Text style={[styles.donationMessage, { color: colors.mutedForeground }]}>
              If you find this app useful, consider buying the developer a coffee!
            </Text>
            <TouchableOpacity
              style={[styles.donationBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => Linking.openURL("https://paypal.me/jessemangus")}
              activeOpacity={0.7}
            >
              <Feather name="dollar-sign" size={18} color={colors.foreground} />
              <Text style={[styles.donationBtnText, { color: colors.foreground }]}>
                Donate via PayPal
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.donationBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
              onPress={() => Linking.openURL("https://venmo.com/JesseMangus")}
              activeOpacity={0.7}
            >
              <Feather name="credit-card" size={18} color={colors.foreground} />
              <Text style={[styles.donationBtnText, { color: colors.foreground }]}>
                Donate via Venmo
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: insets.bottom + 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  saveBtn: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 20 },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 20,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  fieldHint: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
    lineHeight: 16,
    marginTop: 6,
  },
  syncSection: {
    marginTop: 28,
    gap: 12,
  },
  syncBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderRadius: 12,
    paddingVertical: 14,
  },
  syncBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  statusBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  statusText: {
    flex: 1,
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  hint: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 17,
  },
  donationSection: {
    marginTop: 28,
    gap: 12,
  },
  donationMessage: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginBottom: 4,
  },
  donationBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  donationBtnText: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
