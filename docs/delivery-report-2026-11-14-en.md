# Delivery Report — Voices of the North (2026-11-14)

> Pure front-end web app (localStorage, no mandatory backend); entry `voices-of-the-north-app.html`; local server `http://127.0.0.1:8421`.
> Red lines (untouched): three confidence threshold sets (0.75 / 0.5 / 0.8-0.5), mobile UI slimming rules, bottom white edge, thumbnail badge 14px/-6px.

## Delivery Status
- **Branch**: `fix/demo-labels-a11y-confidence` (based on `main`, pushed to origin)
- **PR**: https://github.com/phatdat220707/voices-of-the-north/pull/new/fix/demo-labels-a11y-confidence
  (`gh` CLI not installed → open via web; title `Demo confidence labels + a11y fixes + confidence unavailable fallback`; body can be pasted from this file)
- All code changes are **committed + pushed** to this branch; **not yet merged to `main`** (everything still local to the branch / pending-merge PR).

## 1. Mobile + Desktop Test Evidence
**Done** — `scripts/evidence.mjs` captured 4 screenshots each at 390×844 and 820×900 (stories / media / recording / settings) = 8 images, plus a 30s `walkthrough.webm`; `.gitignore` ignores `evidence/` (README only committed). Reproducible via `node scripts/evidence.mjs`.
- **proof (local paths, not in repo, see Drive)**: `evidence/{mobile,desktop}-{stories,media,recording,settings}.png` (8), `evidence/walkthrough.webm`, `evidence/task2-filter-touch-390.png`, `evidence/task4-media-overlay.png`, `evidence/task4-stories-list.png`, `evidence/README.md`
- **Drive bundle**: `evidence-bundle.zip` (7.5 MB, at repo root) — drag to Drive in one step. **[Drive link TBD / 待补 Drive 链接]**
- **what each proves**: `*-stories` = map fills to tab bar / pins visible / no bottom white edge / UI slimmed; `*-media` = media modal inside 430px shell + footer "示範" label; `*-recording` = recording card expanded + icon picker (7 types) visible; `*-settings` = settings page OK; `task2-filter-touch-390` = 44×44 touch target (red dashed) around 34×34 visual button (green), blue search box 16px away, no overlap.

## 2. Contributor States (working vs placeholder)
**Done (read-only inventory, no code changed)**. State-machine normalization: `10-store.js:214` (`['draft','pending','done']`).

### A. Recording 3 states
| State | Trigger (src:line) | Render (45-recordings.js) | Real data flow | Verdict |
|---|---|---|---|---|
| Draft | new local save `status:'draft'` (40-recorder.js:495) | `renderDraftBody` / `tab-drafts` (:169 / :69) | localStorage real + `/api/process` | 🟢 working |
| Pending | upload failed → `status:'pending'` (40-recorder.js:665) | `renderPendingBody` / `tab-pending` (:186 / :69) | localStorage + retry backend | 🟢 working (needs backend to transcribe) |
| Done | upload success STT writeback (40-recorder.js:640, :960) | `renderDoneBody` / `tab-done` (:208 / :69) | real STT if backend online; offline → draft only | 🟢 working (needs backend) |

### B. Confidence 4 tiers
| Tier | Threshold (src:line) | Render | Real data flow | Verdict |
|---|---|---|---|---|
| High | ≥0.8 (30-stories.js:869; 40-recorder.js:797) | `confidenceBadge` (30-stories.js:868) / `recConfidenceBadge` (40-recorder.js:918) | story=Mock (`confLevels` 30-stories.js:28); recording=real STT | 🔴 story placeholder / 🟢 recording working |
| Mid | ≥0.5 | same | same | 🔴 / 🟢 |
| Low | <0.5 | same | same | 🔴 / 🟢 |
| No data | `null` | same → `conf.unavailable` (Task 3) | demo data explicit null / STT missing field | 🟢 handled (shows unavailable) |

⚠️ The three threshold sets (0.75 / 0.5 / 0.8-0.5) were **not modified** (hard constraint).

### C. Other states (contributor identity / permissions)
| State | src:line | Data flow | Verdict |
|---|---|---|---|
| Contributor identity `author='me'` | 30-stories.js:27 (`MINE`), :35 inject, :304 / :883 "My recordings" toggle | demo-injected 3 (YL-001 / FL-003 / STN-009) | 🔴 placeholder |
| Permission `scope` | 10-store.js:216 / 387-398 / 431 | localStorage real r/w | 🟢 working |
| Role `role` | 10-store.js:124 / :103 | session real | 🟢 working |
| Correction `correction` | 10-store.js:522 (`addCorrection`), :554 (`approve`) | localStorage (`K.corrections`) local submit / approve | 🟢 working (local) |
| Withdrawn / authorized | 10-store.js:617 / :651; stories.json `authorized:false` | preset (unauthorized) | 🔴 placeholder |
| Sync `sync` | 40-recorder.js:628 (patch backend), 10-store.js:404 (`patchRecord`) | local-first, backend optional | 🟢 local / 🟡 backend optional |

