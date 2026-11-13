import { useEffect, type ReactElement } from "react";
import { AccessibilityInfo, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fonts } from "@/lib/theme";
import { BirthBloom, EndlessBond, JourneyBack, KinshipWave, LanternRelease, SealOfApproval, WovenThreads } from "./moments";
import { Button } from "./ui";

export type MomentKind = "seal" | "woven" | "bloom" | "endless" | "lantern" | "kinship" | "journey";

export interface Moment {
  kind: MomentKind;
  title: string;
  body?: string;
  /** How long it stays before closing by itself, in ms. */
  duration?: number;
}

const ART: Record<MomentKind, () => ReactElement> = {
  seal: () => <SealOfApproval size={220} />,
  woven: () => <WovenThreads size={220} />,
  bloom: () => <BirthBloom size={220} />,
  endless: () => <EndlessBond size={220} />,
  lantern: () => <LanternRelease size={220} />,
  kinship: () => <KinshipWave size={220} />,
  journey: () => <JourneyBack size={220} />,
};

/** A short full-screen moment for something that just happened in the family. */
export function Celebration({ moment, onDone }: { moment: Moment | null; onDone: () => void }) {
  useEffect(() => {
    if (!moment) return;
    AccessibilityInfo.announceForAccessibility([moment.title, moment.body].filter(Boolean).join(". "));
    const t = setTimeout(onDone, moment.duration ?? 4200);
    return () => clearTimeout(t);
  }, [moment, onDone]);

  return (
    <Modal visible={!!moment} transparent animationType="fade" onRequestClose={onDone}>
      {moment && (
        <View style={styles.scrim}>
          {/* Tapping anywhere outside the message closes it too. */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onDone} accessible={false} />
          <View style={styles.box}>
            {ART[moment.kind]()}
            <Text style={styles.title} accessibilityRole="header">
              {moment.title}
            </Text>
            {!!moment.body && <Text style={styles.body}>{moment.body}</Text>}
            <View style={{ alignSelf: "stretch" }}>
              <Button title="Continue" onPress={onDone} />
            </View>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: "rgba(7, 11, 28, 0.92)", alignItems: "center", justifyContent: "center", padding: 24 },
  box: { width: "100%", maxWidth: 380, alignItems: "center", gap: 14 },
  title: { fontFamily: fonts.displayBold, fontSize: 26, color: colors.text, textAlign: "center" },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.muted, textAlign: "center" },
});
