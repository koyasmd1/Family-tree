import { useEffect, useMemo, useRef } from "react";
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import type { Tree } from "@/lib/api";
import { years } from "@/lib/family";
import { familyView, type Member } from "@/lib/familyView";
import { colors, fonts, householdColours } from "@/lib/theme";
import { native, useReducedMotion } from "./animations";

const W = 138; // card width
const H = 92; // card height
const GAP = 14; // between cards in a row
const SPOUSE_GAP = 26; // between a person and their husband or wife (room for the ring)
const UNIT_GAP = 30; // between brothers' and sisters' families
const V = 56; // between rows
const PAD = 20;

type Kind = "focus" | "focusSpouse" | "spouse" | "parent" | "sibling" | "child";
interface Card {
  m: Member;
  kind: Kind;
  x: number;
  y: number;
  /** The household colour, for a brother's or sister's family. */
  tint?: string;
}

/**
 * One person's family: parents above; the person with their brothers and sisters in one row,
 * each with their husband or wife beside them; everyone's children below their own parents.
 * Tapping anyone moves the view to them.
 */
export function FamilyView({ tree, width, height, onFocus, onOpen }: { tree: Tree; width: number; height: number; onFocus: (id: string) => void; onOpen: (id: string) => void }) {
  const view = useMemo(() => familyView(tree), [tree]);

  const plan = useMemo(() => {
    if (!view) return null;
    const cards: Card[] = [];
    const lines: { d: string; kind: "parent" | "spouse" | "divorced"; tint?: string }[] = [];
    const rings: { x: number; y: number; tint?: string }[] = [];
    const hasParents = view.parents.length > 0;
    const y0 = PAD;
    const y1 = hasParents ? y0 + H + V : PAD;
    const hasKids = view.units.some((u) => u.children.length > 0);
    const y2 = y1 + H + V;

    // Lay the families out left to right.
    let x = PAD;
    const mains: { cx: number }[] = [];
    for (const u of view.units) {
      const top = W * (1 + u.spouses.length) + SPOUSE_GAP * u.spouses.length;
      const bottom = u.children.length ? u.children.length * W + (u.children.length - 1) * GAP : 0;
      const unitW = Math.max(top, bottom);
      const topX = x + (unitW - top) / 2;
      const tint = householdColours[u.colour % householdColours.length];
      cards.push({ m: u.main, kind: u.isFocus ? "focus" : "sibling", x: topX, y: y1, tint });
      mains.push({ cx: topX + W / 2 });
      u.spouses.forEach((s, i) => {
        const sx = topX + (i + 1) * (W + SPOUSE_GAP);
        cards.push({ m: s, kind: u.isFocus ? "focusSpouse" : "spouse", x: sx, y: y1, tint });
        lines.push({ d: `M${sx - SPOUSE_GAP} ${y1 + H / 2} L${sx} ${y1 + H / 2}`, kind: s.divorced ? "divorced" : "spouse", tint });
        if (!s.divorced) rings.push({ x: sx - SPOUSE_GAP / 2, y: y1 + H / 2, tint });
      });
      if (u.children.length) {
        // The children's line starts between the parents (or under a single parent).
        const sx = u.spouses.length ? topX + W + SPOUSE_GAP / 2 : topX + W / 2;
        const sy = u.spouses.length ? y1 + H / 2 : y1 + H;
        const barY = y2 - V / 2;
        const kidX = x + (unitW - bottom) / 2;
        const centres = u.children.map((_, i) => kidX + i * (W + GAP) + W / 2);
        lines.push({ d: `M${sx} ${sy} L${sx} ${barY}`, kind: "parent", tint });
        lines.push({ d: `M${Math.min(sx, centres[0])} ${barY} L${Math.max(sx, centres[centres.length - 1])} ${barY}`, kind: "parent", tint });
        u.children.forEach((c, i) => {
          cards.push({ m: c, kind: "child", x: kidX + i * (W + GAP), y: y2, tint });
          lines.push({ d: `M${centres[i]} ${barY} L${centres[i]} ${y2}`, kind: "parent", tint });
        });
      }
      x += unitW + UNIT_GAP;
    }
    let right = x - UNIT_GAP + PAD;

    // Parents, centred above their children.
    if (hasParents) {
      const mid = (mains[0].cx + mains[mains.length - 1].cx) / 2;
      const pw = view.parents.length * W + (view.parents.length - 1) * SPOUSE_GAP;
      const px = Math.max(PAD, mid - pw / 2);
      const shift = px - (mid - pw / 2);
      if (shift > 0) {
        // Parents would hang off the left edge: move everyone else right instead.
        for (const c of cards) c.x += shift;
        for (const m of mains) m.cx += shift;
        lines.forEach((l) => (l.d = l.d.replace(/([ML])(-?[\d.]+)/g, (_, k, n) => `${k}${Number(n) + shift}`)));
        rings.forEach((r) => (r.x += shift));
        right += shift;
      }
      // The parents' family colour, shared with their children who are not married yet.
      const home = householdColours[0];
      view.parents.forEach((p, i) => cards.push({ m: p, kind: "parent", x: px + i * (W + SPOUSE_GAP), y: y0, tint: home }));
      if (view.parents.length === 2) {
        lines.push({ d: `M${px + W} ${y0 + H / 2} L${px + W + SPOUSE_GAP} ${y0 + H / 2}`, kind: "spouse", tint: home });
        rings.push({ x: px + W + SPOUSE_GAP / 2, y: y0 + H / 2, tint: home });
      }
      const sx = view.parents.length === 2 ? px + W + SPOUSE_GAP / 2 : px + W / 2;
      const sy = view.parents.length === 2 ? y0 + H / 2 : y0 + H;
      const barY = y1 - V / 2;
      const first = mains[0].cx;
      const last = mains[mains.length - 1].cx;
      lines.push({ d: `M${sx} ${sy} L${sx} ${barY}`, kind: "parent", tint: home });
      lines.push({ d: `M${Math.min(sx, first)} ${barY} L${Math.max(sx, last)} ${barY}`, kind: "parent", tint: home });
      mains.forEach((m) => lines.push({ d: `M${m.cx} ${barY} L${m.cx} ${y1}`, kind: "parent", tint: home }));
      right = Math.max(right, px + pw + PAD);
    }
    const bottom = (hasKids ? y2 + H : y1 + H) + PAD;
    const focusCard = cards.find((c) => c.kind === "focus")!;
    return { cards, lines, rings, w: right, h: bottom, focusCard };
  }, [view, width]);

  // Centre on the focus person.
  const outer = useRef<ScrollViewInstance>(null);
  const inner = useRef<ScrollViewInstance>(null);
  useEffect(() => {
    if (!plan) return;
    const t = setTimeout(() => {
      inner.current?.scrollTo({ x: Math.max(0, plan.focusCard.x + W / 2 - width / 2), animated: false });
      outer.current?.scrollTo({ y: Math.max(0, plan.focusCard.y + H / 2 - height / 2), animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [plan, width, height]);

  // Fade in once each time the view moves to someone new. Nothing loops.
  const reduced = useReducedMotion();
  const fade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced === null) return;
    if (reduced) return fade.setValue(1);
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: 350, useNativeDriver: native }).start();
  }, [reduced, fade, tree.root]);

  if (!view || !plan) return null;

  return (
    <ScrollView ref={outer} style={{ width, height }} contentContainerStyle={{ minHeight: height, justifyContent: "center" }}>
      <ScrollView ref={inner} horizontal contentContainerStyle={{ minWidth: width, justifyContent: "center" }} showsHorizontalScrollIndicator={false}>
        <Animated.View style={{ width: plan.w, height: plan.h, opacity: fade }}>
          <Svg width={plan.w} height={plan.h} style={StyleSheet.absoluteFill} aria-hidden>
            {plan.lines.map((l, i) => (
              <Path
                key={i}
                d={l.d}
                stroke={l.kind === "divorced" ? colors.muted : l.tint ?? (l.kind === "spouse" ? colors.goldSoft : colors.gold)}
                strokeWidth={l.kind === "spouse" ? 2.5 : l.tint ? 2.2 : 1.8}
                strokeDasharray={l.kind === "divorced" ? [6, 6] : undefined}
                opacity={l.kind === "parent" ? 0.75 : 1}
                fill="none"
              />
            ))}
            {plan.rings.map((r, i) => (
              <Circle key={i} cx={r.x} cy={r.y} r={6} stroke={r.tint ?? colors.goldSoft} strokeWidth={2} fill={colors.night} />
            ))}
          </Svg>
          {plan.cards.map((c) => (
            <FamilyCard
              key={c.m.person.id}
              card={c}
              onPress={() => (c.kind === "focus" ? onOpen(c.m.person.id) : onFocus(c.m.person.id))}
            />
          ))}
        </Animated.View>
      </ScrollView>
    </ScrollView>
  );
}

