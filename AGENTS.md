# Working on Voices of the North

1. Start with your assigned [GitHub issue](https://github.com/buwanmihayou/voices-of-the-north/milestone/1). Read the [README](README.md), the relevant parts of the [roadmap](docs/techathon/ROADMAP.md), and the code the issue touches. Confirm the owner, reviewer, and acceptance criteria before editing.
2. Branch from the latest `main` into a task-specific branch. Keep each PR focused and link the issue. Use `Closes #N` for a complete handoff or `Refs #N` for partial work. Keep application and generated files together when the change requires both.
3. Edit frontend code in `frontend/src/`. Run `python tools/build_frontend.py` to regenerate `frontend/voices-of-the-north-app.html`; the generated HTML and legacy frontend copies are unsuitable edit targets. Use the checks in the README and run the user flow touched by the issue.
4. Report the commit, environment, checks run, observed results, and remaining limitations in your PR. For authorization changes, test signed-out, invited, uninvited, and cross-account access as applicable. Use isolated sample data for tests.
5. Follow the issue update cadence in the roadmap. Route work to its named reviewer. Get Dat's approval before enabling paid services or publishing a release with contributor access.

This repository and its issues are public. Keep credentials, invite lists, private links, internal discussions, raw user recordings, and identifying transcripts out of commits and issue evidence. Keep the bundled role-play fixtures and app asset paths intact. Historical documents are references. Use the issue and roadmap for current requirements.
