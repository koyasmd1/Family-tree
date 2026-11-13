// The lines that join people in the tree:
// - 08 Root Rivers: light flows down every parent and child line
// - 16 Marriage Bridge: a golden arch with a ring joins husband and wife
// - 02 Heartbeat Link: a pulse of light beats along every approved marriage
// Lines still waiting for approval are amber and dashed; divorced couples get a grey dashed arch.
import { StyleSheet, View } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import type { Relation } from "@/lib/api";
import { colors } from "@/lib/theme";
import { APath, ACircle } from "./svgAnimated";
import { EASE, useTimeline } from "./animations";


export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Line =
  | { kind: "parent"; key: string; d: string; pending: boolean }
  | { kind: "spouse"; key: string; d: string; ring: { x: number; y: number }; length: number; pending: boolean; divorced: boolean }
  | { kind: "sibling"; key: string; d: string; pending: boolean };

const live = (r: Relation) => r.status === "active" || r.status === "pending";

/** Work out every line from the card positions. Exported so it can be tested. */
export function buildLines(relations: Relation[], boxes: Map<string, Box>): Line[] {
  const lines: Line[] = [];
  const shown = relations.filter((r) => live(r) && boxes.has(r.a_id) && boxes.has(r.b_id));
  const bottom = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h });
  const top = (b: Box) => ({ x: b.x + b.w / 2, y: b.y });

  // Parents → child. Two confirmed parents share one line that starts between them.
  const parentLinks = new Map<string, Relation[]>();
  for (const r of shown.filter((r) => r.type === "parent")) {
    parentLinks.set(r.b_id, [...(parentLinks.get(r.b_id) ?? []), r]);
  }
  for (const [childId, links] of parentLinks) {
    const end = top(boxes.get(childId)!);
    const curve = (s: { x: number; y: number }) => {
      const mid = (s.y + end.y) / 2;
      return `M${s.x} ${s.y} C${s.x} ${mid} ${end.x} ${mid} ${end.x} ${end.y}`;
    };
    const active = links.filter((r) => r.status === "active");
    if (active.length === 2) {
      const [a, b] = active.map((r) => bottom(boxes.get(r.a_id)!));
      lines.push({ kind: "parent", key: `p-${childId}`, d: curve({ x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) }), pending: false });
      links.filter((r) => r.status === "pending").forEach((r) => lines.push({ kind: "parent", key: r.id, d: curve(bottom(boxes.get(r.a_id)!)), pending: true }));
    } else {
      links.forEach((r) => lines.push({ kind: "parent", key: r.id, d: curve(bottom(boxes.get(r.a_id)!)), pending: r.status === "pending" }));
    }
  }

  // Husband and wife: an arch over the top of both cards.
  for (const r of shown.filter((r) => r.type === "spouse")) {
    const [a, b] = [top(boxes.get(r.a_id)!), top(boxes.get(r.b_id)!)].sort((p, q) => p.x - q.x);
    const lift = 30;
    const cy = Math.min(a.y, b.y) - lift;
    const mx = (a.x + b.x) / 2;
    const chord = Math.hypot(b.x - a.x, b.y - a.y);
    lines.push({
      kind: "spouse",
      key: r.id,
      d: `M${a.x} ${a.y} Q${mx} ${cy} ${b.x} ${b.y}`,
      ring: { x: mx, y: (a.y + 2 * cy + b.y) / 4 },
      length: chord * 1.25 + 40,
      pending: r.status === "pending",
      divorced: !!r.divorced,
    });
  }

  // Brothers and sisters only need their own line when no shared parent is on screen.
  const parentsOf = (id: string) => new Set(shown.filter((r) => r.type === "parent" && r.b_id === id && r.status === "active").map((r) => r.a_id));
  for (const r of shown.filter((r) => r.type === "sibling")) {
    const pa = parentsOf(r.a_id);
    if ([...parentsOf(r.b_id)].some((p) => pa.has(p))) continue;
    const [a, b] = [top(boxes.get(r.a_id)!), top(boxes.get(r.b_id)!)].sort((p, q) => p.x - q.x);
    lines.push({ kind: "sibling", key: r.id, d: `M${a.x} ${a.y} Q${(a.x + b.x) / 2} ${Math.min(a.y, b.y) - 22} ${b.x} ${b.y}`, pending: r.status === "pending" });
  }
  return lines;
}

export function TreeLines({ relations, boxes, width, height }: { relations: Relation[]; boxes: Map<string, Box>; width: number; height: number }) {
  const flow = useTimeline(1400, { easing: EASE.linear, still: 0 });
  const draw = useTimeline(1100, { loop: false, delay: 500 });
  const beat = useTimeline(2600, { easing: EASE.inOut, delay: 1600, still: 0 });
  if (!width || !height || boxes.size === 0) return null;
  const lines = buildLines(relations, boxes);
  const flowOffset = flow.interpolate({ inputRange: [0, 1], outputRange: [0, -18] });

  return (
    <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={[StyleSheet.absoluteFill, { width, height }]}>
      <Svg width={width} height={height} fill="none">
        {lines.map((l) => {
          if (l.kind === "parent") {
            return (
              <G key={l.key}>
                <Path d={l.d} stroke={l.pending ? colors.pending : colors.line} strokeWidth={2} strokeDasharray={l.pending ? [6, 6] : undefined} strokeLinecap="round" />
                {!l.pending && <APath d={l.d} stroke={colors.gold} strokeWidth={2} strokeLinecap="round" strokeDasharray={[2, 16]} strokeDashoffset={flowOffset} opacity={0.8} />}
              </G>
            );
          }
          if (l.kind === "sibling") {
            return <Path key={l.key} d={l.d} stroke={l.pending ? colors.pending : colors.teal} strokeWidth={1.5} strokeDasharray={[2, 6]} strokeLinecap="round" opacity={0.8} />;
          }
          if (l.pending || l.divorced) {
            return (
              <Path
                key={l.key}
                d={l.d}
                stroke={l.pending ? colors.pending : colors.muted}
                strokeWidth={2}
                strokeDasharray={[6, 6]}
                strokeLinecap="round"
                opacity={l.divorced ? 0.6 : 1}
              />
            );
          }
          return (
            <G key={l.key}>
              <APath
                d={l.d}
                stroke={colors.gold}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={[l.length, l.length]}
                strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [l.length, 0] })}
              />
              <APath
                d={l.d}
                stroke={colors.goldSoft}
                strokeWidth={4}
                strokeLinecap="round"
                strokeDasharray={[10, l.length + 20]}
                strokeDashoffset={beat.interpolate({ inputRange: [0, 1], outputRange: [10, -l.length] })}
                opacity={beat.interpolate({ inputRange: [0, 0.05, 0.9, 1], outputRange: [0, 1, 1, 0] })}
              />
              <ACircle
                cx={l.ring.x}
                cy={l.ring.y}
                r={draw.interpolate({ inputRange: [0.6, 0.85, 1], outputRange: [0, 7, 5.5], extrapolate: "clamp" })}
                stroke={colors.goldSoft}
                strokeWidth={2}
                fill={colors.night}
              />
            </G>
          );
        })}
      </Svg>
    </View>
  );
}
