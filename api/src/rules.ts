// The family tree rules agreed with the project owner:
//
// 1. One single global tree. Nobody can sign up directly: a member adds a
//    relative and shares an invite link; the relative joins through it.
// 2. Parents and children are linked straight away, without approval.
// 3. Siblings and spouses must be approved by the other person. Sibling links
//    that appear because a new child joins parents who already have children
//    also need approval.
// 4. A wrong link is removed by a vote: 4 relatives are picked at random
//    (closest relatives first, then further out). 3 must agree. The two people
//    in the link can never vote. A voter who has not answered in 7 days is
//    replaced by another random relative. A vote removes only that one link.

import { HttpError, hashPassword, newId, normalizeLogin, randomToken, shuffle, timingSafeEqual } from "./util";

export interface Ctx {
  db: D1Database;
  now: () => Date;
  random: () => number;
}

export type RelationType = "parent" | "spouse" | "sibling";
export type RelationStatus = "active" | "pending" | "removed" | "rejected";
export type RelativeKind = "parent" | "child" | "sibling" | "spouse";

export interface Person {
  id: string;
  full_name: string;
  gender: string | null;
  birth_year: number | null;
  is_living: number;
  death_year: number | null;
  birthplace: string | null;
  country: string | null;
  story: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Relation {
  id: string;
  type: RelationType;
  a_id: string;
  b_id: string;
  status: RelationStatus;
  approver_id: string | null;
  divorced: number;
  created_by: string | null;
  created_at: string;
  decided_at: string | null;
}

export interface PersonInput {
  full_name: string;
  gender?: string | null;
  birth_year?: number | null;
  is_living?: boolean;
  death_year?: number | null;
  birthplace?: string | null;
  country?: string | null;
  story?: string | null;
}

export const VOTERS_PER_VOTE = 4;
export const VOTES_NEEDED = 3;
export const VOTER_TIMEOUT_DAYS = 7;
const SESSION_DAYS = 60;
const MAX_TREE_DEPTH = 6;

const iso = (ctx: Ctx) => ctx.now().toISOString();

// ---------- people ----------

function cleanText(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new HttpError(400, "bad_input", "Expected text.");
  const trimmed = value.trim();
  if (trimmed.length > max) throw new HttpError(400, "bad_input", `Text longer than ${max} characters.`);
  return trimmed === "" ? null : trimmed;
}

function cleanYear(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 3000) throw new HttpError(400, "bad_input", "Year must be a whole number.");
  return n;
}

function validatePerson(input: PersonInput) {
  const full_name = cleanText(input?.full_name, 120);
  if (!full_name) throw new HttpError(400, "bad_input", "A name is required.");
  const gender = cleanText(input.gender, 20);
  if (gender && !["male", "female", "other"].includes(gender)) {
    throw new HttpError(400, "bad_input", "Gender must be male, female or other.");
  }
  const is_living = input.is_living === false ? 0 : 1;
  const birth_year = cleanYear(input.birth_year);
  const death_year = is_living ? null : cleanYear(input.death_year);
  if (birth_year && death_year && death_year < birth_year) {
    throw new HttpError(400, "bad_input", "Death year cannot be before birth year.");
  }
  return {
    full_name,
    gender,
    birth_year,
    is_living,
    death_year,
    birthplace: cleanText(input.birthplace, 120),
    country: cleanText(input.country, 80),
    story: cleanText(input.story, 2000),
  };
}

