# Main demo flow and shared interfaces

Use one Cantonese role-play recording to prove the full journey. An invited contributor gives consent, records and reviews a transcript, then submits it. A reviewer approves the submission. A signed-out visitor opens the published story, asks a supported question in Ask the Village, and plays the cited segment. This is the target for the integrated demo. The [baseline evidence](DEMO-EVIDENCE.md) records what the existing hosted demo already proves.

Dat coordinates agreement on the interfaces below. Keep field names and existing routes where they fit. Record the agreed shape, an example, and any change in the relevant issue before another owner relies on it.

| Handoff | What to agree and test locally | Owner → consumer |
| --- | --- | --- |
| Identity and access | Guest, invited contributor A, another contributor B, uninvited account, and reviewer. The server resolves identity and permissions. Test account B being denied A's pending recording and audio. | Zheng → Boris, Dat, Steven |
| Reviewed submission | Stable recording ID, reviewed transcript with time offsets, protected audio reference, consent metadata, and intended sharing scope. A successful submission is pending review and private. A transcription failure leaves a draft that can be retried. | Boris → Dat, Steven |
| Review and publication | Reviewer receives a pending submission and can approve or decline. Approved public content has a story ID and appears on the public surfaces. Withdrawal removes it and cuts off access via old audio links. A failed review action leaves the previous state intact. | Dat → Steven and the release verifier |
| Mobile states and errors | Show draft, pending review, published, withdrawn, and actionable failures. Agree on how permission denied, unavailable content, and a retryable error map to what the user sees. A loading or error state must never imply that a review succeeded. | Steven → Dat for UI review |
| Public answer and playback | An answer cites a public story ID and an audio time in seconds. Unsupported questions get a refusal. Check search, map, assistant results, and direct audio access after withdrawal. | Dat → pitch and release verification |

For the shared example, reuse the audio and an existing timestamp from the bundled role-play story `YL-001` in [data/stories.json](../../data/stories.json). Give its submission copy a new fixture ID. Seed it as private and pending review under contributor A, then check that a signed-out visitor and contributor B cannot open it. Use separate approved and withdrawn fixtures for UI work. The contributor copy stays out of the public catalog until a reviewer approves it.

1. **First demo.** Run the existing public story, supported question, and timestamp playback on the baseline. Run the contributor, review, and mobile paths with local sample data where needed. Label those results as local or simulated.
2. **Integration.** Once the relevant handoffs are ready, Dat names the staging URL and commit. Run the entire journey with separate test identities, persistent storage, and a real transcription. Confirm that an unsupported question is refused and repeat the public checks after withdrawing the sample.
3. **Extension.** Consider additional stories, languages, or presentation features after the main demo passes. Track any expansion in its own issue so it can proceed independently.

For each handoff, link the issue and PR, name the commit and environment, give the sample input and expected versus observed result, and list checks that still need staging. When the reviewer has enough evidence, stop editing that scope. On integration, retest the changed boundary and one representative demo run.
