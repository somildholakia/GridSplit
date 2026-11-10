# GridSplit Studio — Project Status

**Last updated:** 2026-11-10  
**Repository:** `somildholakia/GridSplit`  
**Active branch:** `main`  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

## Current checkpoint

**M04 complete — initial feature/domain restructuring committed and CI-verified.** M01–M03 remain complete.

The existing GridSplit repository was audited before runtime code changes. Repository metadata, source tree, application entry points, image detector, ZIP exporter, styling, package scripts, TypeScript configuration, license, GitHub Actions workflow, and previous project notes were inspected.

This completion applies only to M01. It does not claim that the original extractor's sample export or browser workflow has been manually validated.

## Repository baseline

- Public GitHub repository with push/admin permissions available to the project maintainer.
- Only one branch was listed during the audit: `main`.
- Existing license: MIT.
- Existing frontend: React 18 + TypeScript + Vite.
- Existing dependencies: React, React DOM, JSZip, and lucide-react.
- No backend, cloud processing API, or model dependency exists in the audited source.
- No test files, test runner, or test script were present in the audited tree.
- No package lockfile was present in the audited tree.

See [ARCHITECTURE.md](../ARCHITECTURE.md) for the detailed baseline and proposed migration boundaries.

## Existing functionality confirmed by source inspection

- Browser-local contact-sheet upload and image decoding.
- Canvas-based pixel/luminance analysis.
- Horizontal row-band detection and independent per-row vertical boundary analysis.
- Tile gallery with include/exclude controls.
- Per-tile horizontal midpoint split and merge-with-next actions.
- Uniform rows/columns fallback grid.
- Adjustable crop border trim.
- Sequential PNG crop generation and JSZip export.
- CSV crop manifest and ZIP README.
- Responsive dark interface and local-only processing design.

## Validation evidence

### GitHub Actions

The latest workflow run for the audited HEAD was successful on 2026-11-09. The Node 22 workflow completed:
- `npm install`
- `npm run typecheck`
- `npm run build`

This is CI evidence for the checked-in TypeScript/Vite build only. The feature-boundary refactor was validated by the Node 22 GitHub Actions typecheck and production build. Browser interaction, manual crop correctness, ZIP inspection, and the complete audio/video workflow have not been independently validated.

The workflow history also includes an earlier failed run for a prior commit; the latest run on the current audited HEAD is successful.

### Sample contact sheet

The existing `docs/SAMPLE_ANALYSIS.md` records a 1536 × 864 sheet, 13 image-bearing bands, and approximately 210 preliminary crop regions against a desired 196. The target of 196 individual images remains unverified and must not be marked complete until the TypeScript implementation is run against the actual source sheet and the exported ZIP is inspected.

## Key gaps before the full studio vision

- Single image/contact-sheet session only; no batch or folder upload.
- No script editor or deterministic script/scene parser.
- No project library, persistent project schema, or restoration.
- No character/speaker manager or offline TTS engine.
- No segment-level audio generation or actual audio-duration metadata.
- No trusted word alignment, timeline metadata engine, or subtitle generation.
- No scene/image mapping or automatic synchronization.
- No multitrack timeline editor, waveform view, or mixing.
- No FFmpeg/WebAssembly/native renderer or MP4 export.
- No full production ZIP or end-to-end automated tests.

## Milestone state

- **M01:** Complete — repository audit recorded.
- **M02:** Complete — `PRODUCT_REQUIREMENTS.md` v1.0.0 committed.
- **M03:** Complete — architecture and processing decisions recorded.
- **M04:** Complete — extractor moved behind a feature boundary; initial domain project/time contracts added; corrected Node 22 CI passed.
- **M05–M36:** Not started.

The detailed acceptance checklist is maintained in [docs/CHECKPOINTS.md](CHECKPOINTS.md).

## Immediate next step

M05: add automated tests for the exact timebase and existing grid detector, then strengthen CI to run tests, typecheck, production build, and publish build artifacts.

## Operating rules

- Preserve the existing extractor and keep source assets on-device.
- No paid APIs, mandatory subscriptions, or usage-based cloud processing.
- Verify every engine, model, voice, and bundled asset license before adoption.
- Keep the project schema and export package portable and versioned.
- Record real test results; never infer success from code or mock screens.
- Update the status, checkpoint list, architecture, and changelog as implementation progresses.
