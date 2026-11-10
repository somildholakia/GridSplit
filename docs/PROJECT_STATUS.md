# GridSplit Studio — Project Status

**Last updated:** 2026-11-10  
**Repository:** `somildholakia/GridSplit`  
**Baseline branch:** `main` (M01–M05)  
**Active development branch:** `feat/m06-m11-studio-script-workflow`  
**M05 verified implementation commit:** `8aa1d3e986bbbc36366b74856f1fc2b298f8ab3a`  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

## Current checkpoint

**M05 remains the verified `main` baseline. M06–M11 are implemented and CI-verified on PR #1.**

M01–M05 remain complete on `main`. The GridSplit Studio branch adds the production workspace, project management, script parsing, and manual scene editing while retaining the existing image extractor. The branch is not merged.

## Milestone state

- **M01:** Complete — repository audit recorded.
- **M02:** Complete — `PRODUCT_REQUIREMENTS.md` v1.0.0 committed.
- **M03:** Complete — architecture, data/timing, storage, processing-host, renderer, and license decisions recorded.
- **M04:** Complete — extractor screen moved to `src/features/image-extraction/ImageExtractionApp.tsx`; initial domain project/time types added; corrected Node 22 typecheck and build passed.
- **M05:** Complete — `package-lock.json`, `npm ci`, lint, unit tests, typecheck, production build, and workflow artifact delivery implemented and verified.
- **M06:** Complete on PR #1 — design tokens, reusable studio components, navigation, and responsive shell.
- **M07:** Complete on PR #1 — project dashboard, statistics, search, and project actions.
- **M08:** Complete on PR #1 — local project create/rename/duplicate/archive, autosave/restore, and versioned JSON backup import/export.
- **M09:** Complete on PR #1 — paste, TXT, DOCX, and selectable-text PDF import are implemented locally in the browser; PDF.js worker is bundled with the app. OCR for scanned PDFs is explicitly out of scope.
- **M10:** Complete on PR #1 — deterministic chapter/scene/paragraph parser with narration, dialogue, SFX, and music markers.
- **M11:** Complete on PR #1 — editable chapters/scenes/blocks, scene and block reordering, cross-scene moves, split, and merge controls.
- **M12–M36:** Not started.

The detailed acceptance checklist is maintained in [docs/CHECKPOINTS.md](CHECKPOINTS.md).

## M01 repository audit findings

The initial repository was a React 18 + TypeScript + Vite browser-only contact-sheet extractor, licensed MIT. It had no test runner, test script, or npm lockfile at the time of audit. Those gaps have now been addressed by M05 as described below.

The audited extractor already had:
- Browser-local contact-sheet upload and image decoding.
- Canvas-based pixel/luminance analysis.
- Horizontal row-band detection and independent per-row vertical boundary analysis.
- Tile gallery with include/exclude controls.
- Per-tile horizontal midpoint split and merge-with-next actions.
- Uniform rows/columns fallback grid and adjustable crop border trim.
- Sequential PNG crop generation, JSZip export, CSV manifest, and ZIP README.

## M04 source organization

- `src/App.tsx` remains the initial application composition entry.
- The original extractor UI now lives in `src/features/image-extraction/ImageExtractionApp.tsx`.
- Existing detector and exporter logic remain in `src/lib/detectGrid.ts` and `src/lib/exportZip.ts`.
- `src/domain/project.ts` defines the initial versioned v1 project contracts.
- `src/domain/time.ts` implements rational time helpers for sample- and frame-derived timing.

The original detector/exporter implementation was not rewritten as part of the move. The first CI run found one stale relative type import; it was corrected in commit `488de1e`, then typecheck and production build passed.

## M05 CI/CD and test evidence

