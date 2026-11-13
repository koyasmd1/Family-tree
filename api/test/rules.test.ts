import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/index";
import { testDb } from "./d1";

const SETUP = "test-setup-secret";

let clock: Date;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  clock = new Date("2026-11-13T10:00:00Z");
  const db = testDb();
  app = createApp(() => ({ db, now: () => clock, random: () => 0 }));
});

const env = { SETUP_TOKEN: SETUP } as any;

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await app.request(
    path,
    {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
    env,
  );
  const json: any = await res.json();
  return { status: res.status, json };
}

async function starter(name = "Koyas") {
  const r = await call("POST", "/setup", {
    body: { setup_token: SETUP, person: { full_name: name, birth_year: 1985 }, login: "koyas@example.com", password: "password123" },
  });
  expect(r.status).toBe(201);
  return { id: r.json.person.id as string, token: r.json.token as string };
}

async function add(token: string, of: string, kind: string, person: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const r = await call("POST", "/relatives", { token, body: { of, kind, person, ...extra } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json as { person: { id: string }; relations: { id: string; status: string; approver_id: string | null }[] };
}

let loginCounter = 0;
async function join(inviterToken: string, personId: string) {
  const inv = await call("POST", `/people/${personId}/invites`, { token: inviterToken, body: { contact: "+966500000000" } });
  expect(inv.status, JSON.stringify(inv.json)).toBe(201);
  const acc = await call("POST", `/invites/${inv.json.token}/accept`, {
    body: { login: `member${++loginCounter}@example.com`, password: "password123" },
  });
  expect(acc.status, JSON.stringify(acc.json)).toBe(201);
  return acc.json.token as string;
}

async function me(token: string) {
  return (await call("GET", "/me", { token })).json;
}

describe("starting the tree", () => {
  it("needs the setup secret and only works once", async () => {
    const bad = await call("POST", "/setup", {
      body: { setup_token: "wrong", person: { full_name: "X" }, login: "x@example.com", password: "password123" },
    });
    expect(bad.status).toBe(403);
    await starter();
    const again = await call("POST", "/setup", {
      body: { setup_token: SETUP, person: { full_name: "Y" }, login: "y@example.com", password: "password123" },
    });
    expect(again.status).toBe(409);
  });

  it("lets the starter sign in, and rejects a wrong password", async () => {
    await starter();
    expect((await call("POST", "/login", { body: { login: "KOYAS@example.com ", password: "password123" } })).status).toBe(200);
    expect((await call("POST", "/login", { body: { login: "koyas@example.com", password: "nope12345" } })).status).toBe(401);
  });

  it("refuses everything else without signing in", async () => {
    expect((await call("GET", "/tree")).status).toBe(401);
  });
});

describe("rule: parents and children are linked straight away", () => {
  it("adds a parent and a child as active links", async () => {
    const a = await starter();
    const father = await add(a.token, a.id, "parent", { full_name: "Father", birth_year: 1960 });
    const child = await add(a.token, a.id, "child", { full_name: "Baby", birth_year: 2024 });
    expect(father.relations[0].status).toBe("active");
    expect(child.relations[0].status).toBe("active");
  });

  it("allows a passed-away grandparent to be added through a parent's profile", async () => {
    const a = await starter();
    const father = await add(a.token, a.id, "parent", { full_name: "Father" });
    const grandpa = await add(a.token, father.person.id, "parent", { full_name: "Grandpa", is_living: false, birth_year: 1931, death_year: 2004 });
    expect(grandpa.relations[0].status).toBe("active");
    const tree = (await call("GET", "/tree?depth=2", { token: a.token })).json;
    const g = tree.people.find((p: any) => p.id === grandpa.person.id);
    expect(g.is_living).toBe(0);
    expect(g.death_year).toBe(2004);
  });

  it("refuses a third parent", async () => {
    const a = await starter();
    await add(a.token, a.id, "parent", { full_name: "Father" });
    await add(a.token, a.id, "parent", { full_name: "Mother" });
    const r = await call("POST", "/relatives", { token: a.token, body: { of: a.id, kind: "parent", person: { full_name: "Third" } } });
    expect(r.status).toBe(409);
  });
});

describe("rule: siblings and spouses need approval", () => {
  it("keeps a sibling pending until they join and approve", async () => {
    const a = await starter();
    const sis = await add(a.token, a.id, "sibling", { full_name: "Sara" });
    const rel = sis.relations[0];
    expect(rel.status).toBe("pending");
    expect(rel.approver_id).toBe(sis.person.id);

    const sisToken = await join(a.token, sis.person.id);
    const inbox = await me(sisToken);
    expect(inbox.pending.map((p: any) => p.id)).toEqual([rel.id]);

    // The person who added it cannot approve it themselves.
    expect((await call("POST", `/relations/${rel.id}/decision`, { token: a.token, body: { approve: true } })).status).toBe(403);

    const ok = await call("POST", `/relations/${rel.id}/decision`, { token: sisToken, body: { approve: true } });
    expect(ok.json.status).toBe("active");
  });

  it("lets a spouse reject a wrong request", async () => {
    const a = await starter();
    const w = await add(a.token, a.id, "spouse", { full_name: "Noor" });
    const wToken = await join(a.token, w.person.id);
    const r = await call("POST", `/relations/${w.relations[0].id}/decision`, { token: wToken, body: { approve: false } });
    expect(r.json.status).toBe("rejected");
  });

  it("accepts a sibling who has passed away, since they cannot approve", async () => {
    const a = await starter();
    const b = await add(a.token, a.id, "sibling", { full_name: "Late brother", is_living: false });
    expect(b.relations[0].status).toBe("active");
  });

  it("asks the existing sibling to confirm a new child added under shared parents", async () => {
    const a = await starter();
    const father = await add(a.token, a.id, "parent", { full_name: "Father" });
    const fToken = await join(a.token, father.person.id);

    const newChild = await add(fToken, father.person.id, "child", { full_name: "Ali" });
    expect(newChild.relations[0].status).toBe("active"); // the parent link itself

    const inbox = await me(a.token);
    expect(inbox.pending).toHaveLength(1);
    const implied = inbox.pending[0];
    expect(implied.type).toBe("sibling");
    expect([implied.a_id, implied.b_id].sort()).toEqual([a.id, newChild.person.id].sort());

    const ok = await call("POST", `/relations/${implied.id}/decision`, { token: a.token, body: { approve: true } });
    expect(ok.json.status).toBe("active");
  });

  it("marks an approved marriage as divorced", async () => {
    const a = await starter();
    const w = await add(a.token, a.id, "spouse", { full_name: "Noor" });
    const wToken = await join(a.token, w.person.id);
    await call("POST", `/relations/${w.relations[0].id}/decision`, { token: wToken, body: { approve: true } });
    const r = await call("POST", `/relations/${w.relations[0].id}/divorced`, { token: a.token, body: { divorced: true } });
    expect(r.json.divorced).toBe(1);
  });
});

describe("rule: joining is invite-only", () => {
  it("uses each invite link once", async () => {
    const a = await starter();
    const f = await add(a.token, a.id, "parent", { full_name: "Father" });
    const inv = await call("POST", `/people/${f.person.id}/invites`, { token: a.token, body: {} });
    const info = await call("GET", `/invites/${inv.json.token}`);
    expect(info.json.invitedBy).toBe("Koyas");
    expect((await call("POST", `/invites/${inv.json.token}/accept`, { body: { login: "f@example.com", password: "password123" } })).status).toBe(201);
    expect((await call("POST", `/invites/${inv.json.token}/accept`, { body: { login: "g@example.com", password: "password123" } })).status).toBe(410);
  });

  it("does not let a member add relatives to another member", async () => {
    const a = await starter();
    const f = await add(a.token, a.id, "parent", { full_name: "Father" });
    const fToken = await join(a.token, f.person.id);
    const r = await call("POST", "/relatives", { token: fToken, body: { of: a.id, kind: "child", person: { full_name: "X" } } });
    expect(r.status).toBe(403);
  });

  it("cannot invite someone who already joined", async () => {
    const a = await starter();
    const f = await add(a.token, a.id, "parent", { full_name: "Father" });
    await join(a.token, f.person.id);
    expect((await call("POST", `/people/${f.person.id}/invites`, { token: a.token, body: {} })).status).toBe(409);
  });
});

/**
 * Family for vote tests:
 *   G (grandfather, member)
 *   |
 *   F (father) + M (mother)
 *   |
 *   A (starter) - S (sister), A = W (wife), A -> K (child)
 * All members. The vote is on the A = W marriage.
 */
async function voteFamily() {
  const a = await starter();
  const F = await add(a.token, a.id, "parent", { full_name: "Father" });
  const M = await add(a.token, a.id, "parent", { full_name: "Mother" });
  const K = await add(a.token, a.id, "child", { full_name: "Kid" });
  const W = await add(a.token, a.id, "spouse", { full_name: "Wife" });
  const S = await add(a.token, a.id, "sibling", { full_name: "Sister" });
  const tokens: Record<string, string> = { A: a.token };
  tokens.F = await join(a.token, F.person.id);
  tokens.M = await join(a.token, M.person.id);
  tokens.K = await join(a.token, K.person.id);
  tokens.W = await join(a.token, W.person.id);
  tokens.S = await join(a.token, S.person.id);
  await call("POST", `/relations/${W.relations[0].id}/decision`, { token: tokens.W, body: { approve: true } });
  await call("POST", `/relations/${S.relations[0].id}/decision`, { token: tokens.S, body: { approve: true } });
  const G = await add(tokens.F, F.person.id, "parent", { full_name: "Grandfather", birth_year: 1935 });
  tokens.G = await join(tokens.F, G.person.id);
  const ids = { A: a.id, F: F.person.id, M: M.person.id, K: K.person.id, W: W.person.id, S: S.person.id, G: G.person.id };
  const byId = Object.fromEntries(Object.entries(ids).map(([k, v]) => [v, k]));
  return { ids, byId, tokens, marriage: W.relations[0].id };
}

describe("rule: removing a wrong link takes 3 of 4 random relatives", () => {
  it("picks 4 voters, closest relatives first, never the two people in the link", async () => {
    const fam = await voteFamily();
    const v = await call("POST", `/relations/${fam.marriage}/removal-votes`, { token: fam.tokens.A });
    expect(v.status, JSON.stringify(v.json)).toBe(201);
    const voters = v.json.voters.map((id: string) => fam.byId[id]).sort();
    expect(voters).toEqual(["F", "K", "M", "S"]); // all distance 1; G (distance 2) is not needed
    expect(voters).not.toContain("A");
    expect(voters).not.toContain("W");
  });

  it("removes only that link once 3 agree", async () => {
    const fam = await voteFamily();
    const v = (await call("POST", `/relations/${fam.marriage}/removal-votes`, { token: fam.tokens.A })).json;
    const [x, y, z] = v.voters.map((id: string) => fam.tokens[fam.byId[id]]);
    await call("POST", `/votes/${v.id}/ballot`, { token: x, body: { choice: "agree" } });
    const mid = await call("POST", `/votes/${v.id}/ballot`, { token: y, body: { choice: "agree" } });
    expect(mid.json.status).toBe("open");
    const done = await call("POST", `/votes/${v.id}/ballot`, { token: z, body: { choice: "agree" } });
    expect(done.json.status).toBe("passed");
    expect(done.json.relation.status).toBe("removed");

    // Other links are untouched: A still has father, mother, child and sister.
    const tree = (await call("GET", "/tree?depth=1", { token: fam.tokens.A })).json;
    const names = tree.people.map((p: any) => fam.byId[p.id]).sort();
    expect(names).toEqual(["A", "F", "K", "M", "S"]);
  });

  it("fails once 2 disagree, keeping the link", async () => {
    const fam = await voteFamily();
    const v = (await call("POST", `/relations/${fam.marriage}/removal-votes`, { token: fam.tokens.A })).json;
    const [x, y] = v.voters.map((id: string) => fam.tokens[fam.byId[id]]);
    await call("POST", `/votes/${v.id}/ballot`, { token: x, body: { choice: "disagree" } });
    const done = await call("POST", `/votes/${v.id}/ballot`, { token: y, body: { choice: "disagree" } });
    expect(done.json.status).toBe("failed");
    expect(done.json.relation.status).toBe("active");
  });

  it("does not let the people in the link or non-chosen members vote", async () => {
    const fam = await voteFamily();
    const v = (await call("POST", `/relations/${fam.marriage}/removal-votes`, { token: fam.tokens.A })).json;
    for (const who of ["A", "W", "G"]) {
      const r = await call("POST", `/votes/${v.id}/ballot`, { token: fam.tokens[who], body: { choice: "agree" } });
      expect(r.status).toBe(403);
    }
  });

  it("replaces a voter who has not answered after 7 days", async () => {
    const fam = await voteFamily();
    const v = (await call("POST", `/relations/${fam.marriage}/removal-votes`, { token: fam.tokens.A })).json;
    const first = fam.byId[v.voters[0]];
    await call("POST", `/votes/${v.id}/ballot`, { token: fam.tokens[first], body: { choice: "agree" } });

    clock = new Date(clock.getTime() + 6 * 86400_000);
    expect((await call("GET", `/votes/${v.id}`, { token: fam.tokens.A })).json.voters).toHaveLength(4);
    expect((await call("GET", `/votes/${v.id}`, { token: fam.tokens.A })).json.voters).not.toContain(fam.ids.G);

    clock = new Date(clock.getTime() + 2 * 86400_000); // day 8
    const later = (await call("GET", `/votes/${v.id}`, { token: fam.tokens.A })).json;
    expect(later.voters).toHaveLength(4);
    expect(later.voters).toContain(fam.ids.G); // the only relative left to ask
    expect(later.voters).toContain(fam.ids[first as keyof typeof fam.ids]); // the one who answered stays
    expect(later.agree).toBe(1);

    // G can now vote.
    const g = await call("POST", `/votes/${v.id}/ballot`, { token: fam.tokens.G, body: { choice: "agree" } });
    expect(g.status).toBe(200);
  });

  it("explains when there are not enough relatives to vote yet", async () => {
    const a = await starter();
    const f = await add(a.token, a.id, "parent", { full_name: "Father" });
    const r = await call("POST", `/relations/${f.relations[0].id}/removal-votes`, { token: a.token });
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("not_enough_voters");
  });
});

describe("privacy", () => {
  it("hides living people's details beyond close relatives", async () => {
    const fam = await voteFamily();
    // Kid -> A -> F -> G is 3 steps: G is living, so only the name shows.
    const tree = (await call("GET", `/tree?depth=3`, { token: fam.tokens.K })).json;
    const g = tree.people.find((p: any) => p.id === fam.ids.G);
    expect(g.full_name).toBe("Grandfather");
    expect(g.birth_year).toBeUndefined();
    // A is 1 step from Kid: details show.
    const a = tree.people.find((p: any) => p.id === fam.ids.A);
    expect(a.birth_year).toBe(1985);
  });

  it("only searches people connected to you", async () => {
    const fam = await voteFamily();
    const r = (await call("GET", `/search?q=grand`, { token: fam.tokens.K })).json;
    expect(r.map((p: any) => p.id)).toEqual([fam.ids.G]);
  });
});
