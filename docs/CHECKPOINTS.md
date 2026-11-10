# GridSplit Studio — Development Checkpoints

**Last updated:** 2026-11-10  
**Audited branch:** `main`  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

A milestone is complete only when its implementation exists, required tests or validation pass, and the evidence is recorded in `docs/PROJECT_STATUS.md`. Planning, mock UI, untested code, and documentation alone do not complete implementation milestones.

## Milestones

- [x] **M01 — Audit existing GridSplit repository.** Read-only source, repository, license, CI, and capability audit completed; baseline recorded. The outstanding 196-image sample export is not claimed as verified.
- [x] **M02 — Update product requirements.** Added `PRODUCT_REQUIREMENTS.md` v1.0.0 with stable requirement IDs, priorities, local-first/security rules, and release acceptance criteria.
- [x] **M03 — Architecture and processing design.** Recorded shared web/optional Tauri architecture, versioned project schema, sample/rational timebases, local storage, TTS/render adapters, and upstream license gates in `ARCHITECTURE.md` and `docs/decisions/ADRs.md`.
- [x] **M04 — Repository restructuring.** Moved the existing extractor screen under `src/features/image-extraction/`, kept `src/App.tsx` as the composition entry, and added v1 project/time domain types. Node 22 typecheck and production build passed on the corrected commit.
- [x] **M05 — CI/CD.** Added a committed npm lockfile and `npm ci`, ESLint, 11 Vitest unit tests, TypeScript typecheck, production build, and a 14-day commit-specific static build artifact. GitHub Actions run #15 passed all steps. Production deployment remains correctly deferred to M35.
- [ ] **M06 — Design system.** Establish the production-studio design tokens, reusable components, navigation, and responsive behavior.
- [ ] **M07 — Dashboard.** Implement the project dashboard.
- [ ] **M08 — Project management.** Create, rename, duplicate, archive, autosave, and restore projects locally.
- [ ] **M09 — Script editor.** Support paste, TXT, DOCX, and PDF text import with original-source preservation.
- [ ] **M10 — Deterministic script parser.** Parse narration, character, SFX, and music directives.
- [ ] **M11 — Scene segmentation.** Build and manually correct chapters, paragraphs, and scene boundaries.
- [ ] **M12 — Character management.** Manage speakers and stable voice assignments.
- [ ] **M13 — Offline TTS provider abstraction.** Define capability-aware local engine contracts.
- [ ] **M14 — Local TTS integration.** Integrate approved offline engines and voice packages with verified licenses.
- [ ] **M15 — Segment generation.** Generate/retry individual scene and dialogue segments with persisted status.
- [ ] **M16 — Audio preview.** Add playback, segment review, and regeneration controls.
- [ ] **M17 — Actual duration measurement.** Measure decoded audio durations using sample counts and sample rates.
- [ ] **M18 — Synchronization metadata engine.** Generate versioned timeline, scene mapping, and project metadata from real media timing.
- [ ] **M19 — Subtitle generation.** Generate SRT/VTT; support word timing only when alignment is trustworthy.
- [ ] **M20 — Preserve and improve GridSplit.** Retain existing detector/export behavior and add regression coverage before deeper editing.
- [ ] **M21 — Multi-image upload.** Support multi-file and folder selection where available.
- [ ] **M22 — Image sequence management.** Add natural sorting, duplicates/gaps, previews, and correction tools.
- [ ] **M23 — Scene-to-image mapping.** Support flexible one-to-many and many-to-one mappings.
- [ ] **M24 — Automatic synchronization.** Create and recalculate image/audio schedules with explicit warnings.
- [ ] **M25 — Timeline editor.** Implement editable multitrack timeline and playback.
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

## Completion evidence template

For every milestone, record:
- Implementation commit(s) and changed paths
- Tests/commands actually executed
- Test outcomes, including failures
- Manual validation performed and exact sample inputs
- Known limitations and deferred work
- License/privacy review where assets or engines are introduced

Do not check a box until all required evidence is available.
