# PR Review Integration Handoff — 2026-11-14

Source review: Dat, `PR_REVIEW_13_NOV.md`, delivered 2026-11-13 22:07 HKT.

Base: `a6b932a` (`origin/main`, 2026-11-13).

## Implemented

- R1 moderation bypass: new records are always private, client moderation fields are ignored, and generic updates preserve the stored moderation state.
- R2 publication/discovery: reviewer-approved records enter `/api/stories`, map-compatible visibility, Ask the Village retrieval and audio access.
- R3 read policy: approved public records use the stored review state; ordinary client-selected scope cannot grant public access.
- R4 metadata sync: submission acknowledgement patches suppress automatic resync, while stored submission/reviewer metadata survives ordinary metadata updates.
- R5 PostgreSQL schema: automatic schema and migration use `BIGINT`; startup widens existing PostgreSQL timestamp columns.
- R6 consent boundaries: a reviewer cannot broaden the contributor's requested sharing scope.
- R7 strict review input: `approved` must be a JSON boolean; string `"false"` is rejected.
- R8 withdrawal integration: approved records leave the catalogue and stop serving audio; retries preserve the first withdrawal timestamp on SQLite and PostgreSQL.
- Integration checks now use signed member identities rather than client-supplied visitor headers.

## Validation

- `python -m py_compile server.py lab_api.py storage.py`
- `python -X utf8 tools/test_records_api.py` — 80/80
- `python -X utf8 tools/test_contribution_flow.py` — contribution, publication, map, Ask, sync, scope and withdrawal checks passed
- `python -X utf8 tools/test_lab_api.py` — 48/48
- `python -X utf8 tools/verify/database_bridge.py` — passed
- `python -X utf8 tools/verify/supabase_storage.py` — passed
- `python -X utf8 tools/build_frontend.py` — bundled frontend rebuilt
- `python -X utf8 tools/check_frontend_syntax.py` — 1/1 script parsed

All checks use isolated SQLite, temporary audio, synthetic identities and synthetic WAV data.

## Still blocked

- No staging `DATABASE_URL` was available, so live Supabase CRUD, RLS, restart persistence and backup/restore were not exercised.
- Invited Google OIDC and private object storage remain external staging acceptance items.
- No merge or deployment was performed.
