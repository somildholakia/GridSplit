# GridSplit Studio — Architecture Baseline

**Document status:** M01 repository-audit snapshot  
**Last reviewed:** 2026-11-10  
**Decision status:** Existing implementation documented; target architecture decisions remain open for M03.

## 1. Product direction

GridSplit Studio is intended to become a local-first production application that turns a script and a set of numbered images or a contact sheet into narrated, synchronized, editable video output.

The user's local machine is the processing environment. A hosted static frontend may distribute the interface, but scripts, images, voice generation, audio analysis, project data, and rendering must not depend on paid APIs or mandatory cloud services.

The supplied master project prompt is the product requirement source for the planned modules and milestones. This file records what exists today and proposes migration boundaries; it does not claim that the future modules have been implemented.

## 2. Audited repository baseline

- Repository: `somildholakia/GridSplit`
- Default branch: `main`
- Audited HEAD: `cfddbcfd22018da87002c93a8ebbdaaa229829cb`
- Existing license: MIT
- Frontend: React 18, TypeScript, Vite
- Styling: one application stylesheet with a responsive dark theme
- Archive generation: JSZip
- Icons: lucide-react
- Processing model: browser File API, object URLs, Canvas 2D, and client-side ZIP generation
- Backend/API: none in the audited source
- Automated test harness: not present in the audited tree
- Package lockfile: not present in the audited tree

### Existing source map

| Path | Current responsibility |
|---|---|
| `src/App.tsx` | Single-page extractor UI, upload lifecycle, crop state, manual correction actions, and ZIP download |
| `src/lib/detectGrid.ts` | Pixel-based horizontal row detection and per-row vertical boundary selection |
| `src/lib/exportZip.ts` | Canvas crop encoding, sequential PNG naming, CSV manifest, and ZIP packaging |
| `src/styles.css` | Application theme, layout, responsive rules, and extractor component styling |
| `src/main.tsx` | React entry point |
| `.github/workflows/build.yml` | Node 22 CI dependency install, TypeScript check, and production build |
| `docs/PROJECT_STATUS.md` | Previous project progress and known limitations |
| `docs/SAMPLE_ANALYSIS.md` | Preliminary analysis of one storyboard sheet |

## 3. Existing extraction data flow

1. The user selects or drops one image.
2. The browser creates an object URL and decodes the image.
3. Analysis uses a downscaled Canvas image, capped at 1800 × 1400 pixels.
4. `detectGrid.ts` calculates luminance/contrast projections, identifies horizontal bands, estimates per-row tile pitch, and selects likely vertical boundaries.
5. The app converts the resulting rectangles to crop cards.
6. The user can include/exclude a tile, split a tile at its midpoint, merge it with the next tile in the same row, or replace automatic boundaries with an evenly spaced fallback grid.
7. `exportZip.ts` draws selected rectangles to full-resolution canvases, encodes PNG blobs, and packages them with a CSV manifest and README using JSZip.
8. The browser downloads the ZIP.

The existing detector is traditional image processing, not semantic image understanding. Its output remains reviewable and manually correctable; it must not silently become a black box during the studio expansion.

## 4. Current capability boundary

### Present in the audited code

- One contact sheet per session
- Browser-local image decoding and analysis
- Row-aware grid detection
- Per-tile inclusion/exclusion
- Horizontal midpoint split and merge-with-next
- Uniform-grid fallback
- Border trim
- Configurable sequential filename prefix, start number, and zero padding
- PNG crop export and ZIP manifest

### Not present in the audited code

- Multi-file or folder image import
- Standalone image sequence library and duplicate/gap diagnostics
- Script upload, parsing, chapter/scene model, or speaker model
- TTS provider interface or offline voice engine
- Audio segment generation, preview, waveform, or duration metadata
- Timeline, image-to-scene mapping, subtitle engine, or synchronization engine
- FFmpeg/WebAssembly/native rendering
- Project persistence, restoration, or complete production ZIP
- Desktop shell
- Automated unit, integration, or browser tests

The sample investigation records a 1536 × 864 contact sheet, 13 candidate image rows, and approximately 210 preliminary regions against a desired 196. The sample count and final export are explicitly unverified.

## 5. Proposed migration boundaries (not yet implemented)

The expansion should evolve the existing application incrementally. Keep the detector and crop exporter usable while extracting their responsibilities from the monolithic screen.

A proposed modular layout for M03 to evaluate:

```text
src/
  app/                 application shell, routing, shared layout
  features/
    projects/          project lifecycle and local project library
    script/            source text, parsing, chapters, scenes
    characters/        speaker definitions and voice assignments
    audio/             provider abstraction, segment generation, preview
    images/            import, sequence management, contact-sheet extraction
    mapping/           scene/image relationships and warnings
    timeline/          tracks, edits, transitions, playback
    subtitles/         SRT/VTT and subtitle styling
    rendering/         render jobs, progress, resumability, export
  domain/              shared IDs, project schema, timebase, validation
  lib/
    detectGrid.ts      preserved and gradually isolated current detector
    exportZip.ts       preserved and gradually isolated current crop exporter
  workers/             CPU-heavy browser work where appropriate
```

This is a proposed boundary, not a required folder layout. M03 must settle module contracts and data ownership before broad restructuring.

### Key architectural principles

1. **Preserve working behavior.** Refactor the image extractor in place; do not replace it with static mock screens or discard existing crop logic.
2. **Separate domain logic from UI.** Script parsing, natural sorting, mapping, timeline calculation, metadata creation, and validation should be deterministic modules with tests.
3. **Keep project data portable.** Define a versioned project schema and explicit migration strategy. Store project metadata in IndexedDB and allow export/import as a portable archive.
4. **Keep assets local.** Images, audio, generated intermediates, and model files must remain on-device. Do not add a remote asset-processing service.
5. **Use adapters for processing engines.** TTS engines and renderers should sit behind capability-aware interfaces. A failed segment must be retryable without regenerating successful segments.
6. **Do not pretend the browser can run OS binaries.** A static browser deployment can use browser-compatible engines; access to native Piper/FFmpeg binaries requires an explicitly installed local runtime or optional desktop bridge such as Tauri.
7. **Use real media timebases.** Audio timing must derive from decoded sample counts/sample rates or trustworthy aligner output. Video timing must use an explicit FPS/timebase. Do not infer word timestamps from text length.
8. **Be honest about optional capabilities.** Voice pitch, word alignment, codecs, and rendering features should be exposed only when the installed engine supports them.
9. **Licenses are release gates.** Verify code, runtime, model, and voice licenses individually before bundling or redistributing them. Do not assume a model's license is the same as its runtime's license.
10. **Keep the core free.** No API keys, paid endpoints, subscriptions, or usage-based cloud work may be required for the complete local workflow.

## 6. Processing design questions for M03

These are open design decisions, not completed integrations:

- Which offline TTS engines and voice packages can be distributed or installed with acceptable licenses, platform coverage, and quality?
- Should browser-only TTS use a bundled WebAssembly runtime, a user-selected local model, or both?
- When should a Tauri desktop wrapper be offered to provide native process access, file handling, and reliable large renders?
- Which FFmpeg strategy is appropriate for browser projects versus desktop projects, including memory limits, codecs, and progress reporting?
- How will model acquisition and integrity verification work without mandatory cloud services?
- What is the canonical versioned project schema for scripts, scenes, speakers, media assets, edit decisions, and render settings?
- How will project autosave, crash recovery, and interrupted segment/render jobs be represented?
- What resource limits and cleanup policies prevent large projects from exhausting memory or disk?

No engine, voice, model, or binary is approved for redistribution by this audit.

## 7. Validation and quality gates

The existing GitHub Actions workflow uses Node 22 and currently runs `npm install`, `npm run typecheck`, and `npm run build`. The latest workflow run on the audited HEAD completed successfully on 2026-11-09.

That CI result verifies the checked-in TypeScript/Vite build path only. It does not verify browser interaction, image correctness, ZIP contents, audio generation, timing accuracy, rendering, large-project performance, or privacy behavior at runtime.

Future validation should add:
- Unit tests for pure domain algorithms and schema validation
- Fixture tests for image detection and crop geometry
- Adapter tests using local test doubles for TTS/render engines
- Timeline and subtitle tests driven by sample counts and frame timebases
- Browser tests for upload, correction, local storage, export, and project restoration
- End-to-end tests for a small complete local production
- License and privacy checks for shipped runtimes, models, and voices

## 8. Change policy

- Do not remove `src/lib/detectGrid.ts` or `src/lib/exportZip.ts` without replacement tests and explicit behavior parity.
- Do not mark a milestone complete from a design document or mock interface alone.
- Update `docs/PROJECT_STATUS.md`, `docs/CHECKPOINTS.md`, and `CHANGELOG.md` as work lands.
- Keep this architecture document synchronized when an implementation decision is actually made.