/** Mixes a household colour into the dark card colour, so the tint stays soft. */
function soften(hex: string, amount: number) {
  const n = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  const base = colors.card;
  const mix = (i: number) => Math.round(n(base, i) * (1 - amount) + n(hex, i) * amount);
  return `rgb(${mix(1)}, ${mix(3)}, ${mix(5)})`;
}

function FamilyCard({ card, onPress }: { card: Card; onPress: () => void }) {
  const { m, kind, tint } = card;
  const p = m.person;
  const passed = p.is_living === 0;
  const focus = kind === "focus";
  const spouse = kind === "spouse" || kind === "focusSpouse";
  const yrs = passed ? `${p.birth_year ?? "?"}–${p.death_year ?? "?"}` : years(p);
  const a11y = [m.label, p.full_name, yrs, passed ? "passed away" : "", m.pending ? "awaiting approval" : "", focus ? "open profile" : "show their family"]
    .filter(Boolean)
    .join(", ");
  // Relatives who passed away: the same card, gently greyed, with "In memory" and their years.
  // The household colour stays as a thin stripe so you can still see which family they belong to.
  const background = passed ? colors.lantern : tint ? soften(tint, focus ? 0.12 : 0.18) : undefined;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      onPress={onPress}
      style={[
        styles.card,
        { left: card.x, top: card.y },
        spouse && !tint && styles.spouse,
        tint && { borderColor: tint, backgroundColor: background },
        spouse && tint && { borderStyle: "solid", borderWidth: 1 },
        passed && styles.passed,
        passed && tint && { borderLeftColor: tint, borderLeftWidth: 4 },
        m.pending && styles.pending,
        focus && styles.focus,
        focus && background && { backgroundColor: background },
        focus && (Platform.OS === "web" ? ({ boxShadow: `0 0 22px ${colors.gold}` } as object) : styles.focusShadow),
      ]}
    >
      <Text style={[styles.label, tint && !passed && { color: tint }, focus && { color: colors.gold }]} numberOfLines={1}>
        {spouse ? "♥ " : ""}
        {m.label}
      </Text>
      <Text style={[styles.name, focus && { color: colors.goldSoft }, passed && styles.passedName]} numberOfLines={passed ? 1 : 2}>
        {p.full_name}
      </Text>
      {m.pending ? (
        <Text style={styles.waiting}>Awaiting approval</Text>
      ) : passed ? (
        <>
          <Text style={styles.memory}>In memory</Text>
          <Text style={styles.meta} numberOfLines={1}>{yrs}</Text>
        </>
      ) : (
        !!yrs && <Text style={styles.meta} numberOfLines={1}>{yrs}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    width: W,
    height: H,
    padding: 10,
    gap: 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    backgroundColor: colors.card,
    justifyContent: "center",
  },
  // Husbands and wives: a warm rose-gold card, so they stand apart from brothers and sisters.
  spouse: { backgroundColor: "#2A1E36", borderColor: "#B98AA8", borderWidth: 1.5 },
  focusSpouse: { borderColor: colors.goldSoft, borderWidth: 2 },
  passed: { backgroundColor: "#151A2E", borderColor: "#4A5070", borderWidth: 1 },
  passedName: { color: "#AEB3C8" },
  memory: { fontFamily: fonts.body, fontSize: 11, color: "#8E94AE", fontStyle: "italic" },
  pending: { borderStyle: "dashed", borderColor: colors.pending, borderWidth: 2 },
  focus: { backgroundColor: colors.meCard, borderColor: colors.gold, borderWidth: 2.5 },
  focusShadow: { shadowColor: colors.gold, shadowOpacity: 0.8, shadowRadius: 14, elevation: 8 },
  label: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.6, color: colors.muted, textTransform: "uppercase" },
  name: { fontFamily: fonts.display, fontSize: 16, lineHeight: 19, color: colors.text },
  meta: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  waiting: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.amber },
});
