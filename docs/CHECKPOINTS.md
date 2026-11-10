# GridSplit Studio — Development Checkpoints

**Last updated:** 2026-11-10  
**Audited baseline branch:** `main` (M01–M05)  
**Active implementation branch:** `feat/m06-m11-studio-script-workflow` (M06–M25 scope)  
**Open draft PR:** https://github.com/somildholakia/GridSplit/pull/1  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

A milestone is complete only when its implementation exists, required tests or validation pass, and the evidence is recorded in `docs/PROJECT_STATUS.md`. Planning, mock UI, untested code, and documentation alone do not complete implementation milestones.

## Milestones

- [x] **M01 — Audit existing GridSplit repository.** Read-only source, repository, license, CI, and capability audit completed; baseline recorded. The outstanding 196-image sample export is not claimed as verified.
- [x] **M02 — Update product requirements.** Added `PRODUCT_REQUIREMENTS.md` v1.0.0 with stable requirement IDs, priorities, local-first/security rules, and release acceptance criteria.
- [x] **M03 — Architecture and processing design.** Recorded shared web/optional Tauri architecture, versioned project schema, sample/rational timebases, local storage, TTS/render adapters, and upstream license gates in `ARCHITECTURE.md` and `docs/decisions/ADRs.md`.
- [x] **M04 — Repository restructuring.** Moved the existing extractor screen under `src/features/image-extraction/`, kept `src/App.tsx` as the composition entry, and added v1 project/time domain types. Node 22 typecheck and production build passed on the corrected commit.
- [x] **M05 — CI/CD.** Added a committed npm lockfile and `npm ci`, ESLint, Vitest unit tests, TypeScript typecheck, production build, and a 14-day commit-specific static build artifact. GitHub Actions run #15 passed all steps. Production deployment remains deferred to M35.
- [x] **M06 — Design system.** Added studio design tokens, reusable `StudioButton` and `StudioPanelHeader` components, workspace navigation, and responsive behavior.
- [x] **M07 — Dashboard.** Added project statistics, searchable project cards, active/archive views, and create/open/delete/backup actions.
- [x] **M08 — Project management.** Implemented local create/rename/duplicate/archive/restore/autosave plus versioned JSON backup import/export.
- [x] **M09 — Script editor.** Supports paste, TXT, local DOCX, and selectable-text PDF import with original-source preservation. PDF.js and its worker are bundled locally. OCR for scanned PDFs is explicitly out of scope.
- [x] **M10 — Deterministic script parser.** Parses chapter/scene headings, paragraphs, narration, character, SFX, and music directives; source-line tracking is tested.
- [x] **M11 — Scene segmentation.** Added editable chapter/scene labels and blocks, scene/block reordering, cross-scene block moves, split/merge controls, and add/remove actions.
- [x] **M12 — Character management.** Stable narrator/dialogue identities and per-character voice/language/speed; covered by CI.
- [x] **M13 — Offline TTS provider abstraction.** Provider contracts, health/voice catalog, cancellation, WAV metadata parsing, and loopback privacy tests are covered by CI.
- [ ] **M14 — Local TTS integration.** Optional loopback-only Kokoro ONNX sidecar is implemented. Real model/voice synthesis smoke test remains.
- [ ] **M15 — Segment generation.** Per-block fingerprints, generation lifecycle, recovery, and IndexedDB WAV storage are implemented. Live synthesis against an installed model remains to be exercised.
- [ ] **M16 — Audio preview.** Native local playback, sample-derived duration, and WAV download are implemented. A real model-generated WAV must still be played and reviewed on a target device.
- [x] **M17 — Actual duration measurement.** Re-reads local WAV headers and derives exact rational duration from actual sample count/sample rate.
- [x] **M18 — Synchronization metadata engine.** Deterministic versioned sync JSON with rational segment/scene timing from measured WAV samples.
- [x] **M19 — Subtitle generation.** Segment-level SRT/VTT export from measured timings; no word-level alignment is invented.
- [x] **M20 — Preserve and improve GridSplit.** Existing detector/export flow retained; flat-image fallback and even-grid regression fixtures protect existing behavior.
- [x] **M21 — Multi-image upload.** Multi-file/folder selection, natural folder/filename ordering, duplicate/type/size validation, removable queue, batch cap, and local ordered ZIP/CSV export.
- [ ] **M22 — Image sequence management.** Implemented on the feature branch: project-local original image blobs and metadata, thumbnail previews, frame numbering correction, visual reorder, gap/duplicate/unnumbered review, and safe shared-blob cleanup. Automated validation is awaiting the latest CI rerun.
- [ ] **M23 — Scene-to-image mapping.** Implemented many-to-many mapping, normalization, stale-reference cleanup, project persistence, and duplicate-project scene remapping. Automated validation is awaiting the latest CI rerun.
- [ ] **M24 — Automatic synchronization.** Implemented schedule creation from measured local WAV sample durations, evenly distributed image spans, and missing audio/image warnings. Automated validation is awaiting the latest CI rerun.
- [ ] **M25 — Timeline editor.** Implemented visual image/audio lanes, ruler, playhead preview, seek/play/pause/stop, clip start/duration editing, position nudges, and browser Web Audio scheduling for local WAV segments. Automated validation is awaiting the latest CI rerun.
- [ ] **M26 — Audio mixing.** Support narration, dialogue, music, SFX, levels, mute/solo, and fades.
- [ ] **M27 — Transitions and image effects.** Implement transitions and pan/zoom/Ken Burns effects.
- [ ] **M28 — FFmpeg rendering.** Integrate local browser/native rendering with progress and recoverable jobs.
- [ ] **M29 — MP4 export.** Validate required resolution, FPS, video/audio codecs, and aspect ratios.
- [ ] **M30 — Complete ZIP export.** Package final media, source assets, metadata, subtitles, and README.
- [ ] **M31 — Project restoration.** Reopen an exported project and restore editable state.
- [ ] **M32 — Integration testing.** Test the script-to-render workflow end to end.
- [ ] **M33 — Performance optimization.** Profile large scripts, images, models, timelines, and renders.
- [ ] **M34 — Security and privacy review.** Verify local-only behavior, file handling, cleanup, dependency safety, and asset/model licenses.
- [ ] **M35 — Production deployment.** Deploy the static frontend without making hosted processing mandatory.
- [ ] **M36 — End-to-end validation.** Complete and inspect a representative exported production package.

