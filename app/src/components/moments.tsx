// The animations from the One Family design page (numbers match the design page),
// drawn with react-native-svg and React Native's Animated API so they run on
// iPhone, Android and the website. Every one is decorative and hidden from screen
// readers; the words next to it say what happened. With "reduce motion" switched on,
// each one shows a still picture instead.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Animated, StyleSheet, Text, View, type ViewStyle } from "react-native";
import Svg, { Circle, Defs, Ellipse, G, Line, Path, RadialGradient, Stop } from "react-native-svg";
import { colors, fonts } from "@/lib/theme";
import { APath, ACircle, AEllipse } from "./svgAnimated";
import { EASE, native, seg, useReducedMotion, useTimeline } from "./animations";


const purple = "#C99BE0";
const hidden = { "aria-hidden": true, accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" } as const;

/** A stroke that draws itself while the timeline goes from a to b (length must be at least the real path length). */
const drawn = (v: Animated.Value, a: number, b: number, length: number) =>
  v.interpolate({ inputRange: [a, b], outputRange: [length, 0], extrapolate: "clamp" });

/** The 220 × 200 drawing area used on the design page, scaled to `size` wide. */
function Stage({ size, children, height = 200 }: { size: number; children: ReactNode; height?: number }) {
  return (
    <View {...hidden} pointerEvents="none" style={{ width: size, height: (size * height) / 220 }}>
      <Svg width={size} height={(size * height) / 220} viewBox={`0 0 220 ${height}`} fill="none">
        {children}
      </Svg>
    </View>
  );
}

/** A unique id that is safe to use inside an SVG url(#…). */
function useSvgId(prefix: string) {
  return prefix + useId().replace(/[^a-zA-Z0-9]/g, "");
}

/** A tiny native-driver spin, for things that go round and round. */
function useSpin(duration: number) {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced !== false) return;
    const anim = Animated.loop(Animated.timing(v, { toValue: 1, duration, easing: EASE.linear, useNativeDriver: native }));
    anim.start();
    return () => anim.stop();
  }, [v, duration, reduced]);
  return v;
}

/* ───────────────────────── 04 Family Constellation ───────────────────────── */

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const STARS = (() => {
  const r = seeded(7);
  return Array.from({ length: 90 }, (_, i) => ({ x: r() * 100, y: r() * 100, r: 0.5 + r() * 1.1, group: i % 3 }));
})();

// Small groups of stars joined by lines, in percent of the screen.
const CONSTELLATIONS = [
  [[8, 12], [20, 9], [31, 14], [27, 21], [14, 20]],
  [[70, 30], [80, 26], [91, 31], [85, 38]],
  [[12, 62], [26, 66], [40, 63], [48, 70], [38, 77]],
  [[74, 82], [86, 78], [93, 88]],
];

const pct = (n: number) => `${n}%`;

/** 04: a quiet night sky with families joined into constellations, behind the tree. */
export function Constellation() {
  const groups = [useTwinkle(5200, 0), useTwinkle(6100, 1800), useTwinkle(4700, 3200)];
  return (
    <View {...hidden} pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%">
        {CONSTELLATIONS.map((c, i) =>
          c.slice(1).map((p, k) => (
            <Line key={`${i}-${k}`} x1={pct(c[k][0])} y1={pct(c[k][1])} x2={pct(p[0])} y2={pct(p[1])} stroke={colors.line} strokeWidth={1} opacity={0.35} />
          )),
        )}
        {CONSTELLATIONS.flat().map(([x, y], i) => (
          <Circle key={`c${i}`} cx={pct(x)} cy={pct(y)} r={1.8} fill={colors.goldSoft} opacity={0.5} />
        ))}
      </Svg>
      {groups.map((opacity, g) => (
        <Animated.View key={g} style={[StyleSheet.absoluteFill, { opacity }]}>
          <Svg width="100%" height="100%">
            {STARS.filter((s) => s.group === g).map((s, i) => (
              <Circle key={i} cx={pct(s.x)} cy={pct(s.y)} r={s.r} fill={colors.text} />
            ))}
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
}

function useTwinkle(duration: number, delay: number) {
  const v = useRef(new Animated.Value(0.5)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced !== false) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 0.15, duration: duration / 2, easing: EASE.inOut, useNativeDriver: native }),
        Animated.timing(v, { toValue: 0.6, duration: duration / 2, easing: EASE.inOut, useNativeDriver: native }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [v, duration, delay, reduced]);
  return v;
}

/* ───────────────────────── 05 Ripple of Kinship ───────────────────────── */

/** 05: rings spread out from your card when the tree opens. */
export function Ripple() {
  const rings = [0, 1, 2].map((i) => useRing(i * 700));
  return (
    <View {...hidden} pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>
      {rings.map((v, i) => (
        <Animated.View
          key={i}
          style={{
            position: "absolute",
            width: 120,
            height: 120,
            borderRadius: 60,
            borderWidth: 2,
            borderColor: colors.gold,
            opacity: v.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.7, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 3.2] }) }],
          }}
        />
      ))}
    </View>
  );
}

