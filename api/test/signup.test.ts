import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/index";
import { maskLogin } from "../src/rules";
import { testDb } from "./d1";

// Open sign-up (agreed 2026-11-14): anyone can sign up, then relatives confirm them.

const SETUP = "test-setup-secret";
let clock: Date;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  clock = new Date("2026-11-14T10:00:00Z");
  const db = testDb();
  app = createApp(() => ({ db, now: () => clock, random: () => 0 }));
});

const env = { SETUP_TOKEN: SETUP } as any;

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await app.request(
    path,
    {
      method,
      headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    },
    env,
  );
  return { status: res.status, json: (await res.json()) as any };
}

async function starter() {
  const r = await call("POST", "/setup", {
    body: { setup_token: SETUP, person: { full_name: "Koyas", birth_year: 1985 }, login: "koyas@example.com", password: "password123" },
  });
  return { id: r.json.person.id as string, token: r.json.token as string };
}

async function add(token: string, of: string, kind: string, person: Record<string, unknown>) {
  const r = await call("POST", "/relatives", { token, body: { of, kind, person } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json as { person: { id: string }; relations: { id: string; status: string }[] };
}

let n = 0;
async function signUp(name: string, login = `new${++n}@example.com`) {
  const r = await call("POST", "/signup", { body: { person: { full_name: name, birth_year: 2000 }, login, password: "password123" } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return { id: r.json.personId as string, token: r.json.token as string };
}

async function invite(token: string, personId: string) {
  const inv = await call("POST", `/people/${personId}/invites`, { token, body: {} });
  const acc = await call("POST", `/invites/${inv.json.token}/accept`, { body: { login: `m${++n}@example.com`, password: "password123" } });
  expect(acc.status, JSON.stringify(acc.json)).toBe(201);
  return acc.json.token as string;
}

const me = async (token: string) => (await call("GET", "/me", { token })).json;

describe("signing up without an invite", () => {
  it("works once the tree has started, and the newcomer starts outside the tree", async () => {
    expect((await call("POST", "/signup", { body: { person: { full_name: "X" }, login: "x@example.com", password: "password123" } })).status).toBe(409);
    await starter();
    const s = await signUp("Zain");
    const m = await me(s.token);
    expect(m.person.in_tree).toBe(0);
    expect(m.requests).toEqual([]);
    const taken = await call("POST", "/signup", { body: { person: { full_name: "Y" }, login: "koyas@example.com", password: "password123" } });
    expect(taken.status).toBe(409);
  });

  it("lets a newcomer search the whole tree, showing only names, birth years and parents", async () => {
    const k = await starter();
    const zain = await add(k.token, k.id, "child", { full_name: "Zain", birth_year: 2010, story: "private" });
    await signUp("Zain Other");
    const s = await signUp("Someone");
    const found = (await call("GET", "/search?q=Zain", { token: s.token })).json;
    expect(found).toHaveLength(1); // the other newcomer is not part of the tree yet
    expect(found[0]).toEqual({ id: zain.person.id, full_name: "Zain", birth_year: 2010, is_living: 1, parents: ["Koyas"], has_account: false });
  });

  it("hides most of the email or phone number from relatives", () => {
    expect(maskLogin("sara.ahmed@gmail.com")).toBe("sa••••••@gmail.com");
    expect(maskLogin("+966501231234")).toBe("+9665••••1234");
  });
});

describe('"This is me": claiming a profile', () => {
  it("moves the newcomer onto the profile once a close relative says yes", async () => {
    const k = await starter();
    const zain = await add(k.token, k.id, "child", { full_name: "Zain" });
    const s = await signUp("Zain", "+966501231234");
    const req = await call("POST", "/claims", { token: s.token, body: { person_id: zain.person.id } });
    expect(req.status, JSON.stringify(req.json)).toBe(201);
    expect(req.json.status).toBe("open");

    const checks = (await me(k.token)).checks;
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ kind: "claim", requester_name: "Zain", requester_login: "+9665••••1234", target_name: "Zain" });

    const done = await call("POST", `/join-requests/${req.json.id}/answer`, { token: k.token, body: { yes: true } });
    expect(done.json.status).toBe("approved");
    const after = await me(s.token);
    expect(after.person.id).toBe(zain.person.id);
    expect(after.person.birth_year).toBe(2000); // filled in from the sign-up, since it was empty
    // Now a full member: can add their own relatives.
    expect((await call("POST", "/relatives", { token: s.token, body: { of: zain.person.id, kind: "child", person: { full_name: "Baby" } } })).status).toBe(201);
    // The same login signs in to the claimed profile.
    const login = await call("POST", "/login", { body: { login: "+966501231234", password: "password123" } });
    expect(login.json.personId).toBe(zain.person.id);
  });

  it("asks the person who added the profile, even while their own link is still pending", async () => {
    const k = await starter();
    const sara = await add(k.token, k.id, "sibling", { full_name: "Sara" });
    expect(sara.relations[0].status).toBe("pending");
    const s = await signUp("Sara");
    const req = await call("POST", "/claims", { token: s.token, body: { person_id: sara.person.id } });
    expect(req.status, JSON.stringify(req.json)).toBe(201);
    await call("POST", `/join-requests/${req.json.id}/answer`, { token: k.token, body: { yes: true } });
    // Sara can now approve being Koyas's sister.
    const m = await me(s.token);
    expect(m.person.id).toBe(sara.person.id);
    expect(m.pending).toHaveLength(1);
  });

  it("is refused when a close relative says no", async () => {
    const k = await starter();
    const zain = await add(k.token, k.id, "child", { full_name: "Zain" });
    const s = await signUp("Zain");
    const req = (await call("POST", "/claims", { token: s.token, body: { person_id: zain.person.id } })).json;
    const done = await call("POST", `/join-requests/${req.id}/answer`, { token: k.token, body: { yes: false } });
    expect(done.json.status).toBe("rejected");
    expect((await me(s.token)).person.in_tree).toBe(0);
  });

  it("needs 2 yes answers from relatives further out when no close relative has joined", async () => {
    const k = await starter();
    // Father -> Koyas -> Kid (passed away) -> Grandkid (passed away) -> Great-grandkid, the profile being claimed.
    const f = await add(k.token, k.id, "parent", { full_name: "Father" });
    const kid = await add(k.token, k.id, "child", { full_name: "Kid", is_living: false });
    const gk = await add(k.token, kid.person.id, "child", { full_name: "Grandkid", is_living: false });
    const great = await add(k.token, gk.person.id, "child", { full_name: "Great-grandkid" });
    const fToken = await invite(k.token, f.person.id);
    const s = await signUp("Great-grandkid");
    const req = (await call("POST", "/claims", { token: s.token, body: { person_id: great.person.id } })).json;
    expect(req.close).toBe(false);
    expect(req.checkers).toBe(2); // Koyas (3 steps) and Father (4 steps)
    const one = await call("POST", `/join-requests/${req.id}/answer`, { token: fToken, body: { yes: true } });
    expect(one.json.status).toBe("open");
    const two = await call("POST", `/join-requests/${req.id}/answer`, { token: k.token, body: { yes: true } });
    expect(two.json.status).toBe("approved");
  });

  it("refuses profiles of people who passed away, members, and a second claim on the same profile", async () => {
    const k = await starter();
    const g = await add(k.token, k.id, "parent", { full_name: "Grandad", is_living: false });
    const zain = await add(k.token, k.id, "child", { full_name: "Zain" });
    const a = await signUp("A");
    const b = await signUp("B");
    expect((await call("POST", "/claims", { token: a.token, body: { person_id: g.person.id } })).status).toBe(400);
    expect((await call("POST", "/claims", { token: a.token, body: { person_id: k.id } })).status).toBe(409);
    expect((await call("POST", "/claims", { token: a.token, body: { person_id: zain.person.id } })).status).toBe(201);
    expect((await call("POST", "/claims", { token: b.token, body: { person_id: zain.person.id } })).status).toBe(409);
  });

  it("only lets checkers answer, once, and members cannot claim", async () => {
    const k = await starter();
    const zain = await add(k.token, k.id, "child", { full_name: "Zain" });
    const s = await signUp("Zain");
    const other = await signUp("Other");
    const req = (await call("POST", "/claims", { token: s.token, body: { person_id: zain.person.id } })).json;
    expect((await call("POST", `/join-requests/${req.id}/answer`, { token: other.token, body: { yes: true } })).status).toBe(403);
    expect((await call("POST", `/join-requests/${req.id}/answer`, { token: s.token, body: { yes: true } })).status).toBe(403);
    expect((await call("POST", "/claims", { token: k.token, body: { person_id: zain.person.id } })).status).toBe(409);
  });

  it("limits how many requests a newcomer can send", async () => {
    const k = await starter();
    const kids = [];
    for (let i = 0; i < 7; i++) kids.push(await add(k.token, k.id, "child", { full_name: `Kid ${i}` }));
    const s = await signUp("Spammer");
    for (let i = 0; i < 3; i++) expect((await call("POST", "/claims", { token: s.token, body: { person_id: kids[i].person.id } })).status).toBe(201);
    expect((await call("POST", "/claims", { token: s.token, body: { person_id: kids[3].person.id } })).status).toBe(429);
  });
});

describe('"This person is my relative": connecting to the tree', () => {
  it("keeps the link pending until a nearby relative confirms, then brings the newcomer and their family in", async () => {
    const k = await starter();
    const zain = await add(k.token, k.id, "child", { full_name: "Zain" });
    const s = await signUp("Omar");
    const omarKid = await add(s.token, s.id, "child", { full_name: "Omar's baby" });
    const link = await call("POST", "/relatives", { token: s.token, body: { of: s.id, kind: "parent", existingPersonId: k.id } });
    expect(link.status, JSON.stringify(link.json)).toBe(201);
    expect(link.json.relations[0].status).toBe("pending");
    expect(link.json.request.kind).toBe("link");

    const check = (await me(k.token)).checks[0];
    expect(check).toMatchObject({ requester_name: "Omar", target_name: "Koyas" });
    await call("POST", `/join-requests/${check.id}/answer`, { token: k.token, body: { yes: true } });

    const m = await me(s.token);
    expect(m.person.in_tree).toBe(1);
    const tree = (await call("GET", "/tree?depth=3", { token: k.token })).json;
    const names = tree.people.map((p: any) => p.full_name).sort();
    expect(names).toEqual(["Koyas", "Omar", "Omar's baby", "Zain"]);
    // Zain and Omar now share a parent. Zain has not joined to confirm it, so it is accepted (same rule as before).
    const sib = tree.relations.find((r: any) => r.type === "sibling");
    expect(sib.status).toBe("active");
    expect((await call("GET", `/people/${omarKid.person.id}`, { token: k.token })).status).toBe(200);
  });

  it("does not let a member pull in a newcomer who has not been confirmed", async () => {
    const k = await starter();
    const s = await signUp("Omar");
    const r = await call("POST", "/relatives", { token: k.token, body: { of: k.id, kind: "child", existingPersonId: s.id } });
    expect(r.status).toBe(403);
  });
});

describe("objecting to a wrong link", () => {
  it("lets any member connected to the family start the vote, but not a newcomer", async () => {
    const k = await starter();
    const f = await add(k.token, k.id, "parent", { full_name: "Father" });
    const zain = await add(k.token, k.id, "child", { full_name: "Zain" });
    const fToken = await invite(k.token, f.person.id);
    const zToken = await invite(k.token, zain.person.id);
    // Father objects to the link between Koyas and Zain; he is not part of it.
    const sibling = await add(k.token, k.id, "sibling", { full_name: "Sister", is_living: false });
    const v = await call("POST", `/relations/${sibling.relations[0].id}/removal-votes`, { token: fToken });
    expect(v.status).toBe(409); // allowed to object, but not enough members to vote yet
    expect(v.json.error).toBe("not_enough_voters");
    const s = await signUp("Stranger");
    const no = await call("POST", `/relations/${sibling.relations[0].id}/removal-votes`, { token: s.token });
    expect(no.status).toBe(403);
    expect(zToken).toBeTruthy();
  });
});