async function insertPerson(ctx: Ctx, input: PersonInput, createdBy: string | null): Promise<Person> {
  const p = validatePerson(input);
  const person: Person = { id: newId(), ...p, created_by: createdBy, created_at: iso(ctx) };
  await ctx.db
    .prepare(
      `INSERT INTO people (id, full_name, gender, birth_year, is_living, death_year, birthplace, country, story, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      person.id,
      person.full_name,
      person.gender,
      person.birth_year,
      person.is_living,
      person.death_year,
      person.birthplace,
      person.country,
      person.story,
      person.created_by,
      person.created_at,
    )
    .run();
  return person;
}

export async function getPerson(ctx: Ctx, id: string): Promise<Person> {
  const person = await ctx.db.prepare(`SELECT * FROM people WHERE id = ?`).bind(id).first<Person>();
  if (!person) throw new HttpError(404, "not_found", "Person not found.");
  return person;
}

async function hasAccount(ctx: Ctx, personId: string): Promise<boolean> {
  const row = await ctx.db.prepare(`SELECT 1 AS x FROM accounts WHERE person_id = ?`).bind(personId).first();
  return !!row;
}

async function relationsOf(ctx: Ctx, personId: string, statuses: RelationStatus[]): Promise<Relation[]> {
  const marks = statuses.map(() => "?").join(", ");
  const { results } = await ctx.db
    .prepare(`SELECT * FROM relations WHERE (a_id = ? OR b_id = ?) AND status IN (${marks})`)
    .bind(personId, personId, ...statuses)
    .all<Relation>();
  return results;
}

/**
 * A member may manage their own profile, and the profile of a relative who
 * has no account of their own (a baby, someone who passed away, or someone
 * not invited yet) if they added that relative or are directly linked to them.
 */
async function canManage(ctx: Ctx, actorId: string, personId: string): Promise<boolean> {
  if (actorId === personId) return true;
  if (await hasAccount(ctx, personId)) return false;
  const person = await getPerson(ctx, personId);
  if (person.created_by === actorId) return true;
  const links = await relationsOf(ctx, personId, ["active", "pending"]);
  return links.some((r) => r.a_id === actorId || r.b_id === actorId);
}

export async function updatePerson(ctx: Ctx, actorId: string, personId: string, input: Partial<PersonInput>) {
  if (!(await canManage(ctx, actorId, personId))) {
    throw new HttpError(403, "forbidden", "You can only edit yourself or close relatives who have no account.");
  }
  const current = await getPerson(ctx, personId);
  const merged: PersonInput = {
    full_name: input.full_name ?? current.full_name,
    gender: input.gender !== undefined ? input.gender : current.gender,
    birth_year: input.birth_year !== undefined ? input.birth_year : current.birth_year,
    is_living: input.is_living !== undefined ? input.is_living : current.is_living === 1,
    death_year: input.death_year !== undefined ? input.death_year : current.death_year,
    birthplace: input.birthplace !== undefined ? input.birthplace : current.birthplace,
    country: input.country !== undefined ? input.country : current.country,
    story: input.story !== undefined ? input.story : current.story,
  };
  const p = validatePerson(merged);
  await ctx.db
    .prepare(
      `UPDATE people SET full_name = ?, gender = ?, birth_year = ?, is_living = ?, death_year = ?,
       birthplace = ?, country = ?, story = ? WHERE id = ?`,
    )
    .bind(p.full_name, p.gender, p.birth_year, p.is_living, p.death_year, p.birthplace, p.country, p.story, personId)
    .run();
  return getPerson(ctx, personId);
}

// ---------- accounts and sessions ----------

async function createAccount(ctx: Ctx, personId: string, login: string, password: string) {
  const normalized = normalizeLogin(login ?? "");
  if (normalized.length < 5) throw new HttpError(400, "bad_input", "Enter a valid email or phone number.");
  if (typeof password !== "string" || password.length < 8) {
    throw new HttpError(400, "bad_input", "Password must be at least 8 characters.");
  }
  const taken = await ctx.db.prepare(`SELECT 1 AS x FROM accounts WHERE login = ?`).bind(normalized).first();
  if (taken) throw new HttpError(409, "login_taken", "This email or phone number is already used.");
  const salt = randomToken(16);
  const hash = await hashPassword(password, salt);
  const id = newId();
  await ctx.db
    .prepare(`INSERT INTO accounts (id, person_id, login, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, personId, normalized, hash, salt, iso(ctx))
    .run();
  return id;
}

async function createSession(ctx: Ctx, accountId: string): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(ctx.now().getTime() + SESSION_DAYS * 86400_000).toISOString();
  await ctx.db
    .prepare(`INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)`)
    .bind(token, accountId, iso(ctx), expires)
    .run();
  return token;
}

/** The very first person. Only possible while the tree is empty. */
export async function createStarter(ctx: Ctx, person: PersonInput, login: string, password: string) {
  const any = await ctx.db.prepare(`SELECT 1 AS x FROM people LIMIT 1`).first();
  if (any) throw new HttpError(409, "already_started", "The tree already has its first person.");
  const p = await insertPerson(ctx, person, null);
  const accountId = await createAccount(ctx, p.id, login, password);
  return { person: p, token: await createSession(ctx, accountId) };
}