**GitHub Actions run #15: successful.**  
[View complete workflow run](https://github.com/somildholakia/GridSplit/actions/runs/42775014351)

The successful workflow ran on Node.js 22 and performed:
1. `npm ci --no-audit --no-fund` from the committed npm lockfile.
2. `npm run lint`.
3. `npm test -- --reporter=verbose`.
4. `npm run typecheck`.
5. `npm run build`.
6. Uploaded the `dist/` web build as a commit-specific artifact with a 14-day retention period.

**Test result:** 3 test files passed; 11 tests passed.

Coverage currently includes:
- Rational-time normalization, exact sample-based duration, frame-based duration, addition, comparison, and invalid inputs.
- Supported project schema version gate.
- Existing GridSplit boundary helper invariants and a featureless-image fallback crop geometry.

The committed `package-lock.json` is lockfile version 3. CI uses `npm ci` with npm cache enabled. The workflow uses read-only repository permissions, runs on pushes and pull requests to `main`, supports manual dispatch, and cancels superseded runs on the same ref.

**Delivery boundary:** the CI build artifact is a downloadable static web build, not a production deployment. Production deployment remains M35 so the Studio's real workflow, privacy, runtime/model distribution, and release readiness can be validated first.

## Remaining unverified work and limitations

- The 196-image contact-sheet target in `docs/SAMPLE_ANALYSIS.md` remains unverified; its recorded ~210 preliminary regions are not a pass.
- No browser interaction or end-to-end crop/ZIP test has been run against the supplied 196-image sheet.
- No batch/folder image upload, offline TTS, audio generation, waveform, sync mapping, subtitle generation, multitrack editor, FFmpeg renderer, MP4 export, or complete production ZIP has been implemented yet. Script import supports paste, TXT, DOCX, and selectable-text PDF; scanned PDF OCR is not included.
- GitHub Actions run #65 passed lint, 30 unit tests across 6 files, TypeScript typecheck, production build, and static build-artifact upload. The Vercel preview deployment is Ready. A live browser smoke test was attempted but the preview is protected by Vercel Authentication, so interactive UI checks could not be completed without an authenticated browser profile. Image-extractor regression and script-to-render integration tests remain future work.
- No model, voice pack, TTS binary, FFmpeg binary, or native desktop runtime has been bundled.

## Next step

**M12 — Character management.** Add character records and stable voice assignments. M06–M11 implementation is complete on PR #1; preview UI verification is still blocked by Vercel Authentication.

## Operating rules

- Preserve the working extractor and keep source assets on-device.
- No paid APIs, mandatory subscriptions, or usage-based cloud processing.
- Verify every engine, model, voice, codec, and bundled asset license before adoption.
- Keep project data and export packages portable and versioned.
- Record real test results; never infer success from code or mock screens.
- Update the status, checkpoint list, architecture, and changelog after each milestone.


## M06–M11 implementation on PR #1

**Branch:** `feat/m06-m11-studio-script-workflow`  
**Pull request:** https://github.com/somildholakia/GridSplit/pull/1  
**Latest implementation head:** `57e407ce355679b5fc338648bcbb8c944ca4c6a9`  
**PR state:** open, draft, mergeable; not merged into `main`.

### Delivered

- **M06:** Added CSS design tokens, reusable `StudioButton` and `StudioPanelHeader` components, responsive workspace navigation, and a dark production-studio shell.
- **M07:** Added project dashboard, search, project statistics, create/open/delete, and active/archive views.
- **M08:** Added create/rename/duplicate/archive/restore, browser-local autosave, validated version-1 JSON backup import/export, and nested ID regeneration when importing copies.
- **M09:** Script paste, TXT import, local DOCX extraction, and local selectable-text PDF extraction are implemented. PDF.js 6.5.438 and its matching worker are bundled; scanned/image-only PDFs return an explicit OCR-not-included error. File size is limited to 10 MB and PDFs over 500 pages are rejected with guidance.
- **M10:** Deterministic parser recognises chapter/part headings, scene/sequence headings, Markdown headings, paragraphs, and `[NARRATOR]`, `[CHARACTER: NAME]`, `[SFX: NAME]`, and `[MUSIC: NAME]` markers. Source-line tracking is covered when paragraph text repeats.
- **M11:** Scene titles and chapter labels are editable; blocks can be edited, added, removed, reordered, and moved to an adjacent scene. Scenes can be reordered, split after a selected block, merged into the previous scene, added, or removed. The original full script remains stored separately from the editable breakdown.

### Validation evidence

**GitHub Actions run #65: successful.**  
[View workflow run](https://github.com/somildholakia/GridSplit/actions/runs/42784773000)

- `npm ci --no-audit --no-fund`: passed.
- `npm run lint`: passed.
- `npm test -- --reporter=verbose`: 6 test files and 30 tests passed, including selectable-text PDF extraction, scanned/text-free PDF handling, and invalid PDF input.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- Static `dist/` artifact upload: passed.
- Vercel preview status for the verified implementation head: success.

The first CI attempt exposed a TypeScript control-flow issue in the parser's chapter-heading branch. It was fixed in commit `8d9ef27`. Subsequent dependency/API and worker path issues during PDF.js integration were corrected; the current workflow passes. The PR remains a draft and has not been merged.

### Remaining gaps

- Scanned/image-only PDF OCR is not implemented; selectable text is extracted locally by PDF.js.
- DOCX extraction currently reads the primary document part; unusual Word features such as footnotes, tracked changes, and embedded text boxes are not yet included.
- Browser end-to-end tests have not been run for localStorage reload/restore, backup file selection, TXT/DOCX/PDF import in the UI, scene controls, or the preserved image extractor. A smoke-test attempt against the preview was blocked by Vercel Authentication; no UI test pass is claimed.
- No manual browser QA of the supplied 196-image contact sheet has been completed; the existing image-extractor behavior is retained but not yet regression-verified in a browser.

M06–M11 are checked in `docs/CHECKPOINTS.md` based on implementation and CI evidence. M09 automated tests cover DOCX extraction, PDF selectable-text extraction, text-free/scanned PDF handling, and invalid PDF input. Live UI validation remains blocked by Vercel Authentication.
