# Archived — React/Next.js Components

These files are from the original Next.js App Router implementation of the project.
They are NOT used in the deployed single-file HTML app (voices-of-the-north-app.html).

Kept for reference only. Do not deploy or import from active code.

## What's here
- components/FloatingAIAssistant.jsx — React version of the floating AI assistant (replaced by js/ask-assistant.js)
- app/ — Next.js App Router pages and API routes (not used)
- lib/askVillageApi.js — Mock/backend dual-mode API client (logic absorbed into server.py /api/ask-village)

## What's NOT here (still in active use)
- lib/storyCorpus.js — stays at frontend/lib/storyCorpus.js (shared by vanilla JS assistant)

## Decision
Made on Nov 3, 2026 by Zheng. The deployed app uses the vanilla JS stack exclusively.