function useRing(delay: number) {
  const v = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced !== false) return;
    const once = Animated.timing(v, { toValue: 1, duration: 2200, easing: EASE.out, useNativeDriver: native });
    const anim = Animated.sequence([
      Animated.delay(600 + delay),
      Animated.loop(Animated.sequence([Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: native }), once]), { iterations: 2 }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [v, delay, reduced]);
  return v;
}

/* ───────────────────────── 06 Woven Threads ───────────────────────── */

/** 06: at a marriage, two family threads weave together and tie a knot. */
export function WovenThreads({ size = 220 }: { size?: number }) {
  const v = useTimeline(2600, { hold: 1400 });
  return (
    <Stage size={size}>
      <APath
        d="M10 100 C40 40 70 160 110 100 C150 40 180 160 210 100"
        stroke={colors.teal}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={[280, 280]}
        strokeDashoffset={drawn(v, 0, 0.6, 280)}
      />
      <APath
        d="M210 100 C180 40 150 160 110 100 C70 40 40 160 10 100"
        stroke={purple}
        strokeWidth={4}
        strokeLinecap="round"
        strokeDasharray={[280, 280]}
        strokeDashoffset={drawn(v, 0.05, 0.65, 280)}
      />
      <ACircle cx={110} cy={100} r={v.interpolate({ inputRange: [0.55, 0.7, 0.8], outputRange: [0, 14, 10], extrapolate: "clamp" })} stroke={colors.goldSoft} strokeWidth={3} fill={colors.night} />
      <ACircle cx={110} cy={100} r={seg(v, 0.7, 0.85, 0, 4)} fill={colors.gold} />
    </Stage>
  );
}

/* ───────────────────────── 09 Birth Bloom ───────────────────────── */

/** 09: golden petals open around a new name, like a flower. */
export function BirthBloom({ size = 220 }: { size?: number }) {
  const v = useTimeline(2400, { hold: 1600 });
  return (
    <Stage size={size}>
      {Array.from({ length: 8 }, (_, i) => {
        const start = 0.1 + i * 0.05;
        return (
          <G key={i} transform={`rotate(${i * 45} 110 100)`}>
            <AEllipse
              cx={110}
              cy={seg(v, start, start + 0.35, 100, 64)}
              rx={seg(v, start, start + 0.35, 2, 11)}
              ry={seg(v, start, start + 0.35, 2, 26)}
              fill={i % 2 ? colors.goldSoft : colors.gold}
              opacity={0.85}
            />
          </G>
        );
      })}
      <ACircle cx={110} cy={100} r={v.interpolate({ inputRange: [0, 0.15, 0.25], outputRange: [0, 16, 13], extrapolate: "clamp" })} fill={colors.amber} />
    </Stage>
  );
}

/* ───────────────────────── 10 One Earth ───────────────────────── */

const MERIDIAN_STEPS = 24;
/** Width of a meridian on a turning globe, sampled so Animated can interpolate it. */
function meridian(v: Animated.Value, phase: number, radius: number) {
  const inputRange = Array.from({ length: MERIDIAN_STEPS + 1 }, (_, i) => i / MERIDIAN_STEPS);
  const outputRange = inputRange.map((t) => Math.abs(Math.sin(Math.PI * (t + phase))) * radius);
  return v.interpolate({ inputRange, outputRange });
}

