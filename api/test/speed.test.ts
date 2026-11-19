import { describe, it, expect, beforeEach } from "vitest";
import { createApp } from "../src/index";
import { testDb } from "./d1";

// Every database query from a Cloudflare Worker is a trip over the network to D1,
// so the tree must load with a small, fixed number of queries, whatever its size.

const SETUP = "test-setup-secret";
let app: ReturnType<typeof createApp>;
let queries = 0;

beforeEach(() => {
  const db = testDb();
  const counting = { prepare: (sql: string) => (queries++, db.prepare(sql)) } as unknown as D1Database;
  app = createApp(() => ({ db: counting, now: () => new Date("2026-11-19T10:00:00Z"), random: () => 0 }));
});

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(
    path,
    { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) },
    { SETUP_TOKEN: SETUP } as any,
  );
  return (await res.json()) as any;
}

/** A family of 41: grandparents on both sides, parents, uncles and aunts, cousins, siblings, children, grandchildren. */
async function bigFamily() {
  const s = await call("POST", "/setup", undefined, { setup_token: SETUP, person: { full_name: "Koyas" }, login: "k@example.com", password: "password123" });
  const t = s.token as string;
  const add = async (of: string, kind: string, name: string) => (await call("POST", "/relatives", t, { of, kind, person: { full_name: name } })).person.id as string;
  const me = s.person.id as string;
  const dad = await add(me, "parent", "Dad");
  const mum = await add(me, "parent", "Mum");
  for (const p of [dad, mum]) {
    const gp1 = await add(p, "parent", `${p} grandfather`);
    await add(p, "parent", `${p} grandmother`);
    for (let i = 0; i < 2; i++) {
      const uncle = await add(gp1, "child", `Uncle ${i}`);
      for (let j = 0; j < 3; j++) await add(uncle, "child", `Cousin ${i}${j}`);
    }
  }
  for (let i = 0; i < 2; i++) {
    const sib = await add(dad, "child", `Sibling ${i}`);
    await add(sib, "child", `Nephew ${i}`);
  }
  for (let i = 0; i < 3; i++) {
    const kid = await add(me, "child", `Child ${i}`);
    await add(kid, "child", `Grandchild ${i}`);
  }
  return t;
}

describe("speed", () => {
  it("loads a big tree with few database queries", async () => {
    const t = await bigFamily();
    queries = 0;
    const tree = await call("GET", "/tree?depth=4", t);
    const treeQueries = queries;
    queries = 0;
    await call("GET", "/me", t);
    expect(treeQueries).toBeLessThanOrEqual(15);
    console.log(`people in tree: ${tree.people.length}, /tree queries: ${treeQueries}, /me queries: ${queries}`);
    expect(tree.people.length).toBe(33);
  });
});
