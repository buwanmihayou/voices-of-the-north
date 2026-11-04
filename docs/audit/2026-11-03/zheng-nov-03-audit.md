# Zheng deployed version audit for 3 November 2026

The deployed prototype is reachable and Cantonese speech recognition works on the server's built-in demo. It is not yet ready to describe as a complete recording, transcript review, save, reopen and delete service. The main blockers are broken source links, unavailable Gemini processing, and incomplete storage and privacy controls.

Deployment: https://voices-of-the-north.onrender.com/voices-of-the-north-app.html

Scope: live desktop browser checks, live HTTP requests, review of the captured deployed HTML and local backend source, and isolated JavaScript checks. No personal recordings were uploaded or existing user data deleted. The deployed HTML matches local HTML after normalizing Windows/Unix line endings. Backend source equivalence was not independently established.

## What works

- Root URL redirects to the app. App, health endpoint and both public demo media assets return HTTP 200. Render initially displayed a service wake-up page, then the app became available.
- All four main navigation pages open. Draft, pending and completed recording tabs switch and show honest empty states in this test browser.
- Demo playback starts. After media metadata loads, the displayed duration changes from 00:51 to 00:46.
- The recording entry shows a consent step before microphone capture. The test stopped before accepting consent or requesting microphone access.
- Live `POST /api/process` with no uploaded file successfully processes the server's built-in demo: `mode=online`, `source=demo`, 120 word entries and timestamps ending at 46.7 seconds. This verifies demo STT, not live microphone capture or transcription accuracy.
- The assistant answers “以前居民主要用咩出行？” using the published story, labels it as a role-played demo, and displays a source timestamp. “火星天氣如何？” receives the expected out-of-scope refusal.
- Isolated execution of the deployed storage functions confirms basic save, reopen and delete behavior using synthetic records. Both inline script blocks parse successfully. These checks do not establish browser quota handling or cross-device storage.

## Broken or incomplete

| Priority | Finding and evidence | Suggested next action |
|---|---|---|
| P0 | Clicking the assistant's `Source: [YL-001] at 00:00` link navigates to `/stories.html?t=0#story-YL-001` and displays `{"detail":"Not Found"}`. | Zheng + Steven: use the single-file app route and verify timestamp playback. Check personal-record links too; source code also points to `recording.html`. |
| P0 | Live health returns `stt_ready=true`, `gemini_ready=false`. Demo processing returns `formal_text` identical to `raw_text` and an empty `qa_list`. | Zheng: diagnose Gemini configuration; distinguish fallback output from generated text in the UI. Do not report the complete Gemini pipeline as working. |
| P0 before user testing | Consent and page copy promise temporary processing, correction and sharing choices, while records persist in browser storage and those management controls are unfinished. Preparation text incorrectly says audio uploads to the user's computer at `127.0.0.1:8000`; the implementation uses the deployment origin. | Agree accurate storage, cloud-processing, access and deletion wording with Dat on Nov 4 before recruiting testers. |
| P1 | Language button does nothing. Deployed HTML has no `langSheet`, `langOverlay`, close or cancel elements; initialization returns early. | Steven: restore the dialog or label the entry unavailable. English and Simplified Chinese remain unimplemented. |
| P1 | Storage quota pruning is reversed: synthetic old/new audio of 4 MiB each retains old audio and discards new audio under the nominal 6 MiB budget. Save also suppresses persistence failures. | Zheng: retain the intended recording, surface save failures, and test recovery. The budget counts data-URL characters, not raw audio bytes. |
| P1 | No records or assistant routes are advertised in live OpenAPI; only `/`, `/api/health`, `/api/process` exist. Local backend has no recording database or record access/deletion APIs. | Nov 4: agree ownership/access and deletion semantics. Nov 5: implement the agreed test storage. Avoid an unauthenticated global recording list. |
| P1 | Demo corpus declares 51 seconds and segments through 50.7 seconds, but playback displays 46 seconds and STT ends at 46.7 seconds. Reprocessing demo stores an `interview-story.mp4` URL, while story playback uses `demo-story.m4a` and the backend prefers `Demo Story.wav`. | Boris + Zheng: verify which recording each transcript and citation belongs to, then align media and timestamps. |
| P1 | Local `server.py` replaces missing word confidence with sentence confidence or a hardcoded 0.92; it does not request word confidence explicitly. All 120 returned demo words have confidence 0.94. | Do not describe the display as independently measured word-level uncertainty. Verify returned confidence provenance. |
| P2 | Sharing, correction/withdrawal and About buttons only show “準備中” toasts, confirmed live. | Keep them out of the supported-feature list until built. |
| P2 | `frontend/lib/storyCorpus.js` exists locally but is untracked and ignored by the broad `lib/` rule. Its deployed URL returns 404. | Narrow the ignore rule before maintaining/deploying separate JS modules. The current inline app carries its own corpus and does not need that URL. |

