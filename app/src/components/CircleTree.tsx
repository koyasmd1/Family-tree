import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import type { Tree } from "@/lib/api";
import { radialLayout, type RadialNode } from "@/lib/radial";
import { colors, fonts } from "@/lib/theme";
import { native, useReducedMotion } from "./animations";

const LABEL_W = 104; // room each person needs on a ring, at full size
const DOT = 46;
const ME_DOT = 64;
const MIN_STEP = 120; // distance between rings, at full size
const MAX_STEP = 300;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** A few still stars behind the circle. Drawn once, they cost nothing after that. */
function stars(size: number) {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return Array.from({ length: Math.min(140, Math.round(size / 8)) }, () => ({ x: rand() * size, y: rand() * size, r: rand() * 1.3 + 0.3, o: rand() * 0.5 + 0.15 }));
}

/**
 * Everyone in the family around you, 360 degrees, joined by their lines.
 * Pinch-free zoom: the + and − buttons, and the picture scrolls in every direction.
 */
export function CircleTree({ tree, width, height, onOpen }: { tree: Tree; width: number; height: number; onOpen: (id: string) => void }) {
  const layout = useMemo(() => radialLayout(tree), [tree]);
  const step = Math.min(MAX_STEP, Math.max(MIN_STEP, (LABEL_W * 1.05) / layout.tightest));
  const half = Math.max(layout.rings, 1) * step + 80;
  const full = half * 2;
  const fit = Math.min(width, height) / full;
  const [zoom, setZoom] = useState(() => clampZoom(Math.max(fit, 0.55)));
  const size = full * zoom;
  const px = (n: RadialNode) => ({ x: half * zoom + n.x * step * zoom, y: half * zoom + n.y * step * zoom });
  const at = useMemo(() => new Map(layout.nodes.map((n) => [n.person.id, n])), [layout]);
  const sky = useMemo(() => stars(full), [full]);

  // Fade the picture in once. Nothing keeps moving afterwards, so the phone stays cool and quick.
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced === null) return;
    if (reduced) return fade.setValue(1);
    Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: native }).start();
  }, [reduced, fade]);

  // Start with you in the middle of the screen.
  const outer = useRef<ScrollViewInstance>(null);
  const inner = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      outer.current?.scrollTo({ y: Math.max(0, (size - height) / 2), animated: false });
      inner.current?.scrollTo({ x: Math.max(0, (size - width) / 2), animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [size, width, height]);

  const z = zoom;
  // Brothers and sisters who share a parent on screen are already joined through that parent.
  const parentsOf = (id: string) =>
    new Set(layout.relations.filter((r) => r.type === "parent" && r.b_id === id && r.status === "active").map((r) => r.a_id));
  const shown = layout.relations.filter((r) => {
    if (r.type !== "sibling") return true;
    const pa = parentsOf(r.a_id);
    return ![...parentsOf(r.b_id)].some((p) => pa.has(p));
  });

  const c = half * z;
  const polar = (angle: number, radius: number) => ({ x: c + Math.cos(angle) * radius, y: c + Math.sin(angle) * radius });
  const lines = shown.map((r) => {
    const a = at.get(r.a_id)!;
    const b = at.get(r.b_id)!;
    const p = px(a);
    const q = px(b);
    let d: string;
    if (a.ring !== b.ring) {
      // Between rings: leave each person heading outwards, like branches of a round tree.
      const mid = ((a.ring + b.ring) / 2) * step * z;
      const c1 = a.ring === 0 ? polar(b.angle, mid) : polar(a.angle, mid);
      const c2 = polar(b.angle, mid);
      d = `M${p.x} ${p.y} C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${q.x} ${q.y}`;
    } else {
      // On the same ring (husband and wife, brothers and sisters): a soft arc towards the middle.
      const mx = c + ((p.x + q.x) / 2 - c) * 0.85;
      const my = c + ((p.y + q.y) / 2 - c) * 0.85;
      d = `M${p.x} ${p.y} Q${mx} ${my} ${q.x} ${q.y}`;
    }
    const nearMe = r.a_id === tree.root || r.b_id === tree.root;
    const pending = r.status === "pending";
    const stroke = pending ? colors.pending : r.divorced ? colors.muted : r.type === "sibling" ? colors.teal : r.type === "spouse" ? colors.goldSoft : colors.gold;
    const dash = pending || r.divorced ? [6 * z, 6 * z] : r.type === "sibling" ? [2 * z, 6 * z] : undefined;
    const w = (r.type === "spouse" ? 2.6 : nearMe ? 2.2 : 1.6) * Math.max(z, 0.6);
    return (
      <Path
        key={r.id}
        d={d}
        stroke={stroke}
        strokeWidth={w}
        strokeDasharray={dash}
        strokeLinecap="round"
        opacity={pending || r.divorced ? 0.85 : nearMe ? 0.95 : 0.7}
        fill="none"
      />
    );
  });

  return (
    <View style={{ width, height }}>
      <ScrollView ref={outer} style={{ flex: 1 }} contentContainerStyle={{ minHeight: height, justifyContent: "center" }} showsVerticalScrollIndicator={false}>
        <ScrollView
          ref={inner}
          horizontal
          contentContainerStyle={{ minWidth: width, justifyContent: "center" }}
          showsHorizontalScrollIndicator={false}
        >
          <Animated.View style={{ width: size, height: size, opacity: fade }}>
            <Svg width={size} height={size} style={StyleSheet.absoluteFill} aria-hidden>
              {sky.map((s, i) => (
                <Circle key={`s${i}`} cx={s.x * z} cy={s.y * z} r={s.r} fill={colors.text} opacity={s.o} />
              ))}
              {Array.from({ length: layout.rings }, (_, i) => (
                <Circle key={`r${i}`} cx={half * z} cy={half * z} r={(i + 1) * step * z} stroke={colors.lanternBorder} strokeWidth={1} strokeDasharray={[3, 7]} fill="none" opacity={0.7} />
              ))}
              {lines}
            </Svg>
            {layout.nodes.map((n) => (
              <Person key={n.person.id} node={n} pos={px(n)} zoom={z} isMe={n.person.id === tree.me} isCentre={n.ring === 0} onPress={() => onOpen(n.person.id)} />
            ))}
          </Animated.View>
        </ScrollView>
      </ScrollView>

      <View style={styles.zoom}>
        <ZoomButton label="+" a11y="Zoom in" onPress={() => setZoom((v) => clampZoom(v * 1.25))} />
        <ZoomButton label="−" a11y="Zoom out" onPress={() => setZoom((v) => clampZoom(v / 1.25))} />
        <ZoomButton label="◎" a11y="Show everyone" onPress={() => setZoom(clampZoom(fit))} />
      </View>
    </View>
  );
}

