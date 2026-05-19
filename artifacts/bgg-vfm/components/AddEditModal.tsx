import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
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
import { PoweredByBGG } from "@/components/PoweredByBGG";
import { useColors } from "@/hooks/useColors";
import { Game, ListingStatus, TransactionType, useVFM } from "@/context/VFMContext";

interface AddEditModalProps {
  visible: boolean;
  editGame?: Game | null;
  onClose: () => void;
}

const SALE_STATUSES: ListingStatus[] = ["listed", "sold", "withdrawn", "expired"];
const STATUS_LABELS: Record<ListingStatus, string> = {
  listed: "Listed",
  sold: "Sold",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export function AddEditModal({ visible, editGame, onClose }: AddEditModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { addGame, updateGame } = useVFM();

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [type, setType] = useState<TransactionType>("sale");
  const [status, setStatus] = useState<ListingStatus>("listed");
  const [buyerSeller, setBuyerSeller] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (editGame) {
      setTitle(editGame.title);
      setPrice(editGame.price.toString());
      setType(editGame.type);
      setStatus(editGame.status);
      setBuyerSeller(editGame.buyerSeller ?? "");
      setNotes(editGame.notes ?? "");
    } else {
      setTitle("");
      setPrice("");
      setType("sale");
      setStatus("listed");
      setBuyerSeller("");
      setNotes("");
    }
  }, [editGame, visible]);

  const handleSave = () => {
    if (!title.trim() || !price.trim()) return;
    const parsed = parseFloat(price);
    if (isNaN(parsed) || parsed < 0) return;

    const data = {
      title: title.trim(),
      price: parsed,
      type,
      status: type === "purchase" || type === "offer" ? ("listed" as ListingStatus) : status,
      buyerSeller: buyerSeller.trim() || undefined,
      notes: notes.trim() || undefined,
    };

    if (editGame) {
      updateGame(editGame.id, data);
    } else {
      addGame(data);
    }
    onClose();
  };

  const isValid = title.trim().length > 0 && price.trim().length > 0 && !isNaN(parseFloat(price));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.container, { backgroundColor: colors.background }]}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={[styles.header, { borderBottomColor: colors.border, paddingTop: insets.top + 16 }]}>
          <TouchableOpacity onPress={onClose} hitSlop={8}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {editGame ? "Edit Entry" : "Add Entry"}
          </Text>
          <TouchableOpacity onPress={handleSave} disabled={!isValid} hitSlop={8}>
            <Text style={[styles.saveBtn, { color: isValid ? colors.accent : colors.mutedForeground }]}>
              Save
            </Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>TYPE</Text>
          <View style={[styles.segmentRow, { borderColor: colors.border, backgroundColor: colors.secondary }]}>
            {(["sale", "purchase", "offer"] as TransactionType[]).map((t) => (
              <TouchableOpacity
                key={t}
                style={[
                  styles.segment,
                  type === t && { backgroundColor: colors.card, borderRadius: 8 },
                ]}
                onPress={() => setType(t)}
              >
                <Feather
                  name={t === "purchase" ? "shopping-bag" : t === "offer" ? "clock" : "tag"}
                  size={14}
                  color={type === t ? colors.primary : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.segmentText,
                    { color: type === t ? colors.primary : colors.mutedForeground },
                  ]}
                >
                  {t === "purchase" ? "Purchase" : t === "offer" ? "Offer" : "Sale"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>GAME TITLE</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Wingspan"
            placeholderTextColor={colors.mutedForeground}
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PRICE ($)</Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            value={price}
            onChangeText={setPrice}
            placeholder="0.00"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="decimal-pad"
          />

          {type === "sale" && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>STATUS</Text>
              <View style={styles.statusRow}>
                {SALE_STATUSES.map((s) => (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.statusChip,
                      {
                        backgroundColor: status === s ? colors.primary : colors.secondary,
                        borderColor: status === s ? colors.primary : colors.border,
                      },
                    ]}
                    onPress={() => setStatus(s)}
                  >
                    <Text
                      style={[
                        styles.statusChipText,
                        { color: status === s ? colors.primaryForeground : colors.foreground },
                      ]}
                    >
                      {STATUS_LABELS[s]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
            {type === "purchase" || type === "offer" ? "SELLER (OPTIONAL)" : "BUYER (OPTIONAL)"}
          </Text>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            value={buyerSeller}
            onChangeText={setBuyerSeller}
            placeholder="BGG username"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="none"
          />

          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTES (OPTIONAL)</Text>
          <TextInput
            style={[styles.input, styles.notesInput, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            value={notes}
            onChangeText={setNotes}
            placeholder="Condition, shipping notes..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
          />

          <PoweredByBGG style={styles.attribution} />

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
  },
  saveBtn: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 20,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.8,
    marginBottom: 8,
    marginTop: 20,
  },
  segmentRow: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    gap: 6,
  },
  segmentText: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  attribution: {
    marginTop: 24,
  },
  statusRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusChip: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  statusChipText: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
  },
});
