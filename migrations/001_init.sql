-- migrations/001_init.sql
-- Idempotent: safe to run every time the server boots.

CREATE TABLE IF NOT EXISTS scribes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  model       TEXT NOT NULL,
  rating      DOUBLE PRECISION NOT NULL DEFAULT 1500,
  wins        INTEGER NOT NULL DEFAULT 0,
  losses      INTEGER NOT NULL DEFAULT 0,
  ties        INTEGER NOT NULL DEFAULT 0,
  matches     INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per judged duel. Not used for the leaderboard yet, but this is exactly
-- the raw data a future Bradley-Terry / confidence-interval model needs, so we
-- capture it now rather than losing history while we're still on Elo.
CREATE TABLE IF NOT EXISTS battles (
  id          BIGSERIAL PRIMARY KEY,
  a_id        TEXT NOT NULL,
  b_id        TEXT NOT NULL,
  result      TEXT NOT NULL CHECK (result IN ('A','B','tie')),
  prompt      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_battles_created_at ON battles (created_at);
CREATE INDEX IF NOT EXISTS idx_battles_pair ON battles (a_id, b_id);
