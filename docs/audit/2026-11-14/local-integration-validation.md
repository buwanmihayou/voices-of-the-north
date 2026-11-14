# Local integration validation — 2026-11-14

## Source and result

Validated the canonical repository on `codex/local-integration-20261114`, starting at `92f34235133a2736da2d6f6b1bbb4f4813064dca`, which combines main `a6b932a`, PR #15 `a53dcc9`, and PR #14 `32b5f98`. The final English-suite run also includes the fixture compatibility correction described below. A subsequent commit may package this report and that correction without changing application behavior.

**229 automated checks pass. Two additional P1 probes still reproduce publication/privacy defects. This integration is not ready for release.**

## Executed checks

| Command | Actual result |
| --- | --- |
| `python -X utf8 tools/test_records_api.py` | 80 passed; exit 0 |
| `python -X utf8 tools/test_contribution_flow.py` | 46 passed; exit 0 |
| `python -X utf8 tools/test_lab_api.py` | 48 passed; exit 0 |
| `python -X utf8 tools/verify/database_bridge.py` | 23 passed; exit 0 |
| `python -X utf8 tools/verify/supabase_storage.py` | 12 passed; exit 0 |
| `python -X utf8 tools/verify/english_retrieval.py` | 20 passed after fixture correction; exit 0 |
| `python -m py_compile server.py lab_api.py storage.py` | Exit 0 |
| `python -X utf8 tools/check_frontend_syntax.py` | 1/1 script blocks parsed; exit 0 |

The bundled frontend was rebuilt before these tests. The checked bundle was byte-identical to the integration commit's version, and the English suite verified that its embedded corpus and assistant module match the current source files.

The initial English-suite run passed seven checks and then failed at its unauthorized-story fixture. Integration changed the API's corpus lookup to the imported `server.all_stories` binding, while the test patched only `story_corpus.all_stories`. Consequently, the API still received the genuine authorized YL-001 story. The fixture was corrected to patch both bindings; all 20 checks then passed. The failure came from the test hook targeting the old lookup path. The five integration suites were executed once against the combined source.

The English, Cantonese and uppercase example questions now return only YL-001's original first transcript segment, with a 00:00 source, in both the API and the real offline assistant JavaScript. Scope exclusions and unsupported generic questions continue to refuse. The offline test supplies the upstream visible-corpus contract through mocks; it is not a browser authorization acceptance test.

## Isolation

Each test child process removed `DATABASE_URL`, `SUPABASE_DB_URL`, `VTN_DATABASE_URL`, and `GEMINI_API_KEY`. `VTN_ENV_FILE` pointed to a nonexistent temporary file, `VTN_DATABASE_REQUIRED=0` selected local fallback, and database/audio/data paths used temporary directories. `VTN_STORY_DATA` explicitly referenced the repository's corpus. Google credentials pointed to a nonexistent temporary file to prevent credential discovery; STT/LLM services were not invoked. Tests and probes used synthetic accounts and synthetic WAV data.

No live Supabase connection, production data mutation, external comment, merge, or deployment was performed during this validation.

## Additional P1 probes on the combined source

Both probes used `fastapi.testclient.TestClient`, a temporary SQLite database, synthetic signed member/admin logins, and one-second synthetic WAV files. The probes were executed as inline Python; no additional implementation or permanent test script was added.

### Approved public content can be replaced without renewed review

1. Owner creates a completed contribution with current consent and transcript/audio through `POST /api/records`.
2. Owner submits through `POST /api/contributions/{id}/submit` with `transcriptConfirmed:true`, `requestedScope:"public"`, and the current policy version.
3. Admin approves through `POST /api/contributions/{id}/review` with `approved:true`, `approvedScope:"public"`.
4. Owner sends `POST /api/records` with the same ID and different title, transcript, segment text/keywords and audio bytes. The new segment keyword is `reviewescape`.
5. Guest reads the record, audio, catalogue and Ask result.

Actual responses on the combined branch:

```json
{
  "post": 200,
  "scope": "public",
  "reviewStatus": "approved",
  "old_review_retained": true,
  "guest_get": 200,
  "guest_new_text": true,
  "guest_audio": 200,
  "guest_new_audio": true,
  "catalog_new_text": true,
  "ask_inScope": true,
  "ask_new_text": true,
  "ask_citation_start": 0.0
}
```

`old_review_retained` compares both reviewer identity and review timestamp. Guest audio was compared byte-for-byte with the replacement WAV. Ask used `question:"reviewescape"` and `storyIds:[id]`. Generic record sync preserves approval fields while accepting changed content/audio; the existing preapproval resync test does not cover this transition.

### Privacy narrowing returns success while the record remains public

1. Create, submit and approve a separate public contribution as above.
2. Owner sends `POST /api/records` for that same ID with `scope:"private"` and `requestedScope:"private"`.
3. Guest requests the record, audio and catalogue.

Actual responses:

```json
{
  "requested_scope": "private",
  "post": 200,
  "returned_scope": "public",
  "returned_requestedScope": "public",
  "reviewStatus": "approved",
  "guest_get": 200,
  "guest_audio": 200,
  "in_guest_catalog": true
}
```

The backend restores the previous public scope during generic sync. These passing suites therefore do not establish that an owner's privacy change is applied to published records.

## Remaining acceptance limits

- Both P1 publication/privacy defects remain reproducible and need fixes with regression coverage.
- The supplied Supabase verification exercises SQLite fallback and source/schema markers. Live PostgreSQL CRUD, RLS behavior, restart persistence, migrations against an existing database, and backup/restore remain unverified.
- Invited Google OIDC, private object storage, reviewer browser workflow, and phone/browser acceptance were not validated here.
- This report establishes local integration results, not deployed behavior or production readiness.