/** 10: a turning globe where lines from every corner meet at one shared heart. */
export function OneEarth({ size = 220 }: { size?: number }) {
  const turn = useTimeline(7000, { easing: EASE.linear, still: 0.3 });
  const v = useTimeline(2800, { hold: 1800 });
  const ends = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    return [110 + Math.cos(a) * 96, 100 + Math.sin(a) * 92];
  });
  return (
    <Stage size={size}>
      <Circle cx={110} cy={100} r={56} fill="#10264A" stroke={colors.teal} strokeWidth={2} />
      <Line x1={54} y1={100} x2={166} y2={100} stroke="#3E8C88" strokeWidth={1.5} />
      {[0, 1 / 3, 2 / 3].map((p) => (
        <AEllipse key={p} cx={110} cy={100} rx={meridian(turn, p, 56)} ry={56} stroke="#3E8C88" strokeWidth={1.5} />
      ))}
      {ends.map(([x, y], i) => (
        <G key={i}>
          <APath
            d={`M${x} ${y} L110 100`}
            stroke={colors.gold}
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={[110, 110]}
            strokeDashoffset={drawn(v, i * 0.05, 0.5 + i * 0.05, 110)}
          />
          <Circle cx={x} cy={y} r={4} fill={colors.goldSoft} />
        </G>
      ))}
      <G opacity={1}>
        <APath
          d="M110 112 C96 102 92 94 98 89 C103 85 108 88 110 92 C112 88 117 85 122 89 C128 94 124 102 110 112 Z"
          fill={colors.amber}
          opacity={seg(v, 0.75, 0.9)}
        />
      </G>
    </Stage>
  );
}

/* ───────────────────────── 11 Golden Path ───────────────────────── */

const STEP_HEIGHT = 56;

/** 11: a light walks the exact path between you and a relative. */
export function GoldenPath({ steps }: { steps: { name: string; relation: string }[] }) {
  const v = useTimeline(Math.max(1800, steps.length * 700), { hold: 900 });
  const n = steps.length;
  const travel = (n - 1) * STEP_HEIGHT;
  return (
    <View style={{ position: "relative" }}>
      <View {...hidden} pointerEvents="none" style={[styles.pathLine, { height: travel }]} />
      <Animated.View
        {...hidden}
        pointerEvents="none"
        style={[styles.pathLight, { transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }] }]}
      />
      {steps.map((s, i) => {
        const f = n === 1 ? 0 : i / (n - 1);
        return (
          <View key={i} style={styles.pathStep}>
            <Animated.View
              {...hidden}
              style={[styles.pathDot, { opacity: v.interpolate({ inputRange: [Math.max(0, f - 0.08), f, Math.min(1, f + 0.3)], outputRange: [0.35, 1, 0.7], extrapolate: "clamp" }) }]}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.pathName} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.pathRelation} numberOfLines={1}>
                {s.relation}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ───────────────────────── 13 Written in Ink ───────────────────────── */

/** 13: a name is written letter by letter, then underlined in gold. */
export function InkTitle({ text }: { text: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const line = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced === null) return;
    if (reduced) {
      setShown(text.length);
      line.setValue(1);
      return;
    }
    setShown(0);
    line.setValue(0);
    let i = 0;
    const perLetter = Math.max(28, Math.min(90, 1400 / Math.max(1, text.length)));
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= text.length) {
        clearInterval(id);
        Animated.timing(line, { toValue: 1, duration: 600, easing: EASE.out, useNativeDriver: false }).start();
      }
    }, perLetter);
    return () => clearInterval(id);
  }, [text, reduced, line]);
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={text} style={{ alignSelf: "flex-start", maxWidth: "100%" }}>
      <Text style={styles.ink}>
        {text.slice(0, shown)}
        <Text style={{ color: "transparent" }}>{text.slice(shown)}</Text>
      </Text>
      <Animated.View style={{ height: 2, borderRadius: 1, backgroundColor: colors.gold, width: line.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }} />
    </View>
  );
}

