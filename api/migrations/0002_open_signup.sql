-- Open sign-up (agreed 2026-11-14): anyone can sign up without an invite.
-- A newcomer is not part of the tree until nearby relatives confirm them.

-- 1 = part of the one tree. 0 = a newcomer (and anyone they added) still
-- waiting for a relative to confirm them.
ALTER TABLE people ADD COLUMN in_tree INTEGER NOT NULL DEFAULT 1;

-- kind 'claim': "this profile is me" (target_id is the profile).
-- kind 'link':  "this person is my relative" (target_id is the relative,
--               relation_id the pending link between them).
CREATE TABLE join_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('claim', 'link')),
  requester_id TEXT NOT NULL REFERENCES people(id),
  target_id TEXT NOT NULL REFERENCES people(id),
  relation_id TEXT REFERENCES relations(id),
  status TEXT NOT NULL,              -- 'open' | 'approved' | 'rejected'
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX join_requests_requester ON join_requests(requester_id, status);
CREATE INDEX join_requests_target ON join_requests(target_id, status);

-- The relatives asked to confirm a request.
CREATE TABLE join_checks (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES join_requests(id),
  checker_id TEXT NOT NULL REFERENCES people(id),
  distance INTEGER NOT NULL,         -- steps from the target; 0 to 2 counts as close family
  choice TEXT,                       -- NULL (not answered) | 'yes' | 'no'
  assigned_at TEXT NOT NULL,
  responded_at TEXT
);
CREATE INDEX join_checks_request ON join_checks(request_id);
CREATE INDEX join_checks_checker ON join_checks(checker_id, choice);
