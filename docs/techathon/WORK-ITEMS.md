# Techathon+ work items

Open your [GitHub issue](https://github.com/phatdat220707/voices-of-the-north/milestone/1), then use the independent first step below and the [shared demo example](DEMO-FLOW.md). A handoff can block a specific check while local work proceeds. Use the issue to agree on interface changes and link PRs.

## [Prepare the repository and agree the launch scope](https://github.com/phatdat220707/voices-of-the-north/issues/2)

**Owner** Dat

**Due** 2026-11-16 at 21:00 HKT

**Reviewer** Zheng

**Deliverable**

A reviewed repository setup, a shared demo URL and commit, and named reviewers and operational contacts for launch.

**Start now** Record the baseline, run the current guest demo, and open the interface decisions that need owner agreement. Continue while access and reviewer confirmations come in.

**Handoff** Share the baseline URL and commit, expected demo result, and the agreed sample and handoff for each workstream. The repo review and shared decisions need owner confirmation.

**Acceptance**

- [ ] Review the README, agent instructions, roadmap, demo evidence, and archive in the repository setup PR.
- [ ] Confirm the approved public scope and name the person who will receive bugs and takedown requests.
- [ ] Record the shared test URL and commit, initial demo results, and prioritized issues.
- [ ] Confirm owners and reviewers for the launch backlog.

## [Set up invited Google sign-in and durable staging storage](https://github.com/phatdat220707/voices-of-the-north/issues/3)

**Owner** Zheng

**Due** 2026-11-30 at 21:00 HKT

**Reviewer** Dat

**Deliverable**

An isolated staging environment with server-side account and recording permissions, persistent SQLite and private audio, and a documented backup and restore drill.

**Start now** Map the current identity and storage boundaries. Use synthetic identities and a temporary local store for authorization and restart checks. Prepare the access matrix and storage configuration independently of the UI.

**Handoff** Provide a staging URL and commit, the agreed role and access behavior, separate invited test identities, and restore evidence. Verify Google sign-in and persistent storage on staging. Share test access details privately.

**Acceptance**

- [ ] Verify Google OpenID Connect identity on the server and restrict contribution to invited accounts. Check invited and uninvited sign-in, guest behavior, and disabled demo auth and demo admin grants in production configuration.
- [ ] Use an explicit permissions matrix. Contributor B cannot fetch the metadata or audio of A's private recording, including by direct URL.
- [ ] Verify SQLite and private audio survive restart and a staging backup/restore. Store media outside static file serving and document how withdrawal state survives restore.
- [ ] Share a public-safe test summary and staging build reference. Get Dat's cost approval before provisioning paid resources.

## [Build consent, recording, transcript review, and submission](https://github.com/phatdat220707/voices-of-the-north/issues/4)

**Owner** Boris

**Due** 2026-12-10 at 21:00 HKT

**Reviewer** Zheng for server changes, Dat for the user flow

**Deliverable**

An invited contributor can consent, record, transcribe, review the transcript and sharing scope, and submit a private story for approval.

**Start now** Use the sample clip, a stub transcription result, and an invited test identity to exercise consent, review, and retry locally. Share the proposed submission shape with Dat and Steven.

**Handoff** Give Dat a pending submission fixture with reviewed text, audio reference, and consent metadata. Final staging verification needs Zheng's invited identities and durable storage, plus a real transcription run.

**Acceptance**

- [ ] Use staging and sample data, with two test accounts and a guest browser.
- [ ] Consent appears before microphone permission. Cancel leaves the microphone idle. A transcription error shows a clear retry path while protecting the draft.
- [ ] The contributor can review the transcript and timestamp links, select the intended sharing scope, and submit for moderation. The story remains private while pending.
- [ ] Contributor B cannot open the record or audio, and guests cannot discover it. Share reproducible checks and handoff to the moderator flow.

## [Finish the mobile guest and contributor UI](https://github.com/phatdat220707/voices-of-the-north/issues/5)

**Owner** Steven

**Due** 2026-12-15 at 21:00 HKT

**Reviewer** Dat

**Deliverable**

Mobile screens for browsing and for invited contributors, with consistent draft, pending review, published, withdrawn, and error states.

**Start now** Build and test screens with fixtures for guest and invited views and each review state. Own layout, copy, and state presentation. Coordinate with Boris on recording behavior and Dat on visibility rules.

**Handoff** Provide a phone walkthrough of the fixture states, then repeat it on staging once Boris's submission and Dat's visibility paths are available.

**Acceptance**

- [ ] Guests can browse approved stories, play audio, and ask about the archive. Contributor-only actions communicate the access requirement.
- [ ] Draft, pending review, published, withdrawn, and error states are readable and distinguishable, with a next action where appropriate.
- [ ] Test navigation, consent, transcript and timestamp access, and error or retry states on phone and desktop. Dat independently repeats the mobile flow.
- [ ] Change frontend source in frontend/src and regenerate the bundled HTML.

## [Enforce moderation, publication, and withdrawal](https://github.com/phatdat220707/voices-of-the-north/issues/6)

**Owner** Dat

**Due** 2026-12-20 at 21:00 HKT

**Reviewer** Zheng

**Deliverable**

A reviewer can publish or withdraw a submitted story, with one server-side visibility policy across public surfaces.

**Start now** Use a seeded pending submission and a reviewer test identity to develop and verify moderation and guest visibility locally. Agree with Boris on the submission shape and Zheng on reviewer authorization and storage.

**Handoff** Share review and public visibility behavior with public-safe test evidence. Final staging verification needs an actual submission from Boris's flow and Zheng's authorization and storage.

**Acceptance**

- [ ] New recordings are private. Sharing consent and a review decision are required before publication. A contributor cannot publish a story through a direct API call.
- [ ] Verify that archive, search, map, Ask the Village, and audio resolve only approved public content for guests.
- [ ] Withdraw a published sample story. Confirm it disappears from every public surface and old audio URLs stop serving it. Include stale caches, offline fallback, and server errors.
- [ ] Check that a grounded answer opens the correct audio point and missing evidence leads to a refusal. Share sample-data evidence and an operational takedown handoff.

## [Confirm submission requirements and prepare the pitch](https://github.com/phatdat220707/voices-of-the-north/issues/7)

**Owner** Douglas, confirmed for Competition & Pitch

**Due** 2026-12-20, with final update 2027-01-08 at 21:00 HKT

**Reviewer** Dat for requirements and claims, Steven for demo and deck playback

**Deliverable**

A team-specific submission checklist and an evidence-backed deck, with accessible research and PRD references for the reviewers.

**Start now** Share the research and PRD links and draft the deck outline and evidence list using the current demo. Record the organizer-confirmed Jan 11, 2027 at 23:59 HKT pitch deck deadline and track-change process. Mark claims that need staging evidence.

**Handoff** Share the submission checklist and draft narrative early. The final deck needs verified evidence for its claims or explicit wording about what the current demo shows.

**Acceptance**

- [ ] Maintain HumanLoop's organizer-confirmed fast-track deadline and verify required assets, portal status, and pitch format. Share public-safe results only.
- [ ] Match each demo claim to tested behavior and distinguish sample stories, launch plans, and untested demand or payment hypotheses.
- [ ] Gather evidence and a draft deck by Dec 20. By Jan 8, supply the final deck, demo or backup references, and Q&A updated after an AI critique reviewed by a teammate.
- [ ] Verify playback and links as a guest where appropriate. Keep private portal details outside the public issue.

## [Run launch sign-off and rehearse the submission](https://github.com/phatdat220707/voices-of-the-north/issues/8)

**Owner** Team, Dat accountable

**Due** 2027-01-08 at 21:00 HKT

**Reviewer** Zheng for release evidence, Dat for final decision

**Deliverable**

A tested release candidate, a written launch decision, and a complete submission package with a backup video.

**Start now** Dat prepares the shared smoke-test checklist, evidence log, and backup walkthrough from the current demo. Owners can rehearse or test their paths as they land.

**Handoff** Final sign-off needs a named candidate URL and commit, staging evidence, an independent phone and desktop run, and the pitch package. Record any scope reduction before presenting.

**Acceptance**

- [ ] Record the candidate URL and commit. Have someone other than the flow implementer run tests on a phone and desktop with sample data.
- [ ] Confirm invite, cross-account and guest boundaries, persistence and restore, moderation, withdrawal, and timestamp/refusal checks. Identify owners for incidents and takedowns.
- [ ] Dat approves recording only after launch gates pass. If any contribution gate fails, keep recording on staging and verify the read-only archive separately before launch.
- [ ] Run a timed pitch and Q&A and verify the deck, video, and other submission links. Jan 8 is internal; verify HumanLoop's portal before the published Jan 11, 2027 at 23:59 HKT cutoff.

## Progress updates

Follow the [team update rules](ROADMAP.md#team-updates). Link public-safe evidence and handoff decisions on GitHub. Use your own Google Doc tab for the daily check-in.
