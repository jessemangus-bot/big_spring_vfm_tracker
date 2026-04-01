import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { BggSettings, useVFM } from "@/context/VFMContext";
import { getBaseUrl } from "@workspace/api-client-react";

function extractListId(url: string): string | null {
  const m = url.match(/geeklist\/(\d+)/);
  return m ? m[1] : null;
}

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onSyncComplete: () => void;
}

export function SettingsModal({ visible, onClose, onSyncComplete }: SettingsModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { bggSettings, saveBggSettings, replaceBggGames, setLastSyncedAt } = useVFM();

  const [geeklistUrl, setGeeklistUrl] = useState("");
  const [username, setUsername] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setGeeklistUrl(bggSettings.geeklistUrl);
      setUsername(bggSettings.username);
      setApiToken(bggSettings.apiToken);
      setSyncStatus(null);
    }
  }, [visible, bggSettings]);

  const handleSave = () => {
    const s: BggSettings = {
      geeklistUrl: geeklistUrl.trim(),
      username: username.trim(),
      apiToken: apiToken.trim(),
    };
    saveBggSettings(s);
  };

  const handleSync = async () => {
    const listId = extractListId(geeklistUrl.trim());
    if (!listId) {
      Alert.alert("Invalid URL", "Could not find a geeklist ID in that URL.");
      return;
    }
    if (!username.trim()) {
      Alert.alert("Missing Username", "Please enter your BGG username.");
      return;
    }
    if (!apiToken.trim()) {
      Alert.alert("Missing API Token", "Please enter your BGG API token.");
      return;
    }

    // Save settings first
    handleSave();
    setSyncing(true);
    setSyncStatus("Connecting to BGG...");

    try {
      const base = getBaseUrl();
      const url = `${base}/api/bgg/geeklist?listId=${listId}&username=${encodeURIComponent(username.trim())}&apiToken=${encodeURIComponent(apiToken.trim())}`;
      const resp = await fetch(url);

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(body.error ?? `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const { items, listTitle, totalItems } = data;

      setSyncStatus(`Parsing ${totalItems} geeklist items...`);

      // Map API response to Game objects
      const games = items.map((item: any) => ({
        id: `bgg_${item.id}`,
        title: item.gameTitle,
        price: item.price ?? 0,
        type: item.type,
        status: item.status,
        buyerSeller: item.buyerSeller,
        condition: item.condition,
        notes: item.notes,
        source: "bgg" as const,
      }));

      replaceBggGames(games);
      setLastSyncedAt(new Date().toISOString());

      setSyncStatus(
        `Synced ${games.length} of your items from "${listTitle}"`
      );
      onSyncComplete();
    } catch (err: any) {
      setSyncStatus(null);
      Alert.alert("Sync Failed", err.message ?? "Could not fetch the geeklist.");
    } finally {
      setSyncing(false);
    }
  };

  const isConfigured =
    geeklistUrl.trim().length > 0 &&
    username.trim().length > 0 &&
    apiToken.trim().length > 0;

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
            placeholder="https://boardgamegeek.com/geeklist/375812/..."
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
            BGG API TOKEN
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
            value={apiToken}
            onChangeText={setApiToken}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry={false}
          />

          <View style={styles.syncSection}>
            <TouchableOpacity
              style={[
                styles.syncBtn,
                {
                  backgroundColor: isConfigured
                    ? colors.primary
                    : colors.muted,
                  opacity: syncing ? 0.7 : 1,
                },
              ]}
              onPress={handleSync}
              disabled={!isConfigured || syncing}
              activeOpacity={0.8}
            >
              {syncing ? (
                <ActivityIndicator color={colors.primaryForeground} size="small" />
              ) : (
                <Feather name="refresh-cw" size={18} color={isConfigured ? colors.primaryForeground : colors.mutedForeground} />
              )}
              <Text
                style={[
                  styles.syncBtnText,
                  {
                    color: isConfigured
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                  },
                ]}
              >
                {syncing ? "Syncing..." : "Sync from BGG"}
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

            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              Syncing will replace all BGG-sourced items with the latest data.
              Manually added items are never affected.
            </Text>
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
});
