import type { Relation, Tree, TreePerson } from "./api";
import { placeTree } from "./family";

// The "circle" view: you in the middle and every relative around you, 360 degrees.
// Ring 1 holds the people one step away (parents above, husband or wife to the right,
// children below, brothers and sisters to the left), ring 2 the people two steps away,
// and so on. Each person's own relatives sit in the slice of the circle behind them,
// so families stay together and lines don't cross the middle.

export interface RadialNode {
  person: TreePerson;
  label: string;
  ring: number;
  angle: number; // radians, 0 = right, PI/2 = down
  x: number; // in "units": ring radius 1 = one step from the centre
  y: number;
  pending: boolean;
}

export interface RadialLayout {
  nodes: RadialNode[];
  relations: Relation[];
  rings: number;
  /** The smallest gap between neighbours on the same ring, in units, used to size the picture. */
  tightest: number;
}

type Kind = "parent" | "spouse" | "child" | "sibling";
// Clockwise from the top: parents, then husband or wife, children, brothers and sisters.
const ORDER: Record<Kind, number> = { parent: 0, spouse: 1, child: 2, sibling: 3 };

function kindFrom(r: Relation, from: string): Kind {
  if (r.type === "parent") return r.b_id === from ? "parent" : "child";
  return r.type;
}

export function radialLayout(tree: Tree): RadialLayout {
  const visible = tree.relations.filter((r) => r.status === "active" || r.status === "pending");
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const labels = new Map<string, { label: string; pending: boolean }>();
  for (const row of placeTree(tree).rows) for (const p of row.people) labels.set(p.person.id, { label: p.label, pending: p.pending });

  // Walk outwards from the centre. Each person hangs under the relative that joins them
  // most naturally: through parents and children first. A brother or sister link is only
  // used when no parent is in the picture, so an uncle hangs under the grandparents
  // (beside his own children) and not under your father.
  const ring = new Map<string, number>([[tree.root, 0]]);
  const cost = new Map<string, number>([[tree.root, 0]]);
  const via = new Map<string, { from: string; kind: Kind }>();
  const done = new Set<string>();
  const rank = (id: string) => [cost.get(id)!, byId.get(id)!.birth_year ?? 9999, byId.get(id)!.full_name] as const;
  while (true) {
    let best: string | null = null;
    for (const id of cost.keys()) {
      if (done.has(id)) continue;
      if (best === null) best = id;
      else {
        const [c1, y1, n1] = rank(id);
        const [c2, y2, n2] = rank(best);
        if (c1 < c2 || (c1 === c2 && (y1 < y2 || (y1 === y2 && n1 < n2)))) best = id;
      }
    }
    if (best === null) break;
    done.add(best);
    for (const r of visible) {
      const other = r.a_id === best ? r.b_id : r.b_id === best ? r.a_id : null;
      if (!other || done.has(other) || !byId.has(other)) continue;
      const step = r.type === "sibling" && best !== tree.root ? 2.01 : 1;
      const c = cost.get(best)! + step;
      if (!cost.has(other) || c < cost.get(other)!) {
        cost.set(other, c);
        ring.set(other, ring.get(best)! + 1);
        via.set(other, { from: best, kind: kindFrom(r, best) });
      }
    }
  }
  const kids = new Map<string, { id: string; kind: Kind }[]>();
  for (const [id, v] of via) kids.set(v.from, [...(kids.get(v.from) ?? []), { id, kind: v.kind }]);
  for (const list of kids.values()) {
    list.sort(
      (a, b) =>
        ORDER[a.kind] - ORDER[b.kind] ||
        (byId.get(a.id)!.birth_year ?? 9999) - (byId.get(b.id)!.birth_year ?? 9999) ||
        byId.get(a.id)!.full_name.localeCompare(byId.get(b.id)!.full_name),
    );
  }

  // Each person gets a slice of the circle wide enough for them and everyone behind them.
  // Outer rings are longer, so a person there needs a thinner slice (1 / ring).
  const weight = new Map<string, number>();
  const weigh = (id: string): number => {
    const own = 1 / Math.max(1, ring.get(id)!);
    const w = Math.max(own, (kids.get(id) ?? []).reduce((s, k) => s + weigh(k.id), 0));
    weight.set(id, w);
    return w;
  };
  weigh(tree.root);

  const angle = new Map<string, number>([[tree.root, 0]]);
  const span = new Map<string, number>();
  const share = (id: string, start: number, width: number) => {
    const list = kids.get(id) ?? [];
    const total = list.reduce((s, k) => s + weight.get(k.id)!, 0);
    let at = start;
    for (const k of list) {
      const w = (width * weight.get(k.id)!) / total;
      angle.set(k.id, at + w / 2);
      span.set(k.id, w);
      share(k.id, at, w);
      at += w;
    }
  };
  share(tree.root, 0, Math.PI * 2);

  // Turn the circle so the parents sit at the top (or, with no parents, the first person).
  const first = kids.get(tree.root) ?? [];
  const parents = first.filter((k) => k.kind === "parent");
  let turn = 0;
  if (first.length) {
    const anchor = parents.length
      ? (angle.get(parents[0].id)! - span.get(parents[0].id)! / 2 + angle.get(parents[parents.length - 1].id)! + span.get(parents[parents.length - 1].id)! / 2) / 2
      : angle.get(first[0].id)!;
    turn = -Math.PI / 2 - anchor;
  }

  const nodes: RadialNode[] = [];
  for (const [id, r] of ring) {
    const a = r === 0 ? 0 : angle.get(id)! + turn;
    const info = labels.get(id);
    nodes.push({
      person: byId.get(id)!,
      label: info?.label ?? "Relative",
      ring: r,
      angle: a,
      x: r * Math.cos(a),
      y: r * Math.sin(a),
      pending: info?.pending ?? false,
    });
  }

  // The closest two neighbours on any ring, as a distance in units.
  let tightest = Infinity;
  const rings = Math.max(0, ...nodes.map((n) => n.ring));
  for (let k = 1; k <= rings; k++) {
    const onRing = nodes.filter((n) => n.ring === k).map((n) => n.angle).sort((a, b) => a - b);
    if (onRing.length < 2) continue;
    for (let i = 0; i < onRing.length; i++) {
      const gap = i === onRing.length - 1 ? onRing[0] + Math.PI * 2 - onRing[i] : onRing[i + 1] - onRing[i];
      tightest = Math.min(tightest, 2 * k * Math.sin(Math.min(gap, Math.PI) / 2));
    }
  }

  const shown = new Set(ring.keys());
  return {
    nodes,
    relations: visible.filter((r) => shown.has(r.a_id) && shown.has(r.b_id)),
    rings,
    tightest: Number.isFinite(tightest) ? tightest : 2,
  };
}