function clampZoom(v: number) {
  return Math.min(1.6, Math.max(0.3, v));
}

function ZoomButton({ label, a11y, onPress }: { label: string; a11y: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={onPress} style={styles.zoomBtn}>
      <Text style={styles.zoomText}>{label}</Text>
    </Pressable>
  );
}

function Person({ node, pos, zoom, isMe, isCentre, onPress }: { node: RadialNode; pos: { x: number; y: number }; zoom: number; isMe: boolean; isCentre: boolean; onPress: () => void }) {
  const p = node.person;
  const passed = p.is_living === 0;
  const big = isCentre ? ME_DOT : DOT;
  const d = big * Math.max(zoom, 0.55);
  const w = LABEL_W * Math.max(zoom, 0.55);
  const nameSize = Math.max(10, (isCentre ? 15 : 13) * zoom);
  const metaSize = Math.max(9, 11 * zoom);
  const ring = isMe ? colors.gold : node.pending ? colors.pending : passed ? colors.lanternBorder : colors.cardBorder;
  const a11y = [node.label, p.full_name, passed ? "passed away" : "", node.pending ? "awaiting approval" : ""].filter(Boolean).join(", ");

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={{ position: "absolute", left: pos.x - w / 2, top: pos.y - d / 2, width: w, alignItems: "center" }}
    >
      <View
        style={[
          {
            width: d,
            height: d,
            borderRadius: d / 2,
            borderWidth: isMe ? 2.5 : node.pending ? 2 : 1.5,
            borderStyle: node.pending ? "dashed" : "solid",
            borderColor: ring,
            backgroundColor: isMe ? colors.meCard : passed ? colors.lantern : colors.card,
            alignItems: "center",
            justifyContent: "center",
          },
          isMe && (Platform.OS === "web" ? ({ boxShadow: `0 0 ${18 * zoom}px ${colors.gold}` } as object) : { shadowColor: colors.gold, shadowOpacity: 0.8, shadowRadius: 12, elevation: 8 }),
        ]}
      >
        <Text style={{ fontFamily: fonts.displayBold, fontSize: Math.max(10, d * 0.34), color: isMe ? colors.goldSoft : passed ? colors.muted : colors.text }}>
          {passed ? "☾" : initials(p.full_name)}
        </Text>
      </View>
      <View style={styles.tag}>
      <Text numberOfLines={2} style={{ fontFamily: fonts.bodyMedium, fontSize: nameSize, lineHeight: nameSize * 1.2, color: isMe ? colors.goldSoft : passed ? "#C9CFEA" : colors.text, textAlign: "center" }}>
        {p.full_name}
      </Text>
      <Text numberOfLines={1} style={{ fontFamily: fonts.body, fontSize: metaSize, color: node.pending ? colors.amber : colors.muted, textAlign: "center" }}>
        {node.pending ? "Awaiting approval" : node.label}
      </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  zoom: { position: "absolute", right: 12, bottom: 16, gap: 8 },
  tag: { marginTop: 3, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 6, backgroundColor: "rgba(11, 16, 38, 0.78)", alignItems: "center", maxWidth: "100%" },
  zoomBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.gold,
    backgroundColor: "rgba(7, 11, 28, 0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  zoomText: { fontFamily: fonts.bodyBold, fontSize: 20, color: colors.gold },
});