export async function login(ctx: Ctx, loginValue: string, password: string) {
  const row = await ctx.db
    .prepare(`SELECT * FROM accounts WHERE login = ?`)
    .bind(normalizeLogin(loginValue ?? ""))
    .first<{ id: string; person_id: string; password_hash: string; salt: string }>();
  if (!row || !(await checkPassword(row, password))) {
    throw new HttpError(401, "bad_login", "Wrong email/phone or password.");
  }
  return { personId: row.person_id, token: await createSession(ctx, row.id) };
}

async function checkPassword(row: { password_hash: string; salt: string }, password: string) {
  if (typeof password !== "string") return false;
  return timingSafeEqual(await hashPassword(password, row.salt), row.password_hash);
}

export async function personForSession(ctx: Ctx, token: string | null): Promise<string> {
  if (!token) throw new HttpError(401, "signed_out", "Please sign in.");
  const row = await ctx.db
    .prepare(
      `SELECT a.person_id AS person_id, s.expires_at AS expires_at
       FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = ?`,
    )
    .bind(token)
    .first<{ person_id: string; expires_at: string }>();
  if (!row || row.expires_at < iso(ctx)) throw new HttpError(401, "signed_out", "Please sign in again.");
  return row.person_id;
}

export async function logout(ctx: Ctx, token: string) {
  await ctx.db.prepare(`DELETE FROM sessions WHERE token = ?`).bind(token).run();
}

// ---------- invites ----------

