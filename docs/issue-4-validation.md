# Issue #4 validation

## Automated checks

Run from the repository root on Windows:

```powershell
python -X utf8 tools/test_contribution_flow.py
python -X utf8 tools/test_lab_api.py
python -X utf8 tools/build_frontend.py
python -X utf8 tools/check_frontend_syntax.py
```

The contribution test creates a temporary SQLite database and synthetic WAV,
then verifies:

- client-requested public scope is forced to private at creation;
- owner-only transcript and audio access while pending;
- guest and second-contributor isolation;
- transcript and current consent-policy checks;
- reviewer-only queue, approve, reject, and post-approval access.

## Runnable pending-review fixture

Start the API, then run:

```powershell
python -X utf8 tools/seed_contribution_fixture.py --base http://127.0.0.1:8000
```

The command creates one synthetic 8000 Hz WAV recording, a contributor
account, and one submitted-private story. It prints the record ID, the
reviewer queue request, and the review request. All data is synthetic and can
be used with temporary/private storage.