/* ───────────────────────── 14 Sibling Orbit ───────────────────────── */

/** 14: brothers and sisters circle their parents like moons. Used while loading. */
export function SiblingOrbit({ size = 160 }: { size?: number }) {
  const spins = [useSpin(2400), useSpin(3600), useSpin(5200)];
  const radii = [0.22, 0.32, 0.43];
  return (
    <View {...hidden} pointerEvents="none" style={{ width: size, height: size }}>
      <View style={[styles.parent, { left: size / 2 - 13, top: size / 2 - 5 }]} />
      <View style={[styles.parent, { left: size / 2 + 3, top: size / 2 - 5, backgroundColor: colors.goldSoft }]} />
      {spins.map((spin, i) => {
        const r = radii[i] * size;
        return (
          <View key={i} style={{ position: "absolute", left: size / 2 - r, top: size / 2 - r, width: r * 2, height: r * 2 }}>
            <View style={{ position: "absolute", left: 0, top: 0, width: r * 2, height: r * 2, borderRadius: r, borderWidth: 1, borderColor: colors.lanternBorder }} />
            <Animated.View
              style={{ width: r * 2, height: r * 2, transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: [`${i * 120}deg`, `${i * 120 + 360}deg`] }) }] }}
            >
              <View style={[styles.moon, { left: r - 5 }]} />
            </Animated.View>
          </View>
        );
      })}
    </View>
  );
}

/* ───────────────────────── 15 Falling Petals ───────────────────────── */

/** 15: quiet petals fall across the page of a relative who passed away. */
export function FallingPetals({ height = 320 }: { height?: number }) {
  const reduced = useReducedMotion();
  if (reduced !== false) return null;
  return (
    <View {...hidden} pointerEvents="none" style={[StyleSheet.absoluteFill, { height, overflow: "hidden" }]}>
      {Array.from({ length: 9 }, (_, i) => (
        <Petal key={i} index={i} height={height} />
      ))}
    </View>
  );
}

function Petal({ index, height }: { index: number; height: number }) {
  const v = useTimeline(6500 + (index % 3) * 1400, { delay: index * 900, easing: EASE.linear, still: 0 });
  const left = `${8 + ((index * 37) % 84)}%` as const;
  return (
    <Animated.View
      style={{
        position: "absolute",
        top: -16,
        left,
        width: 9,
        height: 13,
        borderTopLeftRadius: 9,
        borderBottomRightRadius: 9,
        backgroundColor: index % 2 ? colors.goldSoft : purple,
        opacity: v.interpolate({ inputRange: [0, 0.08, 0.85, 1], outputRange: [0, 0.6, 0.45, 0] }),
        transform: [
          { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, height + 16] }) },
          { translateX: v.interpolate({ inputRange: [0, 0.25, 0.5, 0.75, 1], outputRange: [0, 18, 0, -18, 0] }) },
          { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ["0deg", `${index % 2 ? 300 : -300}deg`] }) },
        ],
      }}
    />
  );
}

/* ───────────────────────── 16 Marriage Bridge, 02 Heartbeat Link, 08 Root Rivers ─────────────────────────
   These three live in the tree's lines; see TreeLines.tsx. */

/* ───────────────────────── 17 Endless Bond ───────────────────────── */

const LOOP_POINTS = Array.from({ length: 49 }, (_, i) => {
  const t = (i / 48) * Math.PI * 2;
  const d = 1 + Math.sin(t) ** 2;
  return [110 + (86 * Math.cos(t)) / d, 100 + (100 * Math.sin(t) * Math.cos(t)) / d];
});
const LOOP_PATH = "M" + LOOP_POINTS.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L") + " Z";

/** 17: a light runs forever along an infinity loop, for parent and child links that never break. */
export function EndlessBond({ size = 220 }: { size?: number }) {
  const v = useTimeline(3600, { easing: EASE.linear, still: 0.12 });
  const inputRange = LOOP_POINTS.map((_, i) => i / (LOOP_POINTS.length - 1));
  const cx = v.interpolate({ inputRange, outputRange: LOOP_POINTS.map((p) => p[0]) });
  const cy = v.interpolate({ inputRange, outputRange: LOOP_POINTS.map((p) => p[1]) });
  return (
    <Stage size={size}>
      <Path d={LOOP_PATH} stroke={colors.line} strokeWidth={3} />
      <ACircle cx={cx} cy={cy} r={14} fill={colors.gold} opacity={0.25} />
      <ACircle cx={cx} cy={cy} r={6} fill={colors.goldSoft} />
    </Stage>
  );
}

