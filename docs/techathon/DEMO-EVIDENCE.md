# Demo baseline and test evidence

**Baseline reviewed** Nov 9, 2026. The Render frontend matched repository commit [`76b0d1e`](https://github.com/phatdat220707/voices-of-the-north/commit/76b0d1e46a45c3c44852a7ff8fde920cd7cfaa5c). Recheck the deployed build before using this evidence for a different commit. [Hosted demo](https://voices-of-the-north.onrender.com/voices-of-the-north-app.html)

At that baseline, the repository contained eight team-written role-play stories and one measured sample WAV of approximately 46.7 seconds. Use the sample designation in the demo and pitch. The checks below were performed on the existing demo. Launch requirements are tracked in the [roadmap](ROADMAP.md).

| Check | Evidence at the baseline |
| --- | --- |
| Deployment parity | Served app HTML matched the checked-in frontend for the baseline commit. |
| Consent entry point | The desktop demo showed consent before requesting microphone access. |
| Source playback | On desktop, a supported answer's source opened the story and sought to its cited time. |
| Answer scope | API checks returned a grounded answer for a supported question, refused an unsupported question, and respected an explicitly empty story scope. |
| Live microphone and transcript review | Full Nov 9 end-to-end run pending. |
| Independent phone test | Pending at the Nov 9 baseline. |
| Account isolation, persistence, moderation, and withdrawal | Require dedicated staging evidence before launch. |

## Nov 13 local review

Repository main at [`0cc1701`](https://github.com/phatdat220707/voices-of-the-north/commit/0cc17019aaa44ec21b0bb3dc19040db1f77e41c0) contains 14 role-play demo stories and one measured sample WAV. This repository snapshot does not establish which build is deployed on Render.

[Draft PR #10](https://github.com/phatdat220707/voices-of-the-north/pull/10), head `206301a`, adds partial Issue #6 protections on that main snapshot. Local Windows tests used synthetic identities and isolated temporary SQLite databases. The recording API suite passed 74 checks, the lab API suite passed 48, and the backend part of the story-scope suite passed 14. Data validation passed for 14 stories and the bundled JavaScript parsed successfully.

The tested API behavior includes owner/reviewer access to stored recordings, rejection of a contributor-supplied public scope as a publication decision, reviewer-only withdrawal, removal from catalog and retrieval, and denial of the old WAV URL after withdrawal. Range and conditional requests were checked. Catalog, retrieval and the story audio return an error when withdrawal state is unavailable.

Publication from Boris's submitted sample, invited sign-in, persistent staging, Supabase integration, and independent browser/offline withdrawal checks remain pending. The frontend contains mock media and confidence examples, which require explicit mock-mode handling before those displays can support production claims.

## Repeatable checks

Use a teammate who did not build the flow, a clean desktop browser profile, a phone, and sample data. Record the commit, environment, device and browser, steps, expected and observed result, and any public-safe proof in the issue.

1. Open recording, confirm the consent gate, and test both cancel and consent. On staging, record a short sample, review the transcript and timestamp links, and submit it. Confirm the guest view is unaffected while review is pending.
2. Open a public story with audio and follow a source link to its cited point. Ask one answerable question, one unsupported question, and try an empty filtered scope.
3. On staging, attempt recording as an uninvited account and open a private record and its audio as a second invited account. Repeat key checks after restart and a restore drill.
4. On staging, approve and then withdraw a sample story. Check archive, search, map, assistant answers, old audio URLs, and offline or error behavior.

Use `pass`, `fail`, or `not run` per case. Keep private media, screenshots containing personal information, credentials, and account details outside public evidence. Internal verification and AI critique do not constitute interviews or market validation.
