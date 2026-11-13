import type { Relation, Tree, TreePerson } from "./api";

export interface Placed {
  person: TreePerson;
  generation: number; // 0 = the person the tree is centred on, -1 = parents, +1 = children
  label: string;
  pending: boolean;
}

const pick = (gender: string | null | undefined, male: string, female: string, other: string) =>
  gender === "male" ? male : gender === "female" ? female : other;

function directLabel(r: Relation, rootId: string, other: TreePerson): string {
  const g = other.gender;
  if (r.type === "parent") {
    return r.b_id === rootId ? pick(g, "Father", "Mother", "Parent") : pick(g, "Son", "Daughter", "Child");
  }
  if (r.type === "sibling") return pick(g, "Brother", "Sister", "Sibling");
  if (r.divorced) return pick(g, "Former husband", "Former wife", "Former spouse");
  return pick(g, "Husband", "Wife", "Spouse");
}

const GENERATION_NAMES: Record<number, string> = {
  [-3]: "Great-grandparents",
  [-2]: "Grandparents",
  [-1]: "Parents",
  0: "Same generation",
  1: "Children",
  2: "Grandchildren",
  3: "Great-grandchildren",
};

export function generationName(g: number): string {
  if (GENERATION_NAMES[g]) return GENERATION_NAMES[g];
  return g < 0 ? `${-g} generations up` : `${g} generations down`;
}

type Step = "up" | "down" | "spouse" | "sibling";

/** A name for the relation, only when the path makes it certain; otherwise a generation hint. */
function pathLabel(steps: Step[], gender: string | null | undefined, g: number): string {
  const key = steps.join(",");
  const exact: Record<string, [string, string, string]> = {
    "up,up": ["Grandfather", "Grandmother", "Grandparent"],
    "up,up,up": ["Great-grandfather", "Great-grandmother", "Great-grandparent"],
    "down,down": ["Grandson", "Granddaughter", "Grandchild"],
    "down,down,down": ["Great-grandson", "Great-granddaughter", "Great-grandchild"],
    "up,down": ["Brother", "Sister", "Sibling"],
    "up,sibling": ["Uncle", "Aunt", "Uncle or aunt"],
    "sibling,down": ["Nephew", "Niece", "Nephew or niece"],
    "up,sibling,down": ["Cousin", "Cousin", "Cousin"],
    "spouse,up": ["Father-in-law", "Mother-in-law", "Parent-in-law"],
    "down,spouse": ["Son-in-law", "Daughter-in-law", "Child-in-law"],
    "sibling,spouse": ["Brother-in-law", "Sister-in-law", "Sibling-in-law"],
    "spouse,sibling": ["Brother-in-law", "Sister-in-law", "Sibling-in-law"],
  };
  if (exact[key]) return pick(gender, ...exact[key]);
  if (g < 0) return "Older generation";
  if (g > 0) return "Younger generation";
  return "Relative";
}