export async function createInvite(ctx: Ctx, actorId: string, personId: string, contact?: string | null) {
  if (actorId === personId) throw new HttpError(400, "bad_input", "You are already a member.");
  if (await hasAccount(ctx, personId)) throw new HttpError(409, "already_member", "This person has already joined.");
  if (!(await canManage(ctx, actorId, personId))) {
    throw new HttpError(403, "forbidden", "You can only invite relatives you added or are linked to.");
  }
  const token = randomToken(18);
  await ctx.db
    .prepare(`INSERT INTO invites (token, person_id, contact, created_by, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(token, personId, cleanText(contact, 120), actorId, iso(ctx))
    .run();
  return token;
}

export async function getInvite(ctx: Ctx, token: string) {
  const invite = await ctx.db
    .prepare(`SELECT * FROM invites WHERE token = ?`)
    .bind(token)
    .first<{ token: string; person_id: string; created_by: string; used_at: string | null }>();
  if (!invite) throw new HttpError(404, "not_found", "This invite link is not valid.");
  if (invite.used_at) throw new HttpError(410, "used", "This invite link was already used.");
  const person = await getPerson(ctx, invite.person_id);
  const inviter = await getPerson(ctx, invite.created_by);
  return { person, invitedBy: inviter.full_name };
}

export async function acceptInvite(ctx: Ctx, token: string, loginValue: string, password: string) {
  const { person } = await getInvite(ctx, token);
  if (await hasAccount(ctx, person.id)) throw new HttpError(409, "already_member", "This person has already joined.");
  if (person.is_living === 0) throw new HttpError(400, "bad_input", "This profile is marked as passed away.");
  const accountId = await createAccount(ctx, person.id, loginValue, password);
  await ctx.db.prepare(`UPDATE invites SET used_at = ? WHERE token = ?`).bind(iso(ctx), token).run();
  return { personId: person.id, token: await createSession(ctx, accountId) };
}

// ---------- relations ----------

async function insertRelation(
  ctx: Ctx,
  r: Omit<Relation, "id" | "created_at" | "decided_at" | "divorced">,
): Promise<Relation> {
  const rel: Relation = {
    id: newId(),
    ...r,
    divorced: 0,
    created_at: iso(ctx),
    decided_at: r.status === "active" ? iso(ctx) : null,
  };
  await ctx.db
    .prepare(
      `INSERT INTO relations (id, type, a_id, b_id, status, approver_id, divorced, created_by, created_at, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    )
    .bind(rel.id, rel.type, rel.a_id, rel.b_id, rel.status, rel.approver_id, rel.created_by, rel.created_at, rel.decided_at)
    .run();
  return rel;
}

async function existingLink(ctx: Ctx, x: string, y: string): Promise<Relation | null> {
  return ctx.db
    .prepare(
      `SELECT * FROM relations WHERE status IN ('active', 'pending')
       AND ((a_id = ? AND b_id = ?) OR (a_id = ? AND b_id = ?)) LIMIT 1`,
    )
    .bind(x, y, y, x)
    .first<Relation>();
}

async function parentsOf(ctx: Ctx, personId: string): Promise<string[]> {
  const { results } = await ctx.db
    .prepare(`SELECT a_id FROM relations WHERE type = 'parent' AND status = 'active' AND b_id = ?`)
    .bind(personId)
    .all<{ a_id: string }>();
  return results.map((r) => r.a_id);
}

async function childrenOf(ctx: Ctx, personId: string): Promise<string[]> {
  const { results } = await ctx.db
    .prepare(`SELECT b_id FROM relations WHERE type = 'parent' AND status = 'active' AND a_id = ?`)
    .bind(personId)
    .all<{ b_id: string }>();
  return results.map((r) => r.b_id);
}

/**
 * Who approves a sibling or spouse link with `target`: the target themselves.
 * Someone who passed away can never approve, so their link is accepted.
 * Returns null when the link can be active straight away.
 */
async function approverFor(ctx: Ctx, target: string, other: string, actorId: string | null): Promise<string | null> {
  const t = await getPerson(ctx, target);
  if (t.is_living === 1 && target !== actorId) return target;
  // Target can't approve (passed away) or is the one creating it: ask the other side if it isn't the actor.
  const o = await getPerson(ctx, other);
  if (o.is_living === 1 && other !== actorId && (await hasAccount(ctx, other))) return other;
  return null;
}

/**
 * When `child` gets a new parent, every other child of that parent becomes a
 * sibling. Those sibling links need approval (rule 3).
 */
async function linkImpliedSiblings(ctx: Ctx, actorId: string, parentId: string, child: string) {
  for (const sibling of await childrenOf(ctx, parentId)) {
    if (sibling === child) continue;
    if (await existingLink(ctx, sibling, child)) continue;
    const approver = await impliedSiblingApprover(ctx, actorId, sibling, child);
    await insertRelation(ctx, {
      type: "sibling",
      a_id: sibling,
      b_id: child,
      status: approver ? "pending" : "active",
      approver_id: approver,
      created_by: actorId,
    });
  }
}

async function impliedSiblingApprover(ctx: Ctx, actorId: string, existing: string, added: string) {
  // The sibling who was already in the tree confirms the newcomer, if they can.
  for (const candidate of [existing, added]) {
    if (candidate === actorId) continue;
    const p = await getPerson(ctx, candidate);
    if (p.is_living === 1 && (await hasAccount(ctx, candidate))) return candidate;
  }
  // Nobody else can confirm (for example a parent adding two babies): accept it.
  return null;
}

export interface AddRelativeInput {
  kind: RelativeKind;
  of: string; // the person whose relative is being added
  person?: PersonInput; // a new profile...
  existingPersonId?: string; // ...or someone already in the tree
  otherParentId?: string; // for kind 'child': the spouse who is the other parent
}

export async function addRelative(ctx: Ctx, actorId: string, input: AddRelativeInput) {
  const { kind, of } = input;
  if (!["parent", "child", "sibling", "spouse"].includes(kind)) {
    throw new HttpError(400, "bad_input", "Relation must be parent, child, sibling or spouse.");
  }
  await getPerson(ctx, of);
  if (!(await canManage(ctx, actorId, of))) {
    throw new HttpError(403, "forbidden", "You can add relatives to yourself, or to close relatives who have no account.");
  }

  let relativeId: string;
  if (input.existingPersonId) {
    if (input.existingPersonId === of) throw new HttpError(400, "bad_input", "A person cannot be their own relative.");
    relativeId = (await getPerson(ctx, input.existingPersonId)).id;
    if (await existingLink(ctx, of, relativeId)) {
      throw new HttpError(409, "already_linked", "These two people are already linked.");
    }
  } else {
    if (!input.person) throw new HttpError(400, "bad_input", "Give the new relative's details.");
    relativeId = "";
  }

  if (kind === "parent" && (await parentsOf(ctx, of)).length >= 2) {
    throw new HttpError(409, "too_many_parents", "This person already has two parents.");
  }

  if (!relativeId) relativeId = (await insertPerson(ctx, input.person!, actorId)).id;

  const created: Relation[] = [];
  if (kind === "parent" || kind === "child") {
    const parent = kind === "parent" ? relativeId : of;
    const child = kind === "parent" ? of : relativeId;
    if (kind === "child" && (await parentsOf(ctx, child)).length >= 2) {
      throw new HttpError(409, "too_many_parents", "This person already has two parents.");
    }
    created.push(
      await insertRelation(ctx, {
        type: "parent",
        a_id: parent,
        b_id: child,
        status: "active", // rule 2: no approval
        approver_id: null,
        created_by: actorId,
      }),
    );
    await linkImpliedSiblings(ctx, actorId, parent, child);

    if (kind === "child" && input.otherParentId) {
      const spouseLink = await existingLink(ctx, of, input.otherParentId);
      if (!spouseLink || spouseLink.type !== "spouse" || spouseLink.status !== "active") {
        throw new HttpError(400, "bad_input", "The other parent must be an approved spouse.");
      }
      created.push(
        await insertRelation(ctx, {
          type: "parent",
          a_id: input.otherParentId,
          b_id: relativeId,
          status: "active",
          approver_id: null,
          created_by: actorId,
        }),
      );
      await linkImpliedSiblings(ctx, actorId, input.otherParentId, relativeId);
    }
  } else {
    // Sibling or spouse: rule 3, the other person approves.
    const approver = await approverFor(ctx, relativeId, of, actorId);
    created.push(
      await insertRelation(ctx, {
        type: kind,
        a_id: of,
        b_id: relativeId,
        status: approver ? "pending" : "active",
        approver_id: approver,
        created_by: actorId,
      }),
    );
  }

  return { person: await getPerson(ctx, relativeId), relations: created };
}

export async function decideRelation(ctx: Ctx, actorId: string, relationId: string, approve: boolean) {
  const rel = await ctx.db.prepare(`SELECT * FROM relations WHERE id = ?`).bind(relationId).first<Relation>();
  if (!rel) throw new HttpError(404, "not_found", "Relation not found.");
  if (rel.status !== "pending" || rel.approver_id !== actorId) {
    throw new HttpError(403, "forbidden", "This request is not waiting for your answer.");
  }
  const status: RelationStatus = approve ? "active" : "rejected";
  await ctx.db
    .prepare(`UPDATE relations SET status = ?, decided_at = ? WHERE id = ?`)
    .bind(status, iso(ctx), relationId)
    .run();
  return { ...rel, status };
}

export async function setDivorced(ctx: Ctx, actorId: string, relationId: string, divorced: boolean) {
  const rel = await ctx.db.prepare(`SELECT * FROM relations WHERE id = ?`).bind(relationId).first<Relation>();
  if (!rel) throw new HttpError(404, "not_found", "Relation not found.");
  if (rel.type !== "spouse" || rel.status !== "active") {
    throw new HttpError(400, "bad_input", "Only an approved marriage can be marked as divorced.");
  }
  if (!(await canManage(ctx, actorId, rel.a_id)) && !(await canManage(ctx, actorId, rel.b_id))) {
    throw new HttpError(403, "forbidden", "Only the couple can change this.");
  }
  await ctx.db.prepare(`UPDATE relations SET divorced = ? WHERE id = ?`).bind(divorced ? 1 : 0, relationId).run();
  return { ...rel, divorced: divorced ? 1 : 0 };
}

export async function pendingForMe(ctx: Ctx, actorId: string) {
  const { results } = await ctx.db
    .prepare(
      `SELECT r.*, pa.full_name AS a_name, pb.full_name AS b_name FROM relations r
       JOIN people pa ON pa.id = r.a_id JOIN people pb ON pb.id = r.b_id
       WHERE r.status = 'pending' AND r.approver_id = ? ORDER BY r.created_at`,
    )
    .bind(actorId)
    .all();
  return results;
}

// ---------- the graph ----------

/** Breadth-first distances over active links. */
async function distancesFrom(ctx: Ctx, starts: string[], maxDepth: number, skipRelationId?: string) {
  const dist = new Map<string, number>(starts.map((s) => [s, 0]));
  let frontier = [...starts];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const r of await relationsOf(ctx, id, ["active"])) {
        if (r.id === skipRelationId) continue;
        const other = r.a_id === id ? r.b_id : r.a_id;
        if (!dist.has(other)) {
          dist.set(other, depth);
          next.push(other);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

const CLOSE_DISTANCE = 2;

export async function getTree(ctx: Ctx, actorId: string, rootId: string, depth = 3) {
  const d = Math.min(Math.max(Number(depth) || 3, 1), MAX_TREE_DEPTH);
  await getPerson(ctx, rootId);
  const fromRoot = await distancesFrom(ctx, [rootId], d);
  const closeToMe = await distancesFrom(ctx, [actorId], CLOSE_DISTANCE);
  if (
    !fromRoot.has(actorId) &&
    !(await canManage(ctx, actorId, rootId)) &&
    !(await existingLink(ctx, actorId, rootId)) &&
    !(await distancesFrom(ctx, [actorId], MAX_TREE_DEPTH * 2)).has(rootId)
  ) {
    throw new HttpError(403, "forbidden", "You can only view people connected to you.");
  }

  const ids = [...fromRoot.keys()];
  const people = [];
  for (const id of ids) {
    const p = await getPerson(ctx, id);
    const member = await hasAccount(ctx, id);
    const canEdit = await canManage(ctx, actorId, id);
    // Privacy: details of living people are shown only to close relatives
    // (and to whoever looks after a profile that has no account).
    const showDetails = p.is_living === 0 || closeToMe.has(id) || canEdit;
    people.push({
      id: p.id,
      full_name: p.full_name,
      is_living: p.is_living,
      has_account: member,
      ...(showDetails
        ? {
            gender: p.gender,
            birth_year: p.birth_year,
            death_year: p.death_year,
            birthplace: p.birthplace,
            country: p.country,
            story: p.story,
          }
        : {}),
      can_edit: canEdit,
    });
  }

  const idSet = new Set(ids);
  const relations: Relation[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    for (const r of await relationsOf(ctx, id, ["active", "pending"])) {
      if (seen.has(r.id) || !idSet.has(r.a_id) || !idSet.has(r.b_id)) continue;
      // Pending links are only shown to the two people involved and their creator.
      if (r.status === "pending" && ![r.a_id, r.b_id, r.created_by].includes(actorId)) continue;
      seen.add(r.id);
      relations.push(r);
    }
  }
  // Pending links to people outside the window (e.g. a sibling just added) for the viewer.
  for (const r of await relationsOf(ctx, actorId, ["pending"])) {
    if (seen.has(r.id)) continue;
    // Only show it next to the person being viewed (or when viewing yourself).
    if (rootId !== actorId && r.a_id !== rootId && r.b_id !== rootId) continue;
    for (const end of [r.a_id, r.b_id]) {
      if (idSet.has(end)) continue;
      const p = await getPerson(ctx, end);
      const close = end === actorId || closeToMe.has(end);
      people.push({
        id: p.id,
        full_name: p.full_name,
        is_living: p.is_living,
        has_account: await hasAccount(ctx, end),
        ...(close ? { gender: p.gender, birth_year: p.birth_year, death_year: p.death_year, birthplace: p.birthplace, country: p.country, story: p.story } : {}),
        can_edit: await canManage(ctx, actorId, end),
      });
      idSet.add(end);
    }
    seen.add(r.id);
    relations.push(r);
  }
  return { root: rootId, me: actorId, people, relations };
}

export async function searchPeople(ctx: Ctx, actorId: string, query: string) {
  const q = (query ?? "").trim();
  if (q.length < 2) return [];
  // Only people connected to the searcher, so strangers can't be browsed.
  const reach = await distancesFrom(ctx, [actorId], MAX_TREE_DEPTH);
  const { results } = await ctx.db
    .prepare(`SELECT id, full_name, birth_year, is_living FROM people WHERE full_name LIKE ? LIMIT 200`)
    .bind(`%${q.replace(/[%_]/g, "")}%`)
    .all<{ id: string; full_name: string; birth_year: number | null; is_living: number }>();
  return results.filter((p) => reach.has(p.id)).slice(0, 20);
}

// ---------- removal votes ----------

interface Vote {
  id: string;
  relation_id: string;
  requested_by: string;
  status: "open" | "passed" | "failed";
  created_at: string;
  closed_at: string | null;
}

interface Ballot {
  id: string;
  vote_id: string;
  voter_id: string;
  choice: "agree" | "disagree" | null;
  assigned_at: string;
  responded_at: string | null;
  replaced: number;
}

/**
 * Relatives who could vote on a link, closest first. Each distance tier is
 * shuffled so the pick is random within it. The two people in the link are
 * never included, and only members with an account can vote.
 */
async function voterCandidates(ctx: Ctx, rel: Relation, exclude: Set<string>) {
  const dist = await distancesFrom(ctx, [rel.a_id, rel.b_id], 50, rel.id);
  const tiers = new Map<number, string[]>();
  for (const [id, d] of dist) {
    if (d === 0 || id === rel.a_id || id === rel.b_id || exclude.has(id)) continue;
    const p = await getPerson(ctx, id);
    if (p.is_living !== 1 || !(await hasAccount(ctx, id))) continue;
    tiers.set(d, [...(tiers.get(d) ?? []), id]);
  }
  const ordered: string[] = [];
  for (const d of [...tiers.keys()].sort((x, y) => x - y)) ordered.push(...shuffle(tiers.get(d)!, ctx.random));
  return ordered;
}

async function insertBallot(ctx: Ctx, voteId: string, voterId: string) {
  await ctx.db
    .prepare(`INSERT INTO ballots (id, vote_id, voter_id, assigned_at, replaced) VALUES (?, ?, ?, ?, 0)`)
    .bind(newId(), voteId, voterId, iso(ctx))
    .run();
}

export async function startRemovalVote(ctx: Ctx, actorId: string, relationId: string) {
  const rel = await ctx.db.prepare(`SELECT * FROM relations WHERE id = ?`).bind(relationId).first<Relation>();
  if (!rel || rel.status !== "active") throw new HttpError(404, "not_found", "Active relation not found.");
  const allowed =
    rel.a_id === actorId ||
    rel.b_id === actorId ||
    rel.created_by === actorId ||
    (await canManage(ctx, actorId, rel.a_id)) ||
    (await canManage(ctx, actorId, rel.b_id));
  if (!allowed) throw new HttpError(403, "forbidden", "Only someone in this link can ask to remove it.");
  const open = await ctx.db
    .prepare(`SELECT id FROM removal_votes WHERE relation_id = ? AND status = 'open'`)
    .bind(relationId)
    .first();
  if (open) throw new HttpError(409, "vote_open", "A vote on this link is already running.");

  const candidates = await voterCandidates(ctx, rel, new Set([actorId]));
  if (candidates.length < VOTERS_PER_VOTE) {
    throw new HttpError(
      409,
      "not_enough_voters",
      `A vote needs ${VOTERS_PER_VOTE} relatives with accounts; only ${candidates.length} can vote right now.`,
    );
  }
  const voteId = newId();
  await ctx.db
    .prepare(`INSERT INTO removal_votes (id, relation_id, requested_by, status, created_at) VALUES (?, ?, ?, 'open', ?)`)
    .bind(voteId, relationId, actorId, iso(ctx))
    .run();
  for (const voter of candidates.slice(0, VOTERS_PER_VOTE)) await insertBallot(ctx, voteId, voter);
  return getVote(ctx, voteId);
}

/** Replace voters who have not answered within 7 days (rule 4). */
async function replaceSlowVoters(ctx: Ctx, vote: Vote) {
  if (vote.status !== "open") return;
  const cutoff = new Date(ctx.now().getTime() - VOTER_TIMEOUT_DAYS * 86400_000).toISOString();
  const { results: ballots } = await ctx.db
    .prepare(`SELECT * FROM ballots WHERE vote_id = ?`)
    .bind(vote.id)
    .all<Ballot>();
  const slow = ballots.filter((b) => !b.replaced && !b.choice && b.assigned_at <= cutoff);
  if (!slow.length) return;
  const rel = await ctx.db.prepare(`SELECT * FROM relations WHERE id = ?`).bind(vote.relation_id).first<Relation>();
  const everAssigned = new Set([...ballots.map((b) => b.voter_id), vote.requested_by]);
  const candidates = await voterCandidates(ctx, rel!, everAssigned);
  for (const ballot of slow) {
    const replacement = candidates.shift();
    if (!replacement) break; // nobody left to ask: keep waiting for this voter
    await ctx.db.prepare(`UPDATE ballots SET replaced = 1 WHERE id = ?`).bind(ballot.id).run();
    await insertBallot(ctx, vote.id, replacement);
  }
}

async function tally(ctx: Ctx, vote: Vote) {
  const { results } = await ctx.db
    .prepare(`SELECT choice FROM ballots WHERE vote_id = ? AND replaced = 0`)
    .bind(vote.id)
    .all<{ choice: string | null }>();
  const agree = results.filter((b) => b.choice === "agree").length;
  const disagree = results.filter((b) => b.choice === "disagree").length;
  let status: Vote["status"] = "open";
  if (agree >= VOTES_NEEDED) status = "passed";
  else if (disagree > VOTERS_PER_VOTE - VOTES_NEEDED) status = "failed";
  if (status !== "open") {
    await ctx.db
      .prepare(`UPDATE removal_votes SET status = ?, closed_at = ? WHERE id = ?`)
      .bind(status, iso(ctx), vote.id)
      .run();
    if (status === "passed") {
      // A vote removes only this one link.
      await ctx.db
        .prepare(`UPDATE relations SET status = 'removed', decided_at = ? WHERE id = ?`)
        .bind(iso(ctx), vote.relation_id)
        .run();
    }
  }
  return { agree, disagree, status };
}

export async function getVote(ctx: Ctx, voteId: string) {
  let vote = await ctx.db.prepare(`SELECT * FROM removal_votes WHERE id = ?`).bind(voteId).first<Vote>();
  if (!vote) throw new HttpError(404, "not_found", "Vote not found.");
  await replaceSlowVoters(ctx, vote);
  vote = (await ctx.db.prepare(`SELECT * FROM removal_votes WHERE id = ?`).bind(voteId).first<Vote>())!;
  const { results } = await ctx.db
    .prepare(`SELECT voter_id, choice, replaced FROM ballots WHERE vote_id = ? AND replaced = 0`)
    .bind(voteId)
    .all<{ voter_id: string; choice: string | null }>();
  const rel = await ctx.db.prepare(`SELECT * FROM relations WHERE id = ?`).bind(vote.relation_id).first<Relation>();
  return {
    ...vote,
    relation: rel,
    voters: results.map((b) => b.voter_id),
    agree: results.filter((b) => b.choice === "agree").length,
    disagree: results.filter((b) => b.choice === "disagree").length,
  };
}

export async function castBallot(ctx: Ctx, actorId: string, voteId: string, choice: "agree" | "disagree") {
  if (choice !== "agree" && choice !== "disagree") throw new HttpError(400, "bad_input", "Choose agree or disagree.");
  const vote = await ctx.db.prepare(`SELECT * FROM removal_votes WHERE id = ?`).bind(voteId).first<Vote>();
  if (!vote) throw new HttpError(404, "not_found", "Vote not found.");
  if (vote.status !== "open") throw new HttpError(409, "closed", "This vote has finished.");
  await replaceSlowVoters(ctx, vote);
  const ballot = await ctx.db
    .prepare(`SELECT * FROM ballots WHERE vote_id = ? AND voter_id = ? AND replaced = 0`)
    .bind(voteId, actorId)
    .first<Ballot>();
  if (!ballot) throw new HttpError(403, "forbidden", "You were not chosen to vote on this link.");
  if (ballot.choice) throw new HttpError(409, "already_voted", "You have already voted.");
  await ctx.db
    .prepare(`UPDATE ballots SET choice = ?, responded_at = ? WHERE id = ?`)
    .bind(choice, iso(ctx), ballot.id)
    .run();
  await tally(ctx, vote);
  return getVote(ctx, voteId);
}

export async function votesForMe(ctx: Ctx, actorId: string) {
  const { results } = await ctx.db
    .prepare(
      `SELECT v.id FROM removal_votes v JOIN ballots b ON b.vote_id = v.id
       WHERE v.status = 'open' AND b.voter_id = ? AND b.replaced = 0 AND b.choice IS NULL`,
    )
    .bind(actorId)
    .all<{ id: string }>();
  const out = [];
  for (const { id } of results) {
    const v = await getVote(ctx, id);
    // The voter may have just been replaced for being slow.
    if (v.status === "open" && v.voters.includes(actorId)) {
      const a = await getPerson(ctx, v.relation!.a_id);
      const b = await getPerson(ctx, v.relation!.b_id);
      out.push({ ...v, a_name: a.full_name, b_name: b.full_name });
    }
  }
  return out;
}
