-- Voices of the North: Supabase PostgreSQL schema.
-- Run through Supabase SQL Editor or automatically on backend startup.

CREATE TABLE IF NOT EXISTS records (
    id TEXT PRIMARY KEY,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    status TEXT,
    source TEXT,
    has_audio INTEGER NOT NULL DEFAULT 0,
    audio_path TEXT,
    data_json TEXT NOT NULL,
    owner TEXT DEFAULT '',
    scope TEXT DEFAULT 'private'
);
CREATE TABLE IF NOT EXISTS deletion_events (
    log_id TEXT PRIMARY KEY,
    record_id TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    audio_removed INTEGER NOT NULL,
    text_removed INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_codes (
    email TEXT PRIMARY KEY,
    code_hash TEXT NOT NULL,
    expires_at DOUBLE PRECISION NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at DOUBLE PRECISION NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    email TEXT PRIMARY KEY,
    name TEXT,
    school TEXT,
    role TEXT,
    created_at TEXT
);
CREATE TABLE IF NOT EXISTS corrections (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    target_kind TEXT,
    field TEXT,
    current_text TEXT,
    proposed_text TEXT,
    reason TEXT,
    status TEXT NOT NULL,
    submitted_by TEXT,
    submitted_at TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    new_version INTEGER
);
CREATE TABLE IF NOT EXISTS story_versions (
    row_id BIGSERIAL PRIMARY KEY,
    story_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    formal_text TEXT,
    previous_text TEXT,
    reason TEXT,
    approved_by TEXT,
    approved_at TEXT
);
CREATE TABLE IF NOT EXISTS withdrawals (
    story_id TEXT PRIMARY KEY,
    withdrawn_at TEXT,
    by_user TEXT,
    reason TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
    log_id TEXT PRIMARY KEY,
    at TEXT,
    action TEXT,
    actor TEXT,
    role TEXT,
    meta_json TEXT
);
CREATE TABLE IF NOT EXISTS consent_log (
    id TEXT PRIMARY KEY,
    at TEXT,
    action TEXT,
    target_id TEXT,
    actor TEXT,
    policy_version TEXT,
    detail_json TEXT
);
CREATE TABLE IF NOT EXISTS card_selections (
    id TEXT PRIMARY KEY,
    card_id TEXT NOT NULL,
    village TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS metadata_reviews (
    record_id TEXT PRIMARY KEY,
    suggested_json TEXT NOT NULL,
    confirmed_json TEXT,
    status TEXT NOT NULL,
    classifier TEXT NOT NULL,
    reviewer TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    village TEXT NOT NULL,
    question TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    answer_record_id TEXT,
    answer_timestamp DOUBLE PRECISION,
    answer_citation TEXT,
    answered_at TEXT
);

CREATE INDEX IF NOT EXISTS records_owner_scope_idx ON records (owner, scope);
CREATE INDEX IF NOT EXISTS records_created_at_idx ON records (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX IF NOT EXISTS consent_log_at_idx ON consent_log (at DESC);
CREATE INDEX IF NOT EXISTS corrections_status_idx ON corrections (status);
CREATE INDEX IF NOT EXISTS questions_status_idx ON questions (status, created_at DESC);

-- The browser only uses FastAPI. Direct anon Data API access remains denied.
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE card_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE questions ENABLE ROW LEVEL SECURITY;
