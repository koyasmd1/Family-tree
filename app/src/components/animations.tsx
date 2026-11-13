// Animations from the One Family design page, built with React Native's
// Animated API so they run on iPhone, Android and the website.
import { useEffect, useRef, type ReactNode } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, View } from "react-native";
import { colors } from "@/lib/theme";

const native = Platform.OS !== "web";

function useReducedMotion() {
  const reduced = useRef(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => (reduced.current = v))
      .catch(() => undefined);
  }, []);
  return reduced;
}

/** A value that swings 0 → 1 → 0 forever. */
export function useLoop(duration: number, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
        Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      ]),
    );
    const t = setTimeout(() => {
      if (!reduced.current) loop.start();
    }, 50);
    return () => {
      clearTimeout(t);
      loop.stop();
    };
  }, [v, duration, delay, reduced]);
  return v;
}

/** 12 "Generations Rise": each row slides up into place, oldest first. */
export function Rise({ index, children }: { index: number; children: ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 500,
      delay: index * 140,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: native,
    }).start();
  }, [v, index]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

/** 01 "Seed to Tree": a trunk grows and the branches and leaves light up. */
export function SeedToTree({ size = 160 }: { size?: number }) {
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(grow, { toValue: 1, duration: 2200, easing: Easing.out(Easing.cubic), useNativeDriver: native }),
        Animated.delay(1600),
        Animated.timing(grow, { toValue: 0, duration: 600, useNativeDriver: native }),
      ]),
    ).start();
  }, [grow]);
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
