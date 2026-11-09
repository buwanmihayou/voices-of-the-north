# Techathon+ work items

Use the [GitHub Issues](https://github.com/buwanmihayou/voices-of-the-north/milestone/1) for ownership, current status, and updates. The criteria below describe the initial handoffs.

## [Prepare the repository and agree the launch scope](https://github.com/buwanmihayou/voices-of-the-north/issues/2)

**Owner** Dat

**Due** 2026-11-16 at 21:00 HKT

**Reviewer** Zheng

**Deliverable**

A reviewed repository setup, a shared demo URL and commit, and named reviewers and operational contacts for launch.

**Acceptance**

- [ ] Review the README, agent instructions, roadmap, demo evidence, and archive in the repository setup PR.
- [ ] Confirm the approved public scope and name the person who will receive bugs and takedown requests.
- [ ] Record the shared test URL and commit, initial demo results, and prioritized issues.
- [ ] Confirm owners and reviewers for the launch backlog.

## [Set up invited Google sign-in and durable staging storage](https://github.com/buwanmihayou/voices-of-the-north/issues/3)

**Owner** Zheng

**Due** 2026-11-30 at 21:00 HKT

**Reviewer** Dat

**Deliverable**

An isolated staging environment with server-side account and recording permissions, persistent SQLite and private audio, and a documented backup and restore drill.

**Acceptance**

- [ ] Verify Google OpenID Connect identity on the server and restrict contribution to invited accounts. Check invited and uninvited sign-in, guest behavior, and disabled demo auth and demo admin grants in production configuration.
- [ ] Use an explicit permissions matrix. Contributor B cannot fetch the metadata or audio of A's private recording, including by direct URL.
- [ ] Verify SQLite and private audio survive restart and a staging backup/restore. Store media outside static file serving and document how withdrawal state survives restore.
- [ ] Share a public-safe test summary and staging build reference. Get Dat's cost approval before provisioning paid resources.

## [Build consent, recording, transcript review, and submission](https://github.com/buwanmihayou/voices-of-the-north/issues/4)

**Owner** Boris

**Due** 2026-12-10 at 21:00 HKT

**Reviewer** Zheng for server changes, Dat for the user flow

**Deliverable**

An invited contributor can consent, record, transcribe, review the transcript and sharing scope, and submit a private story for approval.

**Acceptance**

- [ ] Use staging and sample data, with two test accounts and a guest browser.
- [ ] Consent appears before microphone permission. Cancel leaves the microphone idle. A transcription error shows a clear retry path while protecting the draft.
- [ ] The contributor can review the transcript and timestamp links, select the intended sharing scope, and submit for moderation. The story remains private while pending.
- [ ] Contributor B cannot open the record or audio, and guests cannot discover it. Share reproducible checks and handoff to the moderator flow.

## [Finish the mobile guest and contributor UI](https://github.com/buwanmihayou/voices-of-the-north/issues/5)

**Owner** Steven

**Due** 2026-12-15 at 21:00 HKT

**Reviewer** Dat

**Deliverable**

Mobile screens for browsing and for invited contributors, with consistent draft, pending review, published, withdrawn, and error states.

**Acceptance**

- [ ] Guests can browse approved stories, play audio, and ask about the archive. Contributor-only actions communicate the access requirement.
- [ ] Draft, pending review, published, withdrawn, and error states are readable and distinguishable, with a next action where appropriate.
- [ ] Test navigation, consent, transcript and timestamp access, and error or retry states on phone and desktop. Dat independently repeats the mobile flow.
- [ ] Change frontend source in frontend/src and regenerate the bundled HTML.

## [Enforce moderation, publication, and withdrawal](https://github.com/buwanmihayou/voices-of-the-north/issues/6)

**Owner** Dat

**Due** 2026-12-20 at 21:00 HKT

**Reviewer** Zheng

**Deliverable**

A reviewer can publish or withdraw a submitted story, with one server-side visibility policy across public surfaces.

**Acceptance**

- [ ] New recordings are private. Sharing consent and a review decision are required before publication. A contributor cannot publish a story through a direct API call.
- [ ] Verify that archive, search, map, Ask the Village, and audio resolve only approved public content for guests.
- [ ] Withdraw a published sample story. Confirm it disappears from every public surface and old audio URLs stop serving it. Include stale caches, offline fallback, and server errors.
- [ ] Check that a grounded answer opens the correct audio point and missing evidence leads to a refusal. Share sample-data evidence and an operational takedown handoff.

## [Confirm submission requirements and prepare the pitch](https://github.com/buwanmihayou/voices-of-the-north/issues/7)

**Owner** Dat until confirmed. Douglas is proposed for Competition & Pitch.

**Due** 2026-12-20, with final update 2027-01-08 at 21:00 HKT

**Reviewer** Dat for requirements and claims, Steven for demo and deck playback

**Deliverable**

A team-specific submission checklist and an evidence-backed deck. If Douglas chooses Demo Review & Evidence or Business & Impact, Dat keeps the submission checklist and fills any ownership gap.

**Acceptance**

- [ ] Confirm the role and verify HumanLoop's fast-track dates, required assets, and pitch format in the portal. Share public-safe results only.
- [ ] Match each demo claim to tested behavior and distinguish sample stories, launch plans, and untested demand or payment hypotheses.
- [ ] Gather evidence and a draft deck by Dec 20. By Jan 8, supply the final deck, demo or backup references, and Q&A updated after an AI critique reviewed by a teammate.
- [ ] Verify playback and links as a guest where appropriate. Keep private portal details outside the public issue.

## [Run launch sign-off and rehearse the submission](https://github.com/buwanmihayou/voices-of-the-north/issues/8)

**Owner** Team, Dat accountable

**Due** 2027-01-08 at 21:00 HKT

**Reviewer** Zheng for release evidence, Dat for final decision

**Deliverable**

A tested release candidate, a written launch decision, and a complete submission package with a backup video.

**Acceptance**

- [ ] Record the candidate URL and commit. Have someone other than the flow implementer run tests on a phone and desktop with sample data.
- [ ] Confirm invite, cross-account and guest boundaries, persistence and restore, moderation, withdrawal, and timestamp/refusal checks. Identify owners for incidents and takedowns.
- [ ] Dat approves recording only after launch gates pass. If any contribution gate fails, keep recording on staging and verify the read-only archive separately before launch.
- [ ] Run a timed pitch and Q&A and verify the deck, video, and other submission links. Jan 8 is internal; verify HumanLoop's portal before the published Jan 11, 2027 at 23:59 HKT cutoff.

## Progress updates

Post an issue update by 21:00 HKT on agreed days using **Done + evidence / Next / Blocked**. If a deadline is at risk, propose a new date for Dat to approve before it passes. Use sample data and keep private evidence outside GitHub.
