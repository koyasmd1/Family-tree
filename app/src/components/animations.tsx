// Animations from the One Family design page, built with React Native's
// Animated API so they run on iPhone, Android and the website.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, View, type LayoutChangeEvent } from "react-native";
import { colors } from "@/lib/theme";

export const native = Platform.OS !== "web";

/**
 * Whether the person asked their phone or computer to reduce motion.
 * null while we don't know yet, so animations wait instead of flashing.
 */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setReduced(v))
      .catch(() => alive && setReduced(false));
    const sub = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (v: boolean) => setReduced(v));
    return () => {
      alive = false;
      sub?.remove?.();
    };
  }, []);
  return reduced;
}

/** Easing curves made once, so effects that depend on them don't restart. */
export const EASE = {
  inOut: Easing.inOut(Easing.cubic),
  out: Easing.out(Easing.cubic),
  in: Easing.in(Easing.quad),
  linear: Easing.linear,
};

/** A value that swings 0 → 1 → 0 forever. */
export function useLoop(duration: number, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced !== false) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, duration, delay, reduced]);
  return v;
}

/**
 * A value that runs 0 → 1, once or again and again (jumping back to 0).
 * With reduced motion it simply sits at `still`, a frame that shows the whole picture.
 * It uses the JavaScript driver so it can move SVG shapes and colours too.
 */
export function useTimeline(
  duration: number,
  { loop = true, delay = 0, hold = 0, still = 1, easing = EASE.inOut }: { loop?: boolean; delay?: number; hold?: number; still?: number; easing?: (t: number) => number } = {},
) {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced === null) return;
    if (reduced) {
      v.setValue(still);
      return;
    }
    v.setValue(0);
    const run = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration, easing, useNativeDriver: false }),
      Animated.delay(hold),
    ]);
    const anim = loop ? Animated.loop(Animated.sequence([run, Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: false })])) : run;
    anim.start();
    return () => anim.stop();
  }, [v, duration, delay, hold, loop, still, reduced, easing]);
  return v;
}

/** Part of a timeline: goes from `from` to `to` while the timeline moves from a to b. */
export const seg = (v: Animated.Value, a: number, b: number, from = 0, to = 1) =>
  v.interpolate({ inputRange: [a, b], outputRange: [from, to], extrapolate: "clamp" });

/** 12 "Generations Rise": each row slides up into place, oldest first. */
export function Rise({ index, children, onLayout }: { index: number; children: ReactNode; onLayout?: (e: LayoutChangeEvent) => void }) {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced === null) return;
    if (reduced) return v.setValue(1);
    Animated.timing(v, {
      toValue: 1,
      duration: 500,
      delay: index * 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    }).start();
  }, [v, index, reduced]);
  return (
    <Animated.View onLayout={onLayout} style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

/** 01 "Seed to Tree": a trunk grows and the branches and leaves light up. */
export function SeedToTree({ size = 160 }: { size?: number }) {
  const grow = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced === null) return;
    if (reduced) return grow.setValue(1);
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(grow, { toValue: 1, duration: 2200, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
        Animated.delay(1600),
        Animated.timing(grow, { toValue: 0, duration: 600, useNativeDriver: native }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [grow, reduced]);
  const s = size / 160;
  const trunk = grow.interpolate({ inputRange: [0, 0.4], outputRange: [0, 1], extrapolate: "clamp" });
  const branches = grow.interpolate({ inputRange: [0.35, 0.7], outputRange: [0, 1], extrapolate: "clamp" });
  const leaves = grow.interpolate({ inputRange: [0.65, 0.9, 1], outputRange: [0, 1.2, 1], extrapolate: "clamp" });
  const leaf = (x: number, y: number, r: number) => (
    <Animated.View
      key={`${x}-${y}`}
      style={{
        position: "absolute",
        left: (x - r) * s,
        top: (y - r) * s,
        width: r * 2 * s,
        height: r * 2 * s,
        borderRadius: r * s,
        backgroundColor: colors.gold,
        transform: [{ scale: leaves }],
        opacity: branches,
      }}
    />
  );
  const branch = (x: number, y: number, len: number, deg: number) => (
    <Animated.View
      key={`b${x}${deg}`}
      style={{
        position: "absolute",
        left: x * s - 1.5 * s,
        top: y * s - len * s,
        width: 3 * s,
        height: len * s,
        borderRadius: 2,
        backgroundColor: colors.teal,
        opacity: branches,
        transform: [{ translateY: (len * s) / 2 }, { rotate: `${deg}deg` }, { translateY: (-len * s) / 2 }],
      }}
    />
  );
  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View
        style={{
          position: "absolute",
          left: 78.5 * s,
          top: 70 * s,
          width: 3 * s,
          height: 85 * s,
          borderRadius: 2,
          backgroundColor: colors.teal,
          transform: [{ translateY: 42.5 * s }, { scaleY: trunk }, { translateY: -42.5 * s }],
        }}
      />
      {branch(80, 100, 48, -45)}
      {branch(80, 100, 48, 45)}
      {branch(80, 80, 40, 0)}
      {leaf(46, 66, 7)}
      {leaf(114, 66, 7)}
      {leaf(80, 38, 8)}
    </View>
  );
}
