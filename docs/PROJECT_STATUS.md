# GridSplit Studio — Project Status

**Last updated:** 2026-11-10  
**Repository:** `somildholakia/GridSplit`  
**Active branch:** `main`  
**M05 verified implementation commit:** `8aa1d3e986bbbc36366b74856f1fc2b298f8ab3a`  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

## Current checkpoint

**M05 complete — CI/CD and automated validation baseline committed and passing.**

M01–M05 are complete. The existing GridSplit extractor has been retained and moved behind a feature boundary. Product requirements, architecture/processing decisions, initial project/time domain types, automated unit tests, and a clean-install CI pipeline are now in the repository.

## Milestone state

- **M01:** Complete — repository audit recorded.
- **M02:** Complete — `PRODUCT_REQUIREMENTS.md` v1.0.0 committed.
- **M03:** Complete — architecture, data/timing, storage, processing-host, renderer, and license decisions recorded.
- **M04:** Complete — extractor screen moved to `src/features/image-extraction/ImageExtractionApp.tsx`; initial domain project/time types added; corrected Node 22 typecheck and build passed.
- **M05:** Complete — `package-lock.json`, `npm ci`, lint, unit tests, typecheck, production build, and workflow artifact delivery implemented and verified.
- **M06–M36:** Not started.

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
- No batch/folder image upload, script editor/parser, project library, offline TTS, audio generation, waveform, sync mapping, subtitle generation, multitrack editor, FFmpeg renderer, MP4 export, or complete production ZIP has been implemented yet.
- Current tests are domain/unit regression tests; browser integration and script-to-render integration tests remain future work.
- No model, voice pack, TTS binary, FFmpeg binary, or native desktop runtime has been bundled.

## Next step

**M06 — Design system.** Establish the production-studio design tokens, reusable components, navigation, and responsive behavior before introducing the dashboard and feature workspaces.

## Operating rules

- Preserve the working extractor and keep source assets on-device.
- No paid APIs, mandatory subscriptions, or usage-based cloud processing.
- Verify every engine, model, voice, codec, and bundled asset license before adoption.
- Keep project data and export packages portable and versioned.
- Record real test results; never infer success from code or mock screens.
- Update the status, checkpoint list, architecture, and changelog after each milestone.


## M06–M11 implementation in progress (PR #1)

**Branch:** `feat/m06-m11-studio-script-workflow`  
**Pull request:** https://github.com/somildholakia/GridSplit/pull/1  
**Head commit:** `59c2edee3fb4c3786f1af1febdd49ea550aed87d`

The current draft introduces the first usable studio slice:
- A responsive dark studio shell, workspace navigation, privacy messaging, and a preserved Image splitter entry point (`src/App.tsx`, `src/studio.css`).
- A dashboard with project listing, search, create/open/delete actions.
- Browser-local project persistence with create, rename, autosave, and restore on reload. Data remains in the browser's localStorage; it is not yet a portable project archive.
- A source script editor with paste and TXT import, explicit original-source preservation, and a 10 MB TXT limit.
- A deterministic parser for chapter/part headings, scene/sequence headings, Markdown headings, paragraphs, and the four supported marker forms: `[NARRATOR]`, `[CHARACTER: NAME]`, `[SFX: NAME]`, and `[MUSIC: NAME]`.
- Scene review with editable scene titles and add/remove scene actions, plus parser unit tests.

**Not yet complete:** M06 reusable component extraction/design-token audit; M08 duplicate/archive and safe project export/import; M09 DOCX/PDF extraction; M11 full manual paragraph/block reordering and boundary editing. The UI deliberately identifies TXT-only import rather than claiming DOCX/PDF support. Existing image extractor regression behavior still needs automated browser validation.

**Validation status:** the PR is draft. GitHub's combined commit status currently reports a Vercel check failure and no GitHub Actions workflow run is visible yet. No local lint, test, typecheck, or production-build run is claimed. Therefore M06–M11 remain unchecked in `docs/CHECKPOINTS.md` until validation and the remaining acceptance criteria are complete.