## What still uses demo data

- Exactly one published story, `YL-001`, told by Boris Lau as a role-played demonstration. It is a real voice recording, not evidence of elder participation or validation.
- Published story text, suggested questions, topic keywords, timestamps and the approximate map area are embedded in JavaScript. The map area is a demonstration location, not the speaker's GPS location.
- The floating assistant uses client-side keyword/bigram matching over this corpus and eligible local-record Q&A. It is not vector search and does not call Gemini for these published-story answers.
- “先聽示範故事” plays public media; “用示範故事試跑完整流程” calls the backend. Successful offline full processing is not established.
- Map controls and an approximate-area view appear, but full tile-load success was not verified.

## Corrections to the earlier draft

Refreshing the same browser normally preserves localStorage. Clearing site data, eviction, private-browsing expiry or changing browser/device can lose access. Storage is not server persistence. Quota pressure can remove audio while retaining text.

Existing local archiving and `.gitignore` edits predate this audit session and remain untouched. They are uncommitted and should not be reported as newly deployed work. The archive README incorrectly says `/api/ask-village` logic was absorbed into `server.py`; that endpoint does not exist. The frontend README still documents removed multi-page/Next.js entry points, and the root README has an unfinished quick-start code block.

## Handoff and outstanding checks

For Nov 4, agree the recording → transcript review → explicit save → reopen → delete flow with Steven, including private ownership, offline recovery, error states and deletion of transcript/audio/assistant history. Boris supplies permissioned clips and checked transcripts; Dat confirms consent wording. These are recommendations for discussion, not commitments made on their behalf.

Still unverified: phone testing, real microphone permissions and recording, personal-record citation navigation, retry after a network interruption, browser storage across a real refresh, delete effects on cached assistant history, transcription accuracy and timestamp alignment against a manually checked recording. These remain for the planned end-to-end test.

Zheng's availability this week: 1 hour per day, confirmed by Zheng. Audit date deadline: 23:00 Hong Kong time, 3 November 2026. No group message has been sent.

## Evidence and reproduction

- `deployment-checks.json`: live health, advertised routes, media availability, HTML fingerprint and full built-in-demo response.
- `frontend-checks.json`: isolated retrieval, syntax, storage, quota-pruning and missing-language-markup checks.
- `deployed-app.html`: exact downloaded deployment HTML.
- `citation-404.png`: browser result after clicking a displayed source link.
- `consent.png`: live consent step before microphone access.

Re-run from the repository root:

```powershell
python tools/audit_deployment.py --output docs/audit/new-run/deployment-checks.json
# Optional: sends one request to transcribe the server's built-in demo, using cloud STT.
python tools/audit_deployment.py --output docs/audit/new-demo/deployment-checks.json --process-demo
node tools/audit_frontend.mjs docs/audit/2026-11-03/deployed-app.html docs/audit/new-frontend-checks.json
```