/** Place everyone in the tree into generation rows around the root. */
export function placeTree(tree: Tree): { rows: { generation: number; people: Placed[] }[]; relationsOf: (id: string) => Relation[] } {
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const gen = new Map<string, number>([[tree.root, 0]]);
  const path = new Map<string, Step[]>([[tree.root, []]]);
  const queue = [tree.root];
  const visible = tree.relations.filter((r) => r.status === "active" || r.status === "pending");
  while (queue.length) {
    const id = queue.shift()!;
    const g = gen.get(id)!;
    for (const r of visible) {
      let other: string | null = null;
      let delta = 0;
      let step: Step = r.type === "spouse" ? "spouse" : "sibling";
      if (r.a_id === id) {
        other = r.b_id;
        delta = r.type === "parent" ? 1 : 0;
        if (r.type === "parent") step = "down";
      } else if (r.b_id === id) {
        other = r.a_id;
        delta = r.type === "parent" ? -1 : 0;
        if (r.type === "parent") step = "up";
      }
      if (other && !gen.has(other) && byId.has(other)) {
        gen.set(other, g + delta);
        path.set(other, [...path.get(id)!, step]);
        queue.push(other);
      }
    }
  }

  const placed: Placed[] = [];
  for (const p of tree.people) {
    const g = gen.get(p.id);
    if (g === undefined) continue;
    const direct = visible.find(
      (r) => (r.a_id === tree.root && r.b_id === p.id) || (r.b_id === tree.root && r.a_id === p.id),
    );
    const pending = visible.some((r) => r.status === "pending" && (r.a_id === p.id || r.b_id === p.id) && (r.a_id === tree.root || r.b_id === tree.root || r.created_by === tree.me));
    let label = p.id === tree.root ? (p.id === tree.me ? "You" : "Selected") : direct ? directLabel(direct, tree.root, p) : pathLabel(path.get(p.id) ?? [], p.gender, g);
    if (p.id === tree.me && p.id !== tree.root) label = "You";
    placed.push({ person: p, generation: g, label, pending: pending && p.id !== tree.root });
  }

  // Keep spouses next to each other and the root near the middle of its row.
  const spouseOf = new Map<string, string>();
  for (const r of visible) if (r.type === "spouse") { spouseOf.set(r.a_id, r.b_id); spouseOf.set(r.b_id, r.a_id); }

  const gens = [...new Set(placed.map((p) => p.generation))].sort((a, b) => a - b);
  const rows = gens.map((g) => {
    const inRow = placed.filter((p) => p.generation === g).sort((a, b) => (a.person.birth_year ?? 9999) - (b.person.birth_year ?? 9999));
    const ordered: Placed[] = [];
    const used = new Set<string>();
    for (const p of inRow) {
      if (used.has(p.person.id)) continue;
      ordered.push(p);
      used.add(p.person.id);
      const s = spouseOf.get(p.person.id);
      const sp = inRow.find((x) => x.person.id === s);
      if (sp && !used.has(sp.person.id)) {
        ordered.push(sp);
        used.add(sp.person.id);
      }
    }
    return { generation: g, people: ordered };
  });

  return {
    rows,
    relationsOf: (id: string) => tree.relations.filter((r) => r.a_id === id || r.b_id === id),
  };
}

export function years(p: TreePerson): string {
  if (p.is_living === 0) {
    if (p.birth_year || p.death_year) return `${p.birth_year ?? "?"} – ${p.death_year ?? "?"}`;
    return "Passed away";
  }
  return p.birth_year ? `Born ${p.birth_year}` : "";
}

export interface PathStep {
  id: string;
  name: string;
  relation: string;
}

/**
 * The shortest chain of confirmed links from one person to another, for
 * 11 "Golden Path". Each step says how that person is related to the one before.
 * Returns null when they are not connected within the tree that was loaded.
 */
export function relationPath(tree: Tree, fromId: string, toId: string): PathStep[] | null {
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  const active = tree.relations.filter((r) => r.status === "active");
  const prev = new Map<string, { id: string; r: Relation } | null>([[fromId, null]]);
  const queue = [fromId];
  while (queue.length && !prev.has(toId)) {
    const id = queue.shift()!;
    for (const r of active) {
      const other = r.a_id === id ? r.b_id : r.b_id === id ? r.a_id : null;
      if (other && !prev.has(other) && byId.has(other)) {
        prev.set(other, { id, r });
        queue.push(other);
      }
    }
  }
  if (!prev.has(toId)) return null;
  const chain: string[] = [];
  for (let at: string | undefined = toId; at; at = prev.get(at)?.id) chain.unshift(at);
  return chain.map((id, i) => {
    const p = byId.get(id)!;
    if (i === 0) return { id, name: id === tree.me ? "You" : p.full_name, relation: "Start" };
    const before = byId.get(chain[i - 1])!;
    const owner = chain[i - 1] === tree.me ? "Your" : `${before.full_name}'s`;
    const link = prev.get(id)!.r;
    let word: string;
    if (link.type === "parent") {
      word = link.a_id === id ? pick(p.gender, "father", "mother", "parent") : pick(p.gender, "son", "daughter", "child");
    } else if (link.type === "sibling") {
      word = pick(p.gender, "brother", "sister", "brother or sister");
    } else {
      word = link.divorced ? pick(p.gender, "former husband", "former wife", "former spouse") : pick(p.gender, "husband", "wife", "husband or wife");
    }
    return { id, name: p.full_name, relation: `${owner} ${word}` };
  });
}
