# Techathon+ launch roadmap

GitHub holds work items, decisions, PRs, and public-safe evidence. Track delivery in the [GitHub backlog](https://github.com/phatdat220707/voices-of-the-north/milestone/1). Use the team Google Doc for daily check-ins in your own tab.

See the [work items](WORK-ITEMS.md) for what each person can start now and what must be ready for final verification. The [main demo flow](DEMO-FLOW.md) defines the handoffs between workstreams.

## Product scope

Anyone can browse, listen to, and ask about approved public stories. Invited contributors sign in to record, review a transcript, and submit a story for moderation. New material starts private. A reviewer approves publication, and withdrawn stories stop appearing across public surfaces. The current hosted app is a role-play demo. See [verified demo behavior](DEMO-EVIDENCE.md) for its limits.

## Internal deadlines

All dates below are in HKT. Owners post their handoff by 21:00 on the due date.

| Deadline | Owner | Handoff | Reviewer |
| --- | --- | --- | --- |
| Nov 16, 2026 | Dat | Repository review, launch scope, common demo URL and commit, initial tests, and named operational contacts | Zheng |
| Nov 30, 2026 | Zheng | Isolated staging with Google sign-in, invitations, server-side access control, persistent storage, and a restore drill | Dat |
| Dec 10, 2026 | Boris | Consent, recording, transcription, transcript review, and private submission for approval | Zheng for server changes, Dat for the flow |
| Dec 15, 2026 | Steven | Mobile guest and contributor UI with clear draft, pending review, published, withdrawn, and error states | Dat |
| Dec 20, 2026 | Dat | Review, publication, withdrawal, and consistent visibility across archive, search, map, Ask the Village, and audio | Zheng |
| Dec 20, 2026, then Jan 8, 2027 | Douglas | Competition and pitch requirements, evidence, and deck | Dat for handoff, Steven for demo and deck playback |
| Jan 8, 2027 | Team, Dat accountable | Tested release candidate, sign-off or read-only decision, backup video, deck, and rehearsed Q&A | Zheng for release evidence, Dat for final sign-off |

## Work in parallel

Dat coordinates integration and each work item has one accountable owner. Start from the same baseline on separate branches. Agree on the data, states, and errors passed between workstreams before changing them. Use a shared example and local fixtures so a service or another PR only blocks the checks that require it.

Zheng owns authentication, access control, and storage. Boris owns recording, transcription, and submission behavior. Steven owns screens, layout, and UI states. Dat owns moderation, publication, and visibility. Agree in the issue before two people edit the same module. The [work items](WORK-ITEMS.md) record what each owner hands over and what the reviewer verifies.

Douglas has accepted Competition & Pitch. He owns the submission checklist, research and PRD references, evidence collection, and deck. Dat reviews scope and claims. Present user demand and who might deploy or pay as hypotheses until supported by user evidence.

Jan 8 is the internal deadline. The organizers confirmed to the team that fast-track entrants must submit their pitch deck through the portal by **Jan 11, 2027 at 23:59 HKT**. HumanLoop has a place in the Finale and must still meet the required deliverables and dates. The organizers also confirmed that the theme can be edited through My Team Profile. The team plans to select AI+ Digital Economy & Smart City when submitting the updated profile. Keep portal status and any later requirements current. After submission, rehearse the official format with the backup video. [Techathon+ participation guide](https://hktechathon.com/en/site/join)

Boris has reported a local Supabase-compatible implementation with PostgreSQL, authentication, and private audio storage. Zheng reviews the proposal with Boris and Dat coordinates the decision. SQLite remains the documented baseline until the proposed storage change is reviewed. Share a branch, reproducible tests, real-service checks still pending, costs, and backup/restore behavior before changing the shared architecture.

## Launch acceptance

- Separate staging from production. Verify Google OpenID Connect identity server-side and authorize invites, reviewer privileges, and each private resource on the server. Disable demo login and demo administrator grants in production. Dat approves costs before paid services are enabled. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- Put SQLite and private audio on persistent storage outside the public static directory. Document backup and restore, then test restart and restoration in staging before enabling recording. Ensure restoration does not republish withdrawn content. [Render Persistent Disks](https://render.com/docs/disks)
- Require consent before requesting microphone access. Show the transcript and intended sharing scope before the contributor submits. Enforce the publication decision separately from consent. Record review and withdrawal actions without exposing private content.
- Check guest, uninvited, contributor A, contributor B, and reviewer paths. Confirm that B cannot read or play A's private recording, and that guests only see approved public stories.
- Withdraw a published test story and confirm it leaves archive, search, map, Ask the Village, and old audio URLs. Include cached/offline and server-error cases. Public surfaces should fail closed when approval status cannot be verified.
- Run the demo on a phone and computer with sample data. Verify that a supported answer reaches the right point in its audio and an unsupported question receives a refusal.

Dat approves public recording after access controls, restart/restore, moderation, and withdrawal pass and the team names an owner for bugs and takedowns. If contribution gates are pending, keep recording on staging. A public read-only archive can open only if its own visibility checks pass.

## Team updates

Acknowledge work tags in under five hours. Post a daily update in your own Google Doc tab by 21:00 HKT. Link the relevant issue, PR, or test evidence. Keep scope changes, handoffs, and evidence that reviewers need on the GitHub issue or PR.

After a push or a completed handoff, notify Dat in the team chat with what changed, the issue and commit or PR link, and the steps to test it. Include work coordinated on WeChat in the same update. A specific deadline agreed with Dat, such as the Nov 13 handoff at 23:59 HKT, takes precedence for that handoff.

```text
Done + proof | PR, commit, or safe reproduction and result
Next         | next step and expected handoff
Blocked      | dependency and help needed, or none
```

If a deadline is at risk, flag it early and propose a new date for Dat to approve. Discuss a first missed update privately and agree on a recovery step. For repeated misses, split or reassign work that puts shared deadlines at risk.

Run internal demos with sample data and ask a teammate who did not build the flow to repeat it. Use AI to critique the draft deck, demo script, and test evidence against the official judging criteria. Have a teammate record whether to fix, verify, or defer each material suggestion. Internal tests support product claims within the tested scope. [Techathon+ judging criteria](https://hktechathon.com/en/site/awards)