/* ───────────────────────── 18 Kinship Wave ───────────────────────── */

/** 18: when someone joins, a wave of light spreads to everyone they are connected to. */
export function KinshipWave({ size = 220 }: { size?: number }) {
  const v = useTimeline(2600, { easing: EASE.linear, hold: 400 });
  const s = size / 220;
  const dots = [];
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const d = Math.abs(row - 2) + Math.abs(col - 2);
      const start = d * 0.13;
      const big = d === 0;
      const r = (big ? 7 : 4.5) * s;
      dots.push(
        <View key={`${row}-${col}`} style={{ position: "absolute", left: (38 + col * 36) * s - r, top: (28 + row * 36) * s - r, width: r * 2, height: r * 2 }}>
          <View style={{ position: "absolute", width: r * 2, height: r * 2, borderRadius: r, backgroundColor: colors.lanternBorder }} />
          <Animated.View
            style={{
              position: "absolute",
              width: r * 2,
              height: r * 2,
              borderRadius: r,
              backgroundColor: colors.gold,
              opacity: v.interpolate({ inputRange: [start, start + 0.12, start + 0.45], outputRange: [0, 1, 0.35], extrapolate: "clamp" }),
            }}
          />
        </View>,
      );
    }
  }
  return (
    <View {...hidden} pointerEvents="none" style={{ width: size, height: size * (200 / 220) }}>
      {dots}
    </View>
  );
}

/* ───────────────────────── 19 Seal of Approval ───────────────────────── */

