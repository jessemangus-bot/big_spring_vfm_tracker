import { Feather } from "@expo/vector-icons";
import { getBaseUrl } from "@workspace/api-client-react";
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

export interface VfmPostItem {
  objectId: string;
  gameTitle: string;
  version?: string;
  language?: string;
  tradeCondition?: string;
  imageId?: string;
}

interface AddToVfmReviewModalProps {
  visible: boolean;
  item: VfmPostItem | null;
  geeklistUrl: string;
  destinationLabel?: string;
  onClose: () => void;
}

function extractListId(url: string): string | null {
  const match = url.match(/geeklist\/(\d+)/);
  return match ? match[1] : null;
}

export function AddToVfmReviewModal({
  visible,
  item,
  geeklistUrl,
  destinationLabel,
  onClose,
}: AddToVfmReviewModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const [sbPrice, setSbPrice] = useState("");
  const [binPrice, setBinPrice] = useState("");
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [priceNote, setPriceNote] = useState<string | null>(null);
  const [listedCount, setListedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!visible || !item?.objectId) {
      setSbPrice("");
      setBinPrice("");
      setPriceNote(null);
      setListedCount(null);
      return;
    }

    setIsLoadingPrices(true);
    setPriceNote(null);
    setListedCount(null);

    const base = getBaseUrl();
    fetch(`${base}/api/bgg/marketplace-prices?objectId=${encodeURIComponent(item.objectId)}`)
      .then((r) => r.json())
      .then((data) => {
        const count = data.listedCount ?? 0;
        setListedCount(count);
        if (data.suggestedSb != null) {
          setSbPrice((data.suggestedSb as number).toFixed(2));
        } else {
          setSbPrice("");
          setPriceNote("No marketplace listings found — enter prices manually.");
        }
        if (data.suggestedBin != null) {
          setBinPrice((data.suggestedBin as number).toFixed(2));
        } else {
          setBinPrice("");
        }
      })
      .catch(() => {
        setPriceNote("Could not load marketplace prices — enter manually.");
      })
      .finally(() => setIsLoadingPrices(false));
  }, [visible, item?.objectId]);

  const handlePost = () => {
    if (!item) return;
    const listId = extractListId(geeklistUrl);
    if (!listId || !item.objectId) return;

    const sb = parseFloat(sbPrice);
    const bin = parseFloat(binPrice);

    const body = [
      `[B]Version:[/B] ${item.version ?? ""}`,
      `[B]Language:[/B] ${item.language ?? ""}`,
      `[B]Condition:[/B] ${item.tradeCondition ?? ""}`,
      "",
      `[B]SB:[/B] $${Number.isFinite(sb) ? sb.toFixed(2) : ""}`,
      `[B]BIN:[/B] $${Number.isFinite(bin) ? bin.toFixed(2) : ""}`,
    ].join("\n");

    const url = new URL(`https://boardgamegeek.com/geeklist/${listId}`);
    url.searchParams.set("addListitem", "1");
    url.searchParams.set("addListitemType", "things");
    url.searchParams.set("addListitemId", item.objectId);
    url.searchParams.set("addListitemBody", body);
    if (item.imageId) {
      url.searchParams.set("addListitemImageid", item.imageId);
    }

    Linking.openURL(url.toString()).catch(() => {});
    onClose();
  };

  const sbNum = parseFloat(sbPrice);
  const binNum = parseFloat(binPrice);
  const isValid =
    item != null &&
    Number.isFinite(sbNum) &&
    sbNum > 0 &&
    Number.isFinite(binNum) &&
    binNum > 0;

  const headerTitle = destinationLabel ? `Post to ${destinationLabel}` : "Post to VFM";

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
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {headerTitle}
          </Text>
          <TouchableOpacity onPress={handlePost} disabled={!isValid} hitSlop={8}>
            <Text
              style={[
                styles.postBtnText,
                { color: isValid ? colors.accent : colors.mutedForeground },
              ]}
            >
              Post
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {item ? (
            <>
              <Text style={[styles.gameTitle, { color: colors.foreground }]}>
                {item.gameTitle}
              </Text>

              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                VERSION
              </Text>
              <View
                style={[
                  styles.readonlyField,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.readonlyText, { color: colors.foreground }]}>
                  {item.version ?? "—"}
                </Text>
              </View>

              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                CONDITION
              </Text>
              <View
                style={[
                  styles.readonlyField,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.readonlyText, { color: colors.foreground }]}>
                  {item.tradeCondition ?? "—"}
                </Text>
              </View>

              <View style={styles.pricingHeaderRow}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
                  PRICING
                </Text>
                {isLoadingPrices ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : listedCount != null && listedCount > 0 ? (
                  <Text style={[styles.listingCount, { color: colors.mutedForeground }]}>
                    {listedCount} listing{listedCount !== 1 ? "s" : ""} on BGG Marketplace
                  </Text>
                ) : null}
              </View>

              {priceNote ? (
                <Text style={[styles.priceNote, { color: colors.warning }]}>
                  {priceNote}
                </Text>
              ) : null}

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                SB ($) — 75% of lowest listed
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
                value={sbPrice}
                onChangeText={setSbPrice}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
              />

              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                BIN ($) — average current listing
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
                value={binPrice}
                onChangeText={setBinPrice}
                placeholder="0.00"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="decimal-pad"
              />

              <View
                style={[
                  styles.previewBox,
                  { backgroundColor: colors.card, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.previewLabel, { color: colors.mutedForeground }]}>
                  POST PREVIEW
                </Text>
                <Text style={[styles.previewText, { color: colors.foreground }]}>
                  {[
                    `Version: ${item.version ?? ""}`,
                    `Condition: ${item.tradeCondition ?? ""}`,
                    `SB: $${sbPrice || "?"}`,
                    `BIN: $${binPrice || "?"}`,
                  ].join("\n")}
                </Text>
              </View>

              <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
                Tapping "Post" opens the BGG geeklist with these details pre-filled.
                Review and confirm on BGG before submitting.
              </Text>
            </>
          ) : null}

          <View style={{ height: insets.bottom + 32 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
    flex: 1,
    textAlign: "center",
    marginHorizontal: 8,
  },
  postBtnText: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  gameTitle: {
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    marginBottom: 20,
    lineHeight: 26,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 20,
  },
  fieldLabel: {
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.4,
    marginBottom: 8,
    marginTop: 16,
  },
  readonlyField: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 44,
    justifyContent: "center",
  },
  readonlyText: {
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  pricingHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    marginBottom: 8,
  },
  listingCount: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  priceNote: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    marginBottom: 4,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  previewBox: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginTop: 24,
    gap: 8,
  },
  previewLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
  },
  previewText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
  },
  footerNote: {
    marginTop: 16,
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
    textAlign: "center",
  },
});
