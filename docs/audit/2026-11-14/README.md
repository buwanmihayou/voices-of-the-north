# English retrieval verification — November 14, 2026

Fix: [draft PR #14](https://github.com/phatdat220707/voices-of-the-north/pull/14), code commit `617e761`.

The live app refused `What was Yuen Long like when you were a child?`, while `細個元朗周邊係點㗎？` returned YL-001 at 00:00. The fix adds the missing `Yuen Long` alias to the shared segment keywords. Answers retain the original Cantonese transcript; this is curated keyword retrieval, not general cross-language semantic search.

| Evidence | Observed result |
| --- | --- |
| [Live Cantonese result before the fix](live-retrieval-before.jpg) | Cantonese YL-001 00:00 result on the live service. The English refusal was observed in the API response and browser accessibility state, but is above this screenshot's visible area. |
| [Local English result after the fix](local-english-retrieval-after.jpg) | Patched app returns the original excerpt and YL-001 00:00 citation. |
| [Fresh offline English result](offline-english-retrieval-after.jpg) | With the API pointed to an unavailable local port, a new question returns the same source and an explicit offline disclosure. |
| [Published Boris coordination](boris-pr11-coordination-posted.jpg) | The user-authorized [PR #11 comment](https://github.com/phatdat220707/voices-of-the-north/pull/11#issuecomment-6877714775) links the fix and requests reconciliation with #10, #12 and #13. |

Validation: 20 focused API/offline checks and 14 existing story-scope backend checks passed. Corpus build validated 14 stories; bundled JavaScript syntax passed. Browser source navigation opened `#stories?story=YL-001&t=0` and the matching transcript. Full browser withdrawal/cache propagation and combined draft-PR integration were not tested.

Reproduce on this branch:

```powershell
python -X utf8 tools/build_frontend.py
python -X utf8 tools/verify/english_retrieval.py
python -X utf8 tools/check_frontend_syntax.py
python -m uvicorn server:app --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:8000/voices-of-the-north-app.html` and use the home-page assistant with the full corpus selected. Both questions above should return YL-001 at 00:00. Click the source to open its transcript. For offline fallback, load `?api=http://127.0.0.1:8767` while that port has no server and submit a fresh question. `What was your childhood like?` should still refuse.

At capture time the fix was a draft, not merged or deployed. The live service still had the reproduced issue. The coordination comment requests updated heads and test steps; it does not record Boris's agreement.

## Local integration candidate

Branch `codex/local-integration-20261114` combines PR #15 at `a53dcc9` with PR #14 at `32b5f98`. The original repository checkout now uses this branch; local `main` was fast-forwarded to remote main `a6b932a` before integration.

See the [PR #15 findings and reproduction steps](pr15-integration-review.md) and [combined local validation](local-integration-validation.md). The known content-review, owner privacy narrowing and reviewer-queue findings remain open. This branch is a candidate for further work; staging acceptance is outstanding.

The findings and combined-branch validation were [published to PR #15](https://github.com/phatdat220707/voices-of-the-north/pull/15#issuecomment-6878198220). [Screenshot of the posted comment](pr15-review-comment-posted.jpg).