/** 19: a waiting dashed circle closes into a solid gold seal with a tick. */
export function SealOfApproval({ size = 220 }: { size?: number }) {
  const v = useTimeline(2200, { hold: 1800 });
  return (
    <Stage size={size}>
      <ACircle
        cx={110}
        cy={100}
        r={50}
        stroke={colors.pending}
        strokeWidth={2}
        strokeDasharray={[6, 6]}
        strokeDashoffset={v.interpolate({ inputRange: [0, 1], outputRange: [0, -60] })}
        opacity={seg(v, 0.55, 0.75, 1, 0)}
      />
      <ACircle
        cx={110}
        cy={100}
        r={50}
        stroke={colors.gold}
        strokeWidth={4}
        strokeDasharray={[320, 320]}
        strokeDashoffset={drawn(v, 0.2, 0.65, 320)}
        transform="rotate(-90 110 100)"
      />
      <APath
        d="M86 100 L103 117 L135 84"
        stroke={colors.goldSoft}
        strokeWidth={6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={[80, 80]}
        strokeDashoffset={drawn(v, 0.6, 0.85, 80)}
      />
    </Stage>
  );
}

/* ───────────────────────── 20 Vote of Four ───────────────────────── */

/** 20: four relatives vote; lit dots agree. If three agree the wrong link fades away. */
export function VoteOfFour({ agree, disagree }: { agree: number; disagree: number }) {
  const v = useTimeline(1600, { loop: false });
  const passed = agree >= 3;
  return (
    <View {...hidden} pointerEvents="none" style={styles.vote}>
      <View style={styles.voteLinkRow}>
        <View style={styles.voteCard} />
        <Animated.View style={[styles.voteLink, { opacity: passed ? seg(v, 0.6, 1, 1, 0.1) : 1 }]} />
        <View style={styles.voteCard} />
      </View>
      <View style={styles.voteDots}>
        {[0, 1, 2, 3].map((i) => {
          const isAgree = i < agree;
          const isDisagree = !isAgree && i < agree + disagree;
          return (
            <View key={i} style={[styles.voteDot, isDisagree && { borderColor: colors.danger, borderWidth: 2 }]}>
              {isAgree && <Animated.View style={[styles.voteDotLit, { opacity: seg(v, i * 0.15, i * 0.15 + 0.3) }]} />}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/* ───────────────────────── 21 Northern Glow ───────────────────────── */

/** 21: slow drifting lights behind the app's title, like the sky over every home on earth. */
export function NorthernGlow({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const lights = [
    { color: colors.teal, top: "0%", left: "-5%", delay: 0 },
    { color: colors.gold, top: "25%", left: "35%", delay: 3000 },
    { color: purple, top: "50%", left: "10%", delay: 6000 },
  ] as const;
  return (
    <View style={[{ position: "relative" }, style]}>
      <View {...hidden} pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }]}>
        {lights.map((l, i) => (
          <Glow key={i} {...l} />
        ))}
      </View>
      {children}
    </View>
  );
}

function Glow({ color, top, left, delay }: { color: string; top: `${number}%`; left: `${number}%`; delay: number }) {
  const id = useSvgId("glow");
  const v = useTimeline(9000, { delay, still: 0.5 });
  return (
    <Animated.View
      style={{
        position: "absolute",
        top,
        left,
        width: "70%",
        height: "70%",
        transform: [{ translateX: v.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-30, 30, -30] }) }],
      }}
    >
      <Svg width="100%" height="100%" viewBox="0 0 200 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={0.4} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={100} cy={50} rx={100} ry={50} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/* ───────────────────────── 22 Heartline ───────────────────────── */

/** 22: a heartbeat line that grows into a small tree: life turning into family. */
export function Heartline({ size = 220 }: { size?: number }) {
  const v = useTimeline(4200, { hold: 600, still: 0.7, easing: EASE.linear });
  return (
    <Stage size={size}>
      <APath
        d="M0 130 H50 L62 100 L74 160 L86 80 L98 130 H110 V70 M110 95 L88 72 M110 95 L132 72 M110 130 H220"
        stroke={colors.gold}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={[560, 560]}
        strokeDashoffset={drawn(v, 0, 0.6, 560)}
        opacity={v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] })}
      />
    </Stage>
  );
}

/* ───────────────────────── 23 Lantern Release ───────────────────────── */

/** 23: a lantern rises and becomes a star, for a relative who passed away. */
export function LanternRelease({ size = 220 }: { size?: number }) {
  const v = useTimeline(3400, { hold: 1200, easing: EASE.in, still: 1 });
  const s = size / 220;
  return (
    <View {...hidden} pointerEvents="none" style={{ width: size, height: size * (200 / 220) }}>
      {[
        [40, 30],
        [170, 50],
        [60, 80],
        [190, 120],
      ].map(([x, y], i) => (
        <View key={i} style={{ position: "absolute", left: x * s, top: y * s, width: 3, height: 3, borderRadius: 2, backgroundColor: colors.text, opacity: 0.5 }} />
      ))}
      <Animated.View
        style={{
          position: "absolute",
          left: 96 * s,
          top: 140 * s,
          width: 28 * s,
          height: 34 * s,
          borderTopLeftRadius: 12 * s,
          borderTopRightRadius: 12 * s,
          borderBottomLeftRadius: 6 * s,
          borderBottomRightRadius: 6 * s,
          backgroundColor: colors.amber,
          shadowColor: colors.amber,
          shadowOpacity: 0.9,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 0 },
          opacity: v.interpolate({ inputRange: [0, 0.08, 0.75, 0.88], outputRange: [0, 1, 1, 0], extrapolate: "clamp" }),
          transform: [
            { translateY: seg(v, 0, 0.8, 0, -112 * s) },
            { scale: seg(v, 0, 0.8, 1, 0.35) },
          ],
        }}
      />
      <Animated.View
        style={{
          position: "absolute",
          left: 104 * s,
          top: 38 * s,
          width: 12 * s,
          height: 12 * s,
          borderRadius: 6 * s,
          backgroundColor: colors.goldSoft,
          shadowColor: colors.goldSoft,
          shadowOpacity: 1,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 0 },
          opacity: seg(v, 0.78, 0.92),
          transform: [{ scale: v.interpolate({ inputRange: [0.78, 0.9, 1], outputRange: [0.2, 1.4, 1], extrapolate: "clamp" }) }],
        }}
      />
    </View>
  );
}

