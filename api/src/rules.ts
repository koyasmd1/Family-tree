// The family tree rules agreed with the project owner:
//
// 1. One single global tree. A member can add a relative and share an invite
//    link. Anyone can also sign up directly (changed 2026-11-14), but a
//    newcomer only becomes part of the tree once nearby relatives confirm
//    them: either "this profile is me" or "this person is my relative".
// 2. Parents and children are linked straight away, without approval.
// 3. Siblings and spouses must be approved by the other person. Sibling links
//    that appear because a new child joins parents who already have children
//    also need approval.
// 4. A wrong link is removed by a vote: 4 relatives are picked at random
//    (closest relatives first, then further out). 3 must agree. The two people
//    in the link can never vote. A voter who has not answered in 7 days is
//    replaced by another random relative. A vote removes only that one link.
//    Anyone in the tree who sees a wrong link can raise the objection.

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
  in_tree: number;
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

async function insertPerson(ctx: Ctx, input: PersonInput, createdBy: string | null, inTree?: boolean): Promise<Person> {
  const p = validatePerson(input);
  // Someone added by a newcomer waits outside the tree together with them.
  const in_tree = inTree !== undefined ? (inTree ? 1 : 0) : createdBy ? (await getPerson(ctx, createdBy)).in_tree : 1;
  const person: Person = { id: newId(), ...p, created_by: createdBy, created_at: iso(ctx), in_tree };
  await ctx.db
    .prepare(
      `INSERT INTO people (id, full_name, gender, birth_year, is_living, death_year, birthplace, country, story, created_by, created_at, in_tree)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      person.in_tree,
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
    const existing = await getPerson(ctx, input.existingPersonId);
    relativeId = existing.id;
    if (await existingLink(ctx, of, relativeId)) {
      throw new HttpError(409, "already_linked", "These two people are already linked.");
    }
    const from = await getPerson(ctx, of);
    if (from.in_tree === 0 && existing.in_tree === 1) {
      // A newcomer connecting to the tree: nearby relatives must confirm it.
      return requestLink(ctx, actorId, from, existing, kind);
    }
    if (from.in_tree === 1 && existing.in_tree === 0) {
      throw new HttpError(403, "not_confirmed", "This person has not been confirmed yet. They connect themselves to the tree first.");
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
  if ((await getPerson(ctx, actorId)).in_tree === 0) return findInTree(ctx, q);
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
  // Anyone in the tree who sees a wrong link can object; the vote decides.
  const actor = await getPerson(ctx, actorId);
  const reach = actor.in_tree === 1 ? await distancesFrom(ctx, [actorId], MAX_TREE_DEPTH * 2) : new Map();
  if (!reach.has(rel.a_id) && !reach.has(rel.b_id)) {
    throw new HttpError(403, "forbidden", "Only members connected to this family can object to a link.");
  }
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

// ---------- open sign-up: newcomers confirmed by nearby relatives ----------

export const CLOSE_FAMILY = 2; // parents, children, siblings, spouse, grandparents, grandchildren...
export const FAR_CHECKERS = 4; // when no close relative has joined, ask this many further out
export const FAR_YES_NEEDED = 2; // ...and this many must say yes
const MAX_CLOSE_CHECKERS = 6;
const MAX_OPEN_REQUESTS = 3;
const MAX_REQUESTS_PER_DAY = 5;

interface JoinRequest {
  id: string;
  kind: "claim" | "link";
  requester_id: string;
  target_id: string;
  relation_id: string | null;
  status: "open" | "approved" | "rejected";
  created_at: string;
  closed_at: string | null;
}

/** Sign up without an invite. The new member waits outside the tree until confirmed. */
export async function signUp(ctx: Ctx, person: PersonInput, loginValue: string, password: string) {
  const any = await ctx.db.prepare(`SELECT 1 AS x FROM people LIMIT 1`).first();
  if (!any) throw new HttpError(409, "not_started", "The tree has not been started yet.");
  const normalized = normalizeLogin(loginValue ?? "");
  const taken = await ctx.db.prepare(`SELECT 1 AS x FROM accounts WHERE login = ?`).bind(normalized).first();
  if (taken) throw new HttpError(409, "login_taken", "This email or phone number is already used.");
  const p = await insertPerson(ctx, { ...person, is_living: true }, null, false);
  const accountId = await createAccount(ctx, p.id, loginValue, password);
  return { personId: p.id, token: await createSession(ctx, accountId) };
}

/** Show only part of an email or phone number, enough for a relative to recognise it. */
export function maskLogin(login: string): string {
  if (login.includes("@")) {
    const [name, domain] = login.split("@");
    return `${name.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(6, name.length - 2)))}@${domain}`;
  }
  if (login.length <= 7) return login.slice(0, 2) + "•".repeat(Math.max(0, login.length - 2));
  return `${login.slice(0, 5)}${"•".repeat(login.length - 9)}${login.slice(-4)}`;
}

/** Find profiles in the tree by name, for a newcomer looking for themselves or a relative. */
async function findInTree(ctx: Ctx, q: string) {
  const { results } = await ctx.db
    .prepare(
      `SELECT id, full_name, birth_year, is_living FROM people
       WHERE in_tree = 1 AND full_name LIKE ? ORDER BY full_name LIMIT 20`,
    )
    .bind(`%${q.replace(/[%_]/g, "")}%`)
    .all<{ id: string; full_name: string; birth_year: number | null; is_living: number }>();
  const out = [];
  for (const p of results) {
    // Only a little is shown: name, birth year, parents' names, and whether they joined.
    const parents = [];
    for (const id of await parentsOf(ctx, p.id)) parents.push((await getPerson(ctx, id)).full_name);
    out.push({ ...p, parents, has_account: await hasAccount(ctx, p.id) });
  }
  return out;
}

async function checkRequestLimits(ctx: Ctx, requester: Person) {
  if (requester.in_tree === 1) throw new HttpError(409, "already_in_tree", "You are already part of the tree.");
  const open = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM join_requests WHERE requester_id = ? AND status = 'open'`)
    .bind(requester.id)
    .first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_REQUESTS) {
    throw new HttpError(429, "too_many_requests", `You can have ${MAX_OPEN_REQUESTS} requests waiting at a time.`);
  }
  const since = new Date(ctx.now().getTime() - 86400_000).toISOString();
  const today = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM join_requests WHERE requester_id = ? AND created_at > ?`)
    .bind(requester.id, since)
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= MAX_REQUESTS_PER_DAY) {
    throw new HttpError(429, "too_many_requests", `You can send ${MAX_REQUESTS_PER_DAY} requests a day. Please try again tomorrow.`);
  }
}

/**
 * The relatives who confirm a newcomer: every member within 2 steps of the
 * target (close family), or if none has joined, the 4 nearest members further out.
 */
async function pickCheckers(ctx: Ctx, targetId: string, requesterId: string) {
  const dist = await distancesFrom(ctx, [targetId], MAX_TREE_DEPTH * 2);
  const members: { id: string; d: number }[] = [];
  for (const [id, d] of dist) {
    if (id === requesterId) continue;
    const p = await getPerson(ctx, id);
    if (p.is_living !== 1 || p.in_tree !== 1 || !(await hasAccount(ctx, id))) continue;
    members.push({ id, d });
  }
  // Whoever added the profile knows who it is for, even if their own link to it
  // (a brother or sister, say) is still waiting for approval.
  const target = await getPerson(ctx, targetId);
  const adder = target.created_by;
  if (adder && adder !== requesterId && !members.some((m) => m.id === adder)) {
    const p = await getPerson(ctx, adder);
    if (p.is_living === 1 && p.in_tree === 1 && (await hasAccount(ctx, adder)) && (await existingLink(ctx, adder, targetId))) {
      members.push({ id: adder, d: 1 });
    }
  }
  members.sort((x, y) => x.d - y.d);
  const close = members.filter((m) => m.d <= CLOSE_FAMILY);
  if (close.length) return shuffle(close, ctx.random).slice(0, MAX_CLOSE_CHECKERS);
  return members.slice(0, FAR_CHECKERS);
}

async function openRequest(ctx: Ctx, kind: "claim" | "link", requesterId: string, targetId: string, relationId: string | null) {
  const checkers = await pickCheckers(ctx, targetId, requesterId);
  if (checkers.length === 0) {
    throw new HttpError(409, "no_relatives", "None of this person's relatives has joined yet, so nobody can confirm you. Try another relative.");
  }
  const id = newId();
  await ctx.db
    .prepare(`INSERT INTO join_requests (id, kind, requester_id, target_id, relation_id, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`)
    .bind(id, kind, requesterId, targetId, relationId, iso(ctx))
    .run();
  for (const c of checkers) {
    await ctx.db
      .prepare(`INSERT INTO join_checks (id, request_id, checker_id, distance, assigned_at) VALUES (?, ?, ?, ?, ?)`)
      .bind(newId(), id, c.id, c.d, iso(ctx))
      .run();
  }
  return describeRequest(ctx, id);
}

/** "This profile is me": a newcomer claims a profile a relative added for them. */
export async function claimProfile(ctx: Ctx, actorId: string, targetId: string) {
  const me = await getPerson(ctx, actorId);
  await checkRequestLimits(ctx, me);
  const target = await getPerson(ctx, targetId);
  if (target.in_tree !== 1) throw new HttpError(404, "not_found", "Person not found.");
  if (target.is_living !== 1) throw new HttpError(400, "bad_input", "A profile of someone who passed away can't be claimed.");
  if (await hasAccount(ctx, targetId)) throw new HttpError(409, "already_member", "This person has already joined.");
  if ((await relationsOf(ctx, actorId, ["active", "pending"])).length) {
    throw new HttpError(409, "has_relatives", "Claim your profile before adding relatives, so they are not added twice.");
  }
  const taken = await ctx.db
    .prepare(`SELECT 1 AS x FROM join_requests WHERE kind = 'claim' AND target_id = ? AND status = 'open'`)
    .bind(targetId)
    .first();
  if (taken) throw new HttpError(409, "claim_open", "Someone has already asked to claim this profile. Their relatives are checking it.");
  return openRequest(ctx, "claim", actorId, targetId, null);
}

/** "This person is my relative": a newcomer connects to someone already in the tree. */
async function requestLink(ctx: Ctx, actorId: string, from: Person, existing: Person, kind: RelativeKind) {
  const me = await getPerson(ctx, actorId);
  await checkRequestLimits(ctx, me);
  if (kind === "parent" && (await parentsOf(ctx, from.id)).length >= 2) {
    throw new HttpError(409, "too_many_parents", "This person already has two parents.");
  }
  if (kind === "child" && (await parentsOf(ctx, existing.id)).length >= 2) {
    throw new HttpError(409, "too_many_parents", "This person already has two parents.");
  }
  const rel = await insertRelation(ctx, {
    type: kind === "child" || kind === "parent" ? "parent" : kind,
    a_id: kind === "parent" ? existing.id : from.id,
    b_id: kind === "parent" ? from.id : existing.id,
    status: "pending",
    approver_id: null, // confirmed by the relatives in join_checks
    created_by: actorId,
  });
  try {
    const request = await openRequest(ctx, "link", actorId, existing.id, rel.id);
    return { person: existing, relations: [rel], request };
  } catch (e) {
    await ctx.db.prepare(`UPDATE relations SET status = 'rejected', decided_at = ? WHERE id = ?`).bind(iso(ctx), rel.id).run();
    throw e;
  }
}

async function describeRequest(ctx: Ctx, requestId: string) {
  const r = await ctx.db.prepare(`SELECT * FROM join_requests WHERE id = ?`).bind(requestId).first<JoinRequest>();
  if (!r) throw new HttpError(404, "not_found", "Request not found.");
  const { results: checks } = await ctx.db
    .prepare(`SELECT checker_id, distance, choice FROM join_checks WHERE request_id = ?`)
    .bind(requestId)
    .all<{ checker_id: string; distance: number; choice: string | null }>();
  const requester = await getPerson(ctx, r.requester_id);
  const target = await getPerson(ctx, r.target_id);
  const relation = r.relation_id
    ? await ctx.db.prepare(`SELECT * FROM relations WHERE id = ?`).bind(r.relation_id).first<Relation>()
    : null;
  const account = await ctx.db
    .prepare(`SELECT login FROM accounts WHERE person_id = ?`)
    .bind(r.status === "approved" && r.kind === "claim" ? r.target_id : r.requester_id)
    .first<{ login: string }>();
  return {
    ...r,
    requester_name: requester.full_name,
    requester_login: account ? maskLogin(account.login) : null,
    target_name: target.full_name,
    relation,
    checkers: checks.length,
    yes: checks.filter((c) => c.choice === "yes").length,
    no: checks.filter((c) => c.choice === "no").length,
    close: checks.some((c) => c.distance <= CLOSE_FAMILY),
  };
}

/** Requests waiting for this member to confirm or refuse. */
export async function checksForMe(ctx: Ctx, actorId: string) {
  const { results } = await ctx.db
    .prepare(
      `SELECT r.id FROM join_requests r JOIN join_checks c ON c.request_id = r.id
       WHERE r.status = 'open' AND c.checker_id = ? AND c.choice IS NULL ORDER BY r.created_at`,
    )
    .bind(actorId)
    .all<{ id: string }>();
  const out = [];
  for (const { id } of results) out.push(await describeRequest(ctx, id));
  return out;
}

/** A newcomer's own requests, so they can see what they are waiting for. */
export async function myRequests(ctx: Ctx, actorId: string) {
  const { results } = await ctx.db
    .prepare(`SELECT id FROM join_requests WHERE requester_id = ? ORDER BY created_at DESC LIMIT 10`)
    .bind(actorId)
    .all<{ id: string }>();
  const out = [];
  for (const { id } of results) out.push(await describeRequest(ctx, id));
  return out;
}

/**
 * A relative answers. With close family asked, the first answer decides.
 * Otherwise 2 of the (up to 4) relatives further out must say yes.
 */
export async function answerRequest(ctx: Ctx, actorId: string, requestId: string, yes: boolean) {
  const r = await ctx.db.prepare(`SELECT * FROM join_requests WHERE id = ?`).bind(requestId).first<JoinRequest>();
  if (!r) throw new HttpError(404, "not_found", "Request not found.");
  if (r.status !== "open") throw new HttpError(409, "closed", "This request has already been decided.");
  const check = await ctx.db
    .prepare(`SELECT * FROM join_checks WHERE request_id = ? AND checker_id = ?`)
    .bind(requestId, actorId)
    .first<{ id: string; distance: number; choice: string | null }>();
  if (!check) throw new HttpError(403, "forbidden", "You were not asked to confirm this person.");
  if (check.choice) throw new HttpError(409, "already_answered", "You have already answered.");
  await ctx.db
    .prepare(`UPDATE join_checks SET choice = ?, responded_at = ? WHERE id = ?`)
    .bind(yes ? "yes" : "no", iso(ctx), check.id)
    .run();

  const { results: checks } = await ctx.db
    .prepare(`SELECT distance, choice FROM join_checks WHERE request_id = ?`)
    .bind(requestId)
    .all<{ distance: number; choice: string | null }>();
  const close = checks.some((c) => c.distance <= CLOSE_FAMILY);
  const yesCount = checks.filter((c) => c.choice === "yes").length;
  const noCount = checks.filter((c) => c.choice === "no").length;
  let outcome: "approved" | "rejected" | null = null;
  if (close) outcome = yes ? "approved" : "rejected";
  else {
    // Two must say yes, or every one of them when fewer than two could be asked.
    const needed = Math.min(FAR_YES_NEEDED, checks.length);
    if (yesCount >= needed) outcome = "approved";
    else if (noCount > checks.length - needed) outcome = "rejected";
  }

  if (outcome) await closeRequest(ctx, r, outcome);
  return describeRequest(ctx, requestId);
}

async function closeRequest(ctx: Ctx, r: JoinRequest, outcome: "approved" | "rejected") {
  await ctx.db.prepare(`UPDATE join_requests SET status = ?, closed_at = ? WHERE id = ?`).bind(outcome, iso(ctx), r.id).run();
  if (r.kind === "link") {
    await ctx.db
      .prepare(`UPDATE relations SET status = ?, decided_at = ? WHERE id = ?`)
      .bind(outcome === "approved" ? "active" : "rejected", iso(ctx), r.relation_id)
      .run();
    if (outcome === "approved") {
      await bringIntoTree(ctx, r.requester_id);
      const rel = (await ctx.db.prepare(`SELECT * FROM relations WHERE id = ?`).bind(r.relation_id).first<Relation>())!;
      if (rel.type === "parent") await linkImpliedSiblings(ctx, r.requester_id, rel.a_id, rel.b_id);
    }
    return;
  }
  if (outcome !== "approved") return;
  // A claim: the newcomer's login moves onto the profile their relatives made,
  // and the empty sign-up profile is removed.
  if (await hasAccount(ctx, r.target_id)) {
    await ctx.db.prepare(`UPDATE join_requests SET status = 'rejected' WHERE id = ?`).bind(r.id).run();
    return;
  }
  const temp = await getPerson(ctx, r.requester_id);
  const target = await getPerson(ctx, r.target_id);
  await ctx.db.prepare(`UPDATE accounts SET person_id = ? WHERE person_id = ?`).bind(r.target_id, r.requester_id).run();
  await ctx.db
    .prepare(`UPDATE people SET gender = COALESCE(gender, ?), birth_year = COALESCE(birth_year, ?) WHERE id = ?`)
    .bind(temp.gender, temp.birth_year, target.id)
    .run();
  // Other requests the newcomer had waiting are no longer needed.
  const { results: others } = await ctx.db
    .prepare(`SELECT * FROM join_requests WHERE requester_id = ? AND status = 'open' AND id != ?`)
    .bind(r.requester_id, r.id)
    .all<JoinRequest>();
  for (const o of others) {
    await ctx.db.prepare(`UPDATE join_requests SET status = 'rejected', closed_at = ? WHERE id = ?`).bind(iso(ctx), o.id).run();
    if (o.relation_id) await ctx.db.prepare(`UPDATE relations SET status = 'rejected' WHERE id = ?`).bind(o.relation_id).run();
  }
  await ctx.db.prepare(`UPDATE join_requests SET requester_id = ? WHERE requester_id = ?`).bind(r.target_id, r.requester_id).run();
  await ctx.db.prepare(`UPDATE relations SET created_by = ? WHERE created_by = ?`).bind(r.target_id, r.requester_id).run();
  await ctx.db.prepare(`DELETE FROM people WHERE id = ?`).bind(r.requester_id).run();
}

/** Once confirmed, the newcomer and everyone they added become part of the tree. */
async function bringIntoTree(ctx: Ctx, personId: string) {
  const seen = new Set([personId]);
  const queue = [personId];
  while (queue.length) {
    const id = queue.shift()!;
    await ctx.db.prepare(`UPDATE people SET in_tree = 1 WHERE id = ?`).bind(id).run();
    for (const r of await relationsOf(ctx, id, ["active", "pending"])) {
      for (const other of [r.a_id, r.b_id]) {
        if (seen.has(other)) continue;
        seen.add(other);
        if ((await getPerson(ctx, other)).in_tree === 0) queue.push(other);
      }
    }
  }
}
