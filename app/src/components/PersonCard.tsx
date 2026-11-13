import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { TreePerson } from "@/lib/api";
import { years } from "@/lib/family";
import { colors, fonts } from "@/lib/theme";
import { useLoop } from "./animations";

interface Props {
  person: TreePerson;
  label: string;
  isMe: boolean;
  pending: boolean;
  onPress: () => void;
}

/**
 * One person in the tree, in the Night Garden style:
 * - you glow gold (animation "Glow")
 * - relatives who passed away glow softly like a lantern with a moon (animation 03)
 * - a link awaiting approval breathes with an amber dashed edge (animation 07)
 */
export function PersonCard({ person, label, isMe, pending, onPress }: Props) {
  const passed = person.is_living === 0;
  const glow = useLoop(isMe ? 3200 : passed ? 4500 : 2600);
  const animated = isMe || passed || pending;

  const haloOpacity = glow.interpolate({ inputRange: [0, 1], outputRange: isMe ? [0.25, 0.75] : [0.05, 0.35] });
  const scale = pending ? glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) : 1;

  const a11y = [label, person.full_name, years(person), pending ? "awaiting approval" : "", passed ? "passed away" : ""]
    .filter(Boolean)
    .join(", ");

  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y} style={{ margin: 6 }}>
      <Animated.View style={{ transform: [{ scale }] }}>
        {animated && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.halo,
              { opacity: haloOpacity, borderColor: isMe ? colors.gold : passed ? colors.muted : colors.pending },
              Platform.OS === "web" ? ({ boxShadow: `0 0 24px ${isMe ? colors.gold : colors.muted}` } as object) : null,
            ]}
          />
        )}
        <View
          style={[
            styles.card,
            passed && styles.passed,
            isMe && styles.me,
            pending && styles.pending,
          ]}
        >
          <View style={styles.nameRow}>
            {passed && <Text style={styles.moon} accessibilityElementsHidden>☾</Text>}
            <Text style={[styles.name, isMe && { color: colors.goldSoft }, passed && { color: "#C9CFEA" }]} numberOfLines={2}>
              {person.full_name}
            </Text>
          </View>
          <Text style={styles.meta} numberOfLines={1}>{label}</Text>
          {!!years(person) && <Text style={styles.meta}>{years(person)}</Text>}
          {pending && <Text style={styles.pendingText}>Awaiting approval</Text>}
          {!person.has_account && person.is_living === 1 && !pending && <Text style={styles.invite}>Not joined yet</Text>}
        </View>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  halo: {
    position: "absolute",
    top: -4,
    left: -4,
    right: -4,
    bottom: -4,
    borderRadius: 18,
    borderWidth: 2,
  },
  card: {
    width: 156,
    minHeight: 84,
    padding: 12,
    gap: 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
  },
  passed: { backgroundColor: colors.lantern, borderColor: colors.lanternBorder },
  me: { backgroundColor: colors.meCard, borderColor: colors.gold },
  pending: { borderStyle: "dashed", borderColor: colors.pending, borderWidth: 2, backgroundColor: "#1A1830" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  moon: { color: colors.muted, fontSize: 14 },
  name: { flexShrink: 1, fontFamily: fonts.display, fontSize: 17, color: colors.text },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  pendingText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.amber },
  invite: { fontFamily: fonts.body, fontSize: 12, color: colors.teal },
});
