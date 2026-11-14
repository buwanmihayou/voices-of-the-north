# PR #15 integration review — November 14, 2026

The supplied suites pass, but this candidate still permits unreviewed changes to published content and can report a recording as private while it remains public. Keep these findings open through integration and staging acceptance.

## Reviewed revisions

- [PR #15](https://github.com/phatdat220707/voices-of-the-north/pull/15): `a53dcc910171c160ae8b388f56d96d1ba0544eae`, branch `BorisLau:codex/integration-review-20261114`, based on main `a6b932aaf90bb583f8d379d420925f9e16e92dec`.
- [PR #14](https://github.com/phatdat220707/voices-of-the-north/pull/14): `32b5f9800ccf5c0f066582f9de3dead71b845e80`, including English-retrieval evidence. This was a separate draft when checked; its alias is absent from PR #15's tested corpus.
- Both remote heads were rechecked before writing this report and had not changed. Both PRs remained open drafts.

The results below apply to the exact PR #15 head above, before combining it with PR #14. They do not establish correctness of a later local integration commit or a subsequently revised remote head. Rebuild the generated HTML and repeat the relevant checks on any combined candidate.

## Existing suite results

An independent local run against the PR #15 head passed all **209 supplied assertions**:

| Command | Result |
| --- | --- |
| `python -X utf8 tools/test_records_api.py` | 80 passed |
| `python -X utf8 tools/test_contribution_flow.py` | 46 passed |
| `python -X utf8 tools/test_lab_api.py` | 48 passed |
| `python -X utf8 tools/verify/database_bridge.py` | 23 passed |
| `python -X utf8 tools/verify/supabase_storage.py` | 12 passed |

`python -m py_compile server.py lab_api.py storage.py` exited successfully. The frontend build validated 14 stories and completed; the bundled JavaScript syntax check passed 1/1.

These checks used temporary SQLite/audio storage, synthetic signed identities and synthetic WAV data. They do not exercise a live PostgreSQL/Supabase connection. The targeted probes below expose cases missing from those passing suites. GitHub had no check runs, status entries or submitted reviews for `a53dcc9` when inspected; local suite results should not be described as CI approval.

## P1 — Published content can change without renewed review

[Existing-record updates in `server.py`](https://github.com/BorisLau/voices-of-the-north-techathon/blob/a53dcc910171c160ae8b388f56d96d1ba0544eae/server.py#L735) preserve the stored `scope`, `reviewStatus` and reviewer fields, while the incoming payload replaces the transcript/segments and [can replace the audio](https://github.com/BorisLau/voices-of-the-north-techathon/blob/a53dcc910171c160ae8b388f56d96d1ba0544eae/server.py#L758). Approval therefore survives a change to the content being approved.

Reproduction, using the synthetic owner/reviewer setup and WAV helper in `tools/test_contribution_flow.py`:

1. As a signed owner, create a completed private record with current `consentRef`, transcript, timestamped segment and synthetic WAV.
2. Submit it with `transcriptConfirmed: true`, current `policyVersion` and `requestedScope: "public"`.
3. As a signed reviewer, approve it with `approved: true` and `approvedScope: "public"`.
4. As the owner, POST the same record ID to `/api/records`, replacing the transcript, segment text/keywords and WAV. Use the unique keyword `reviewescape` in the replacement segment.
5. Without another review, read the record, audio and `/api/stories` as a guest. Ask `/api/ask-village` for `reviewescape`, restricted to that record ID.

Observed: the owner update returned 200 and retained `public`, `approved`, `reviewedAt` and `reviewedBy`. Guest record/audio requests returned 200; the audio matched the replacement bytes. The catalog contained the replacement segment, and Ask returned the replacement text with that record's 00:00 citation.

Required behavior: preserve a reviewed content version, or return changed publishable content to private/pending review. A generic metadata sync must not silently replace the approved transcript or media. Add a regression that repeats the guest catalog, retrieval and byte-level audio checks after an owner edit.

## P1 — Owner privacy narrowing leaves the server public

The same [scope-preservation block](https://github.com/BorisLau/voices-of-the-north-techathon/blob/a53dcc910171c160ae8b388f56d96d1ba0544eae/server.py#L737) also ignores legitimate narrowing. The frontend [changes local scope](https://github.com/BorisLau/voices-of-the-north-techathon/blob/a53dcc910171c160ae8b388f56d96d1ba0544eae/frontend/src/js/10-store.js#L400), while [sync success handling](https://github.com/BorisLau/voices-of-the-north-techathon/blob/a53dcc910171c160ae8b388f56d96d1ba0544eae/frontend/src/js/15-api.js#L156) updates sync/audio fields without applying the server's canonical scope.

Reproduction:

1. Create, submit and approve a separate public synthetic record as above.
2. As its owner, POST an update for the same ID with `scope: "private"` and `requestedScope: "private"`.
3. Inspect the response, then request its text, audio and catalog entry as a guest.

Observed: the update returned 200 with stored scope/requested scope still public and review status still approved. Guest text/audio requests still returned 200 and the catalog entry remained visible.

A separate Node VM harness executed the actual `10-store.js` and `15-api.js` modules with localStorage/network stubs. With a successful response retaining public scope, it observed:

```json
{"sentScope":"private","responseScope":"public","localStoredScope":"private","displayedScope":"private","sync":"synced"}
```

This establishes the frontend state mismatch without a full browser run; the backend retention was independently reproduced with actual API requests. Provide an owner narrowing/unpublish operation, preserve protection against unauthorized widening, and apply canonical returned state. Regression coverage must check both the displayed status and guest text/audio/catalog/retrieval access.

## P2 — Reviewer queue is unreachable for another contributor

[`renderAll()`](https://github.com/BorisLau/voices-of-the-north-techathon/blob/a53dcc910171c160ae8b388f56d96d1ba0544eae/frontend/src/js/45-recordings.js#L543) takes records from `store.records.list()`. That list [always filters through owner equality](https://github.com/BorisLau/voices-of-the-north-techathon/blob/a53dcc910171c160ae8b388f56d96d1ba0544eae/frontend/src/js/10-store.js#L236), including for reviewers. Approve/reject controls only appear for submitted records that survive this filter. The exposed `api.contributions.list()` is not called by the frontend.

An actual-store Node VM harness set an admin session and merged another contributor's submitted record. It observed:

```json
{"role":"admin","all":["CON-A"],"renderAllInput":[]}
```

Provide a reviewer queue backed by `/api/contributions`, without broadening ordinary owners' record lists. Verify in separate contributor and reviewer browser sessions that the submitted item appears and can be approved/rejected. The harness establishes the store/render input problem; it does not replace that browser acceptance.

## Source-only follow-up — Empty catalog refresh

The newly added [`refreshFromServer()`](https://github.com/BorisLau/voices-of-the-north-techathon/blob/a53dcc910171c160ae8b388f56d96d1ba0544eae/frontend/src/js/30-stories.js#L1403) rejects a successful empty array and keeps the previous corpus. A valid `[]` response should clear the map/local retrieval corpus. This observation is from source review; the full browser withdrawal/cache flow was not exercised. Add a test with a previously loaded story followed by an empty successful catalog response.

## Earlier conflicts and acceptance limits

PR #15 materially addresses the three earlier source incompatibilities: public reads require stored public approval and approved records enter the catalog/Ask; withdrawal uses portable `ON CONFLICT DO NOTHING` with first-timestamp preservation and backend-neutral failure handling; bridge/storage fixtures now obtain signed member tokens. Those improvements do not resolve the findings above.

Live Supabase CRUD, RLS, restart persistence and backup/restore remain unverified. Invited Google OIDC, private object storage, real STT, and the complete browser/offline withdrawal flow also require staging acceptance. The pending integration must include PR #14's alias, regenerate the bundled frontend, and rerun its 20 English-retrieval checks alongside the relevant integration suites and new regressions.

Status: two P1 lifecycle/privacy findings and the reviewer UI work remain open; staging acceptance is outstanding.
