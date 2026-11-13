-- One global family tree. Every person is a node; relations are edges.

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  gender TEXT,                       -- 'male' | 'female' | 'other' | NULL
  birth_year INTEGER,
  is_living INTEGER NOT NULL DEFAULT 1,
  death_year INTEGER,
  birthplace TEXT,
  country TEXT,
  story TEXT,
  created_by TEXT,                   -- person id of the member who added them (NULL for the starter)
  created_at TEXT NOT NULL
);

-- A login belongs to exactly one person. People without an account
-- (babies, relatives who passed away) are plain profiles.
CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL UNIQUE REFERENCES people(id),
  login TEXT NOT NULL UNIQUE,        -- email or phone number, lower-cased
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- type 'parent': a_id is the parent of b_id.
-- type 'spouse' / 'sibling': symmetric.
-- status: 'active' | 'pending' (waiting for approver_id) | 'removed' | 'rejected'
CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('parent', 'spouse', 'sibling')),
  a_id TEXT NOT NULL REFERENCES people(id),
  b_id TEXT NOT NULL REFERENCES people(id),
  status TEXT NOT NULL,
  approver_id TEXT REFERENCES people(id),
  divorced INTEGER NOT NULL DEFAULT 0,
  created_by TEXT REFERENCES people(id),
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX relations_a ON relations(a_id, status);
CREATE INDEX relations_b ON relations(b_id, status);
CREATE INDEX relations_approver ON relations(approver_id, status);

-- Joining is invite-only: a member creates a link for a relative's profile.
CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  contact TEXT,                      -- phone or email the inviter typed, for their own reference
  created_by TEXT NOT NULL REFERENCES people(id),
  created_at TEXT NOT NULL,
  used_at TEXT
);

-- Removing a wrong link: 4 random relatives vote, 3 must agree.
CREATE TABLE removal_votes (
  id TEXT PRIMARY KEY,
  relation_id TEXT NOT NULL REFERENCES relations(id),
  requested_by TEXT NOT NULL REFERENCES people(id),
  status TEXT NOT NULL,              -- 'open' | 'passed' | 'failed'
  created_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE ballots (
  id TEXT PRIMARY KEY,
  vote_id TEXT NOT NULL REFERENCES removal_votes(id),
  voter_id TEXT NOT NULL REFERENCES people(id),
  choice TEXT,                       -- NULL (not answered) | 'agree' | 'disagree'
  assigned_at TEXT NOT NULL,
  responded_at TEXT,
  replaced INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX ballots_vote ON ballots(vote_id);
CREATE INDEX ballots_voter ON ballots(voter_id);
