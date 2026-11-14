# Map onboarding spotlight — 2026-11-14

Review branch: [`codex/map-onboarding-spotlight`](https://github.com/phatdat220707/voices-of-the-north/tree/codex/map-onboarding-spotlight),
based on integrated candidate `6debeccca987913e5ec675ac8fd461afe1a12a19`.
These changes have not been merged into GitHub main or deployed.

## Design and scope

The user's screenshot identifies three defects in the centered text card: no
visual connection to controls, obscured map content, and no learning by doing.
The matching [design page](https://docs.google.com/document/d/14FC-HMG4XN_1__UsnZWDY3Oc1w0eP-351RwGAsLaifo/edit?tab=t.6znejljex2md)
and [supporting map specification](https://docs.google.com/document/d/14FC-HMG4XN_1__UsnZWDY3Oc1w0eP-351RwGAsLaifo/edit?tab=t.qutef1v930ql)
were read. The existing onboarding module was adapted to the current map
implementation rather than copying the specification's older Leaflet example.

- Three steps: map, story-type chips, then era slider.
- A real SVG cutout, dashed arrow and edge card connect each prompt to its target.
- The highlighted controls remain clickable and keyboard accessible. Map
  zoom/drag, a type selection, and an era selection can advance the guide.
- Back, Next, Skip, Escape, seen-once storage and the existing replay button remain.
- Traditional Chinese, Simplified Chinese and English use short prompts.
- Layout updates on resizing, scrolling and target changes. Short portrait
  screens reserve room for the card by reducing the exposed map strip. Below
  440px of overlay height, the guide pauses without a scrim or blocked background;
  increasing the height resumes the same step without marking it completed.
- Map failure points to the existing list control. Opening a story or changing
  routes ends the guide without stealing focus from the destination.

No map camera/filter reset, permission, publication or retrieval behavior was
changed by this task. The integration candidate's previously reported P1/P2
findings are outside this change.

## Validation

- `python -X utf8 tools/build_frontend.py`: passed, 14-story corpus validated.
- `python -X utf8 tools/check_frontend_syntax.py`: passed, 1/1 bundled script parsed.
- `python -X utf8 tools/verify/light_onboarding.py --static`: 25 checks passed.
  The existing browser-test definitions were updated for the new step order,
  real-control progression and map-failure title. Their Playwright browser mode
  was not run; browser acceptance below used CUA instead.
- Independent Node fake-DOM checks covered focus, keyboard controls, timers,
  target rerendering, routes, list/map fallback, and pause/resume. These checks
  do not validate rendering or a screen reader.
- Real CUA browser acceptance on a loopback frontend server: default 1280×720
  viewport (430px app), 390×844 and 320×568; English at 320px; Simplified Chinese
  at extra-large text; 844×390 short-screen pause and return to the original step.
- Clicked real map zoom, then a real type chip: each advanced the guide. Pressed
  ArrowRight on the actual era slider: the filter changed and the guide finished
  with focus left on the slider. Reload did not show the guide again.
- Verified Back, replay, Skip and Escape; Escape restored replay-button focus.
  Tab from the card reached the real highlighted type chip.

The frontend server deliberately had no API; its offline status is expected.
Live map tiles and controls rendered during testing. This is not production,
backend, live Supabase, or full assistive-technology acceptance. The temporary
server was stopped and the browser viewport override was cleared afterward.

## Repeat the main acceptance flow

1. Build, serve `frontend`, and open `voices-of-the-north-app.html#stories`.
2. Use a fresh browser origin for the automatic first run, or tap the map's `?`.
3. Check the map cutout and arrow. Zoom or drag the exposed map to advance.
4. Click a highlighted type chip. Confirm filtering and automatic era-step entry.
5. Drag the era slider, press its arrow key, or tap a year. Confirm filtering and
   completion. Reload and confirm the guide stays closed; `?` must replay it.
6. Repeat at 320px and with English/extra-large text. Resize to a short window:
   the guide should pause, then resume the same step when height is restored.

## Screenshots

- [Final type guide, 390px](final-type-390.jpg)
- [Final era guide, 390px](final-era-390.jpg)
- [Type guide, 320px](mobile-type-320.jpg)
- [English era guide, 320px](english-era-320.jpg)
- [Simplified Chinese, extra-large text](simplified-large-map-390.jpg)
- [Short landscape pause](short-landscape-paused.jpg)