/* ───────────────────────── 24 Journey Back in Time ───────────────────────── */

/** 24: frames fly past as you travel up to older generations, like walking through doors. */
export function JourneyBack({ size = 220 }: { size?: number }) {
  const v = useTimeline(3200, { easing: EASE.linear, still: 0.4 });
  const frameColors = [colors.teal, colors.line, colors.gold, purple];
  const s = size / 220;
  return (
    <View {...hidden} pointerEvents="none" style={{ width: size, height: size * (200 / 220), overflow: "hidden" }}>
      {frameColors.map((c, i) => {
        const p = i / frameColors.length;
        // Each frame runs the same journey, a quarter of the way behind the one before.
        const local = p === 0 ? v.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }) : v.interpolate({ inputRange: [0, 1 - p, 1 - p + 0.0001, 1], outputRange: [p, 1, 0, p] });
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: 50 * s,
              top: 40 * s,
              width: 120 * s,
              height: 120 * s,
              borderRadius: 24 * s,
              borderWidth: 2,
              borderColor: c,
              opacity: local.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }),
              transform: [{ scale: local.interpolate({ inputRange: [0, 1], outputRange: [0.15, 1.7] }) }],
            }}
          />
        );
      })}
    </View>
  );
}

/* ───────────────────────── 25 Earth Embrace ───────────────────────── */

/** 25: two golden arms wrap around the earth. The closing picture of the dream. */
export function EarthEmbrace({ size = 220 }: { size?: number }) {
  const v = useTimeline(3000, { hold: 2500 });
  return (
    <View style={{ alignItems: "center" }}>
      <Stage size={size} height={180}>
        <Circle cx={110} cy={92} r={46} fill="#10264A" stroke={colors.teal} strokeWidth={2} />
        <Path d="M78 80 Q96 70 104 88 T136 96 M90 112 Q108 104 124 116" stroke="#3E8C88" strokeWidth={2} strokeLinecap="round" />
        <APath d="M110 162 A70 70 0 0 1 110 22" stroke={colors.gold} strokeWidth={3} strokeLinecap="round" strokeDasharray={[230, 230]} strokeDashoffset={drawn(v, 0, 0.6, 230)} />
        <APath d="M110 162 A70 70 0 0 0 110 22" stroke={colors.gold} strokeWidth={3} strokeLinecap="round" strokeDasharray={[230, 230]} strokeDashoffset={drawn(v, 0, 0.6, 230)} />
      </Stage>
      <Animated.Text style={[styles.embrace, { opacity: seg(v, 0.55, 0.8) }]}>We are one family</Animated.Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pathLine: { position: "absolute", left: 11, top: STEP_HEIGHT / 2, width: 2, backgroundColor: colors.lanternBorder },
  pathLight: {
    position: "absolute",
    left: 4,
    top: STEP_HEIGHT / 2 - 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.gold,
    shadowColor: colors.gold,
    shadowOpacity: 0.9,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    zIndex: 2,
  },
  pathStep: { height: STEP_HEIGHT, flexDirection: "row", alignItems: "center", gap: 14 },
  pathDot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.gold, backgroundColor: colors.meCard },
  pathName: { fontFamily: fonts.bodyMedium, fontSize: 16, color: colors.text },
  pathRelation: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  ink: { fontFamily: fonts.displayBold, fontSize: 30, color: colors.text },
  parent: { position: "absolute", width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  moon: { position: "absolute", top: -5, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.teal },
  vote: { gap: 10, paddingVertical: 4 },
  voteLinkRow: { flexDirection: "row", alignItems: "center" },
  voteCard: { width: 46, height: 28, borderRadius: 8, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  voteLink: { width: 44, height: 2, backgroundColor: colors.muted },
  voteDots: { flexDirection: "row", gap: 12 },
  voteDot: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.lanternBorder, overflow: "hidden" },
  voteDotLit: { flex: 1, backgroundColor: colors.gold },
  embrace: { fontFamily: fonts.display, fontSize: 18, color: colors.goldSoft, marginTop: 4 },
});
