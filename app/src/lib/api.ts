// Talks to the One Family server (the Cloudflare Worker in /api).

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787").replace(/\/$/, "");
// The website address, used to build invite links people can open on any phone.
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? "http://localhost:8081").replace(/\/$/, "");

export type RelationType = "parent" | "spouse" | "sibling";
export type RelativeKind = "parent" | "child" | "sibling" | "spouse";

export interface TreePerson {
  id: string;
  full_name: string;
  is_living: number;
  has_account: boolean;
  can_edit: boolean;
  /** 0 while a newcomer waits for a relative to confirm them. */
  in_tree?: number;
  gender?: string | null;
  birth_year?: number | null;
  death_year?: number | null;
  birthplace?: string | null;
  country?: string | null;
  story?: string | null;
}

export interface Relation {
  id: string;
  type: RelationType;
  a_id: string;
  b_id: string;
  status: "active" | "pending" | "removed" | "rejected";
  approver_id: string | null;
  divorced: number;
  created_by: string | null;
}

export interface Tree {
  root: string;
  me: string;
  people: TreePerson[];
  relations: Relation[];
}

export interface PendingRelation extends Relation {
  a_name: string;
  b_name: string;
}

export interface Vote {
  id: string;
  status: "open" | "passed" | "failed";
  relation: Relation | null;
  voters: string[];
  agree: number;
  disagree: number;
  a_name?: string;
  b_name?: string;
}

/** A newcomer asking to join: "this profile is me" (claim) or "this person is my relative" (link). */
export interface JoinRequest {
  id: string;
  kind: "claim" | "link";
  requester_id: string;
  target_id: string;
  status: "open" | "approved" | "rejected";
  requester_name: string;
  requester_login: string | null;
  target_name: string;
  relation: Relation | null;
  checkers: number;
  yes: number;
  no: number;
  close: boolean;
}

export interface FoundPerson {
  id: string;
  full_name: string;
  birth_year: number | null;
  is_living: number;
  parents?: string[];
  has_account?: boolean;
}

export interface Me {
  person: TreePerson;
  pending: PendingRelation[];
  votes: Vote[];
  checks: JoinRequest[];
  requests: JoinRequest[];
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

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, token: string | null, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "offline", "Can't reach the server. Check your internet connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error", data.message ?? "Something went wrong.");
  return data as T;
}

export function api(token: string | null) {
  return {
    login: (login: string, password: string) =>
      request<{ personId: string; token: string }>("POST", "/login", null, { login, password }),
    logout: () => request("POST", "/logout", token),
    signUp: (person: PersonInput, login: string, password: string) =>
      request<{ personId: string; token: string }>("POST", "/signup", null, { person, login, password }),
    claim: (personId: string) => request<JoinRequest>("POST", "/claims", token, { person_id: personId }),
    answerRequest: (requestId: string, yes: boolean) =>
      request<JoinRequest>("POST", `/join-requests/${requestId}/answer`, token, { yes }),
    getInvite: (inviteToken: string) =>
      request<{ person: TreePerson; invitedBy: string }>("GET", `/invites/${inviteToken}`, null),
    acceptInvite: (inviteToken: string, login: string, password: string) =>
      request<{ personId: string; token: string }>("POST", `/invites/${inviteToken}/accept`, null, { login, password }),
    me: () => request<Me>("GET", "/me", token),
    tree: (root?: string, depth = 3) =>
      request<Tree>("GET", `/tree?depth=${depth}${root ? `&root=${encodeURIComponent(root)}` : ""}`, token),
    search: (q: string) =>
      request<FoundPerson[]>(
        "GET",
        `/search?q=${encodeURIComponent(q)}`,
        token,
      ),
    updatePerson: (id: string, input: Partial<PersonInput>) => request<TreePerson>("PATCH", `/people/${id}`, token, input),
    addRelative: (input: { kind: RelativeKind; of: string; person?: PersonInput; existingPersonId?: string; otherParentId?: string }) =>
      request<{ person: TreePerson; relations: Relation[]; request?: JoinRequest }>("POST", "/relatives", token, input),
    decide: (relationId: string, approve: boolean) =>
      request<Relation>("POST", `/relations/${relationId}/decision`, token, { approve }),
    setDivorced: (relationId: string, divorced: boolean) =>
      request<Relation>("POST", `/relations/${relationId}/divorced`, token, { divorced }),
    invite: (personId: string, contact?: string) =>
      request<{ token: string }>("POST", `/people/${personId}/invites`, token, { contact }),
    startRemovalVote: (relationId: string) => request<Vote>("POST", `/relations/${relationId}/removal-votes`, token),
    ballot: (voteId: string, choice: "agree" | "disagree") =>
      request<Vote>("POST", `/votes/${voteId}/ballot`, token, { choice }),
  };
}

export const inviteLink = (inviteToken: string) => `${WEB_URL}/invite/${inviteToken}`;
