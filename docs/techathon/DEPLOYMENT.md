# Deployment verification and handoff

Zheng owns the authentication, storage and deployment handoff. Dat coordinates merging and release decisions. The application serves the bundled frontend and its API from the same FastAPI service. Use [the README](../../README.md) for local setup and source-build commands.

## Dated live evidence

In the [Nov 13 technical review](https://github.com/phatdat220707/voices-of-the-north/pull/1#issuecomment-6847324712), Zheng reported that the Render dashboard showed commit `0cc1701` Live at 14:45:55 HKT, that the hosted HTML matched the baseline, and that the story API returned 14 stories. This is a dated demo check. Invited Google sign-in, Supabase, restart/restore and complete publication/withdrawal still need staging evidence.

The same review noted that Render's Source still displayed the former repository owner. Confirm the connected repository and branch after the transfer to `phatdat220707/voices-of-the-north`.

## Check a deployed build

1. Record the Render service, environment, source repository, branch, live commit and deployment time. Keep private dashboard links and credentials in the team Doc.
2. Inspect the service's actual build command, start command and automatic-deploy setting. Record these commands in the Zheng handoff before changing them. The repository currently has no GitHub Actions workflow, so GitHub CI cannot provide this deployment evidence.
3. Open the [deployed app](https://voices-of-the-north.onrender.com/voices-of-the-north-app.html) and [health endpoint](https://voices-of-the-north.onrender.com/api/health). Compare the served HTML with the Git blob for the recorded live commit. A successful health response alone does not verify access control or durable storage.
4. Check [the story API](https://voices-of-the-north.onrender.com/api/stories) and a supported and unsupported question. Record source timestamps and which parts use real services, local retrieval or fixtures.
5. Repeat the relevant staging acceptance checks with separate contributor and reviewer identities before publishing a contributor release.

## Handoffs still required

- Zheng supplies the service-specific build/start/deploy commands, automatic-deploy configuration and post-transfer source confirmation.
- Boris supplies the pending-review fixture and reproducible submission tests. Review his local Supabase proposal with Zheng before changing the documented SQLite baseline.
- Dat confirms the person receiving bugs and takedown requests before closing Issue #2.

Share a public-safe commit, environment and result on the PR, put private test-access details in the team Doc, and notify Dat with the handoff link.
