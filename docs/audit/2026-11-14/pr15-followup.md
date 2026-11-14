# PR #15 follow-up — 2026-11-14

This follows the WhatsApp review at 22:22 HKT and the PR #15 review report.

## Fixed

1. Approved content replacement:
   - transcript, segments, words, Q&A, media and other reviewed fields now return to `private` with `reviewStatus=ready`
   - the previous reviewer identity and timestamp are cleared
   - harmless metadata such as the recording icon remains separate and preserves publication
2. Privacy narrowing:
   - an owner can move a record to a narrower scope immediately
   - publication approval is cleared so a later widening still requires review
   - guest record, audio and catalogue access are removed
3. Reviewer queue:
   - admin sessions load `/api/contributions?status=submitted`
   - other contributors' submitted records appear in the Done tab as review-only cards
   - owner deletion, scope and withdrawal controls are not shown for those cards
4. Empty catalogue refresh:
   - a successful empty `/api/stories` response now clears the local story catalogue
5. Combined integration:
   - merged PR #14's English-retrieval fix into PR #15
   - corrected the English verification fixture to patch both corpus bindings

## Validation

- `tools/test_records_api.py`: 80/80
- `tools/test_contribution_flow.py`: all checks passed, including content replacement, harmless metadata edit, privacy narrowing, reviewer queue and public withdrawal regressions
- `tools/test_lab_api.py`: 48/48
- `tools/verify/database_bridge.py`: passed
- `tools/verify/supabase_storage.py`: passed
- `tools/verify/english_retrieval.py`: 20/20
- frontend build and syntax check: passed

All checks used temporary SQLite/audio data, synthetic identities and synthetic WAV data.

## Remaining

- Live Supabase CRUD, RLS, restart persistence and backup/restore remain unverified without staging credentials.
- Invited Google OIDC, private object storage and full browser acceptance remain outstanding.
- PR #15 remains a draft; no merge or deployment was performed.
