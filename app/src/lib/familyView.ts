import type { Relation, Tree, TreePerson } from "./api";
import { placeTree } from "./family";

// The "family" view, centred on one person:
//   their parents above,
//   them with their brothers and sisters in one row (oldest first), each with their husband or wife,
//   and everyone's children below their own parents.

export interface Member {
  person: TreePerson;
  label: string;
  pending: boolean;
  divorced?: boolean;
}

export interface Unit {
  /** The brother, sister or focus person. */
  main: Member;
  /** Their husbands or wives, shown right beside them. */
  spouses: Member[];
  children: Member[];
  isFocus: boolean;
}

export interface FamilyView {
  focus: TreePerson;
  parents: Member[];
  units: Unit[];
}

const live = (r: Relation) => r.status === "active" || r.status === "pending";

export function familyView(tree: Tree): FamilyView | null {
  const byId = new Map(tree.people.map((p) => [p.id, p]));
  const focus = byId.get(tree.root);
  if (!focus) return null;
  const rels = tree.relations.filter(live);
  const labels = new Map<string, { label: string; pending: boolean }>();
  for (const row of placeTree(tree).rows) for (const p of row.people) labels.set(p.person.id, { label: p.label, pending: p.pending });

  const member = (id: string, extra: Partial<Member> = {}): Member => ({
    person: byId.get(id)!,
    label: labels.get(id)?.label ?? "Relative",
    pending: labels.get(id)?.pending ?? false,
    ...extra,
  });
  const byBirth = (a: string, b: string) =>
    (byId.get(a)!.birth_year ?? 9999) - (byId.get(b)!.birth_year ?? 9999) || byId.get(a)!.full_name.localeCompare(byId.get(b)!.full_name);

  const parentsOf = (id: string) => rels.filter((r) => r.type === "parent" && r.b_id === id && byId.has(r.a_id)).map((r) => r.a_id);
  const childrenOf = (id: string) => rels.filter((r) => r.type === "parent" && r.a_id === id && byId.has(r.b_id)).map((r) => r.b_id);
  const spousesOf = (id: string) =>
    rels
      .filter((r) => r.type === "spouse" && (r.a_id === id || r.b_id === id))
      .map((r) => ({ id: r.a_id === id ? r.b_id : r.a_id, divorced: !!r.divorced }))
      .filter((s) => byId.has(s.id));

  const parents = parentsOf(focus.id);

  // Brothers and sisters: linked as siblings, or children of the same parent.
  const siblings = new Set<string>();
  for (const r of rels) {
    if (r.type !== "sibling") continue;
    if (r.a_id === focus.id && byId.has(r.b_id)) siblings.add(r.b_id);
    if (r.b_id === focus.id && byId.has(r.a_id)) siblings.add(r.a_id);
  }
  for (const p of parents) for (const c of childrenOf(p)) if (c !== focus.id) siblings.add(c);

  const placed = new Set<string>([focus.id, ...parents]);
  const word = (g: string | null | undefined, male: string, female: string, other: string) => (g === "male" ? male : g === "female" ? female : other);
  const first = (name: string) => name.split(/\s+/)[0];
  const unitFor = (id: string): Unit => {
    placed.add(id);
    const own = childrenOf(id);
    const spouses: { id: string; divorced: boolean; label?: string }[] = spousesOf(id)
      .filter((s) => !placed.has(s.id))
      .sort((a, b) => Number(a.divorced) - Number(b.divorced) || byBirth(a.id, b.id));
    if (!spouses.length) {
      // No marriage recorded: show the other parent of their children beside them.
      const others = new Set(own.flatMap((c) => parentsOf(c)).filter((p) => p !== id && !placed.has(p)));
      for (const o of others) {
        const g = byId.get(o)!.gender;
        spouses.push({ id: o, divorced: false, label: word(g, "Their father", "Their mother", "Their parent") });
      }
    }
    spouses.forEach((s) => placed.add(s.id));
    const kids = new Set(own);
    for (const s of spouses) for (const c of childrenOf(s.id)) kids.add(c);
    const children = [...kids].filter((c) => !placed.has(c)).sort(byBirth);
    children.forEach((c) => placed.add(c));
    return {
      main: member(id),
      spouses: spouses.map((s) => member(s.id, { divorced: s.divorced, ...(s.label ? { label: s.label } : {}) })),
      children: children.map((c) => {
        if (own.includes(c) || c === tree.me) return member(c);
        // A child linked only to the husband or wife: say whose child they are.
        const parent = spouses.find((s) => childrenOf(s.id).includes(c));
        const g = byId.get(c)!.gender;
        return member(c, parent ? { label: `${word(g, "Son", "Daughter", "Child")} of ${first(byId.get(parent.id)!.full_name)}` } : {});
      }),
      isFocus: id === focus.id,
    };
  };

  const row = [focus.id, ...siblings].sort(byBirth);
  // Work out the focus person's own family first, so their husband or wife and children stay with them.
  const mine = unitFor(focus.id);
  const units = row.map((id) => (id === focus.id ? mine : unitFor(id)));

  // The focus person is labelled by how they are related to you, e.g. "Wife" or "Sister".
  if (focus.id !== tree.me && byId.has(tree.me)) {
    const toMe = placeTree({ ...tree, root: tree.me }).rows.flatMap((r) => r.people).find((p) => p.person.id === focus.id);
    const vague = ["Older generation", "Younger generation", "Relative", "Selected"];
    mine.main.label = toMe && !vague.includes(toMe.label) ? `Your ${toMe.label.toLowerCase()}` : "Relative";
  }

  return { focus, parents: parents.sort(byBirth).map((p) => member(p)), units };
}