## Current branch validation

M06–M21 have earlier passing CI evidence in draft PR #1. M22–M25 implementation is now committed on the same feature branch but remains unchecked until the latest full CI run passes. The latest known run #154 exposed an older test that attempted to move a video clip onto an audio track, contrary to the helper's same-media-track rule; the test was corrected to move between compatible audio tracks, and a clean rerun is pending. Previous passing baseline: run #131 (58 tests across 12 files, lint, typecheck, production build, sidecar syntax, artifact upload): https://github.com/somildholakia/GridSplit/actions/runs/42817826847.

The additional M17–M19 tests cover sub-second SRT/VTT cue boundaries. The additional M21 tests cover natural ordering across nested folder paths and the 500-image cap. These are automated tests, not a substitute for visual acceptance of a real contact sheet.

M09 is complete for selectable-text PDFs. Scanned/image-only PDF OCR is not included. Vercel deployment attempts have intermittently hit the free-tier daily deployment quota; this is separate from passing GitHub CI. Interactive browser QA remains unverified because the preview requires Vercel Authentication. The previously recorded 196-image sample sheet is also still unverified; no manual pass is claimed.

## Completion evidence template

For every milestone, record:
- Implementation commit(s) and changed paths
- Tests/commands actually executed
- Test outcomes, including failures
- Manual validation performed and exact sample inputs
- Known limitations and deferred work
- License/privacy review where assets or engines are introduced

Do not check a box until all required evidence is available.

## M22–M25 implementation and validation

Implementation notes and current manual acceptance gaps are in [docs/M22-M25.md](M22-M25.md). The live timeline uses project-local second-based clip positions; the separate rational-time timeline helper is not yet the live editor's canonical storage format. The timeline preview schedules saved narration/dialogue WAV segments in the browser and does not mix music/SFX or render video. JSON backups keep image metadata but do not include IndexedDB media blobs.

Manual browser review of image import, mapping persistence, playback/seek, actual WAV synchronization, and the 196-image contact sheet remains open. M14–M16 also remain open for real Kokoro model/voice generate → playback → download acceptance.

## M12–M16 implementation and validation

Detailed implementation and setup instructions are in [docs/M12-M16.md](M12-M16.md), [docs/M17-M19.md](M17-M19.md), and [docs/M20-M21.md](M20-M21.md). M12–M13 satisfy their automated completion evidence. M14–M16 implementation is committed and browser CI passes, but their checkboxes remain open pending a real local model/voice generate → playback → WAV-download smoke test. M17–M21 have automated implementation and CI evidence from run #131.