## 3. Mock / Demo Labels Status
**Done — added a unified "示範 / Demo" label (clearly visible, not tiny hidden text, not tooltip-only).**
- **Current**: `augmentMockData` (30-stories.js:23-43) injects demo media at runtime (i=0,1 → BigBuckBunny video, i=2 → picsum image, rest audio); `confLevels` (30-stories.js:28) injects confidence deterministically.
- **Label**: 3-language `badge.demo` (05-i18n.js:155 / 818 / 1481) + media-modal footer (33-media.js:118) + next to story confidence badge (30-stories.js:868-879) as a low-key grey tag; **recording** confidence (real STT) is **not** labelled.
- **proof**: `evidence/task4-media-overlay.png`, `evidence/task4-stories-list.png`; `fix_1108` **0 failed**, lint 0.

## 4. Recording Confidence Source Audit + unavailable before/after
- **Audit conclusion (Task 6)**: verified it comes from **real STT**, **no code change**. Full chain:
  upload → `POST /api/process` (40-recorder.js:620) → backend `server.py:1280` parses Google Speech word-level confidence (server.py:1292-1297 `word_conf = getattr(word_info,"confidence",0.0)`, `None` if absent) → frontend `normalizeWords(data.words)` (40-recorder.js:638 / 698) reads `word.confidence` → `confidenceSource` (40-recorder.js:648) = `'provider'` → `recConfidenceBadge` (40-recorder.js:918) shows the word-level average (40-recorder.js:799). **No hard-coded / mock**; if STT has no `confidence` field → `null` → `'unavailable'` fallback (already implemented).
- **unavailable before/after (Task 3)**:
  - Before: `none` tier rendered `conf.none` → "無數據 / 无数据 / No data"
  - After: maps to `conf.unavailable` → "無法取得 / 无法获取 / unavailable"
  - src: 30-stories.js:871, 40-recorder.js:920, 05-i18n.js:154 / 817 / 1480; lint 0, `fix_1108` 0 failed. **Thresholds untouched.**
- **proof**: commits `26ff477` / `b5afe37`; rebuilt `voices-of-the-north-app.html`.

## 5. Filter Button a11y + Touch Size before/after
- **Accessible name (included)**: Before `#filterToggle` had no accessible name (icon `aria-hidden`); after `data-i18n-aria="stories.filterAria"` (app.template.html:228) + 3 languages (05-i18n.js:256 / 919 / 1583) → `aria-label="篩選 / 筛选 / Filter"`. Commit `d8158e1`.
- **Touch size (added today)**: Before hit area = 34×34 (fails WCAG 2.5.5); after `.page--stories .atlas__filter::before { inset:-5px }` expands to **44×44**, visual stays 34×34, no layout shift, UI slimming untouched. `app-ext.css` (added `::before`). Commit `8864586`.
- **proof**: `evidence/task2-filter-touch-390.png` (red dashed 44×44 around green 34×34, blue search box 16px away, no overlap); geometric `btnW/H=34`, `gapToSearch=16`, `hitAreaLeft > searchRight`; `fix_1108` 0 failed.

## 6. Assistant Language Refresh before/after
- **Before**: switching language → assistant FAB text unchanged, needed reload to update.
- **Root cause**: `99-init.js:73-79` `vtn:lang-changed` listener only refreshed stories / recordings / about, **did not call `assistant.refresh()`**; FAB `aria-label` set once in `build()` (50-assistant.js:287).
- **After**: assistant module self-subscribes to `vtn:lang-changed` and calls `refresh` (50-assistant.js:365); `refresh` (50-assistant.js:669-672) updates FAB `aria-label` + hint instantly. **No global i18n refactor, no impact on other modules.** Commit `680a107`.
- **proof**: Playwright verified switching language (no reload) FAB `aria-label` changes instantly ("開啟村落問答助手" → "Open the village Q&A assistant"); `fix_1108` 0 failed, lint 0.

## Next (non-blocking)
1. Open the PR via web (link above); body can be pasted from this file.
2. Upload `evidence/` to Drive (use `evidence-bundle.zip`) and backfill `evidence/README.md` `[Drive link TBD / 待补 Drive 链接]`.
3. (Done) Removed redundant old branch `fix/demo-labels-and-a11y` (same content, no PR).

## Blocked
- **None.** All 9 tasks deliverable; only PR merge needs a reviewer, and the Drive link is pending manual upload (cannot be automated from this environment).

## Group message (≤3 lines)
```
[Voices of the North — 11/14 wrap-up] Filter button now has an aria-label + 44×44 touch target; confidence "no data" shows "unavailable";
demo/mock labels and the assistant button's language live-refresh are done. Mobile+desktop screenshots + 30s walkthrough are on Drive [link TBD].
Code is on branch fix/demo-labels-a11y-confidence; PR pending.
```
