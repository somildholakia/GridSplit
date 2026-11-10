# GridSplit Studio — Development Checkpoints

**Last updated:** 2026-11-10  
**Main branch:** `main` — M01–M34 implementation merged via PR #1  
**Release work branch:** `chore/reconcile-release-status` (documentation reconciliation)  
**Merged implementation PR:** https://github.com/somildholakia/GridSplit/pull/1  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

A milestone is complete only when its implementation exists, required tests or validation pass, and the evidence is recorded in `docs/PROJECT_STATUS.md`. Planning, mock UI, untested code, and documentation alone do not complete implementation milestones. The M26–M31 checkboxes record implementation plus automated CI evidence; target-device and real-model acceptance gaps are listed separately and are not implied by those checks.

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
- [x] **M22 — Image sequence management.** Project-local original image blobs and metadata, thumbnail previews, 500-image project cap, frame-number correction, visual reorder, gap/duplicate/unnumbered review, and safe shared-blob cleanup. Automated CI passed.
- [x] **M23 — Scene-to-image mapping.** Many-to-many mapping, normalization, stale-reference cleanup, project persistence, and duplicate-project scene remapping. Automated CI passed.
- [x] **M24 — Automatic synchronization.** Schedule creation from measured local WAV sample durations, evenly distributed image spans, and missing audio/image warnings. Automated CI passed.
- [x] **M25 — Timeline editor.** Visual image/audio lanes, ruler, playhead preview, seek/play/pause/stop, clip start/duration editing, position nudges, and browser Web Audio scheduling for local WAV segments. Automated CI passed; real-browser playback review remains a manual acceptance step.
- [x] **M26 — Audio mixing.** Four independent local narration/dialogue/music/SFX tracks; persisted gain, mute/solo and fade settings; local music/SFX import and Web Audio preview. CI run #195 passed mix/domain tests.
- [x] **M27 — Transitions and image effects.** Per-image cut/fade/dissolve/wipe transitions and static/Ken Burns/pan/zoom presets persist against timeline clip IDs and are consumed by the local renderer. CI render fixture passed in run #195.
- [x] **M28 — FFmpeg rendering.** Optional Python sidecar binds to loopback, enforces exact Origin/Host checks, validates the portable archive, reports render progress and supports cancellation. Python syntax/archive/render tests passed in run #195.
- [x] **M29 — MP4 export.** Landscape/portrait/square profiles; local H.264/AAC render; ffprobe checks container, codecs, dimensions, frame rate and duration. The real FFmpeg fixture passed in run #195.
- [x] **M30 — Complete ZIP export.** Media-inclusive versioned archive with editable project data, original images, ready speech WAVs, music/SFX, sample-derived sync JSON, SRT/VTT, README and SHA-256 manifest. Archive validation and export/restore unit tests passed in run #195.
- [x] **M31 — Project restoration.** Local ZIP restore validates paths, sizes and checksums, stores media in IndexedDB, remaps project/scene/block/image/segment/track/clip IDs and creates a separate project. Remapping and archive tests passed in run #195.
- [x] **M32 — Integration testing (automated slice).** Added a script → parsed scenes → measured synchronization → captions → scene/image map → production timeline test, plus a real HTTP archive upload → FFmpeg job → MP4 download test. GitHub Actions run #199 passed both suites. Browser-driven export from a real project remains in M36.
- [x] **M33 — Performance regression baseline.** Added a 500-scene / 500-image / 1,000-clip construction smoke test with a 10-second regression ceiling and bounded renderer concurrency/retention (2 active jobs; 8 finished jobs retained for up to 6 hours). Run #199 passed. Real image decoding, local model inference and target-device render profiling remain manual.
- [x] **M34 — Application security and privacy review.** Recorded the renderer/TTS threat boundaries, loopback Host/Origin checks, archive validation, bounded job retention, local storage and license boundaries in [SECURITY_REVIEW.md](SECURITY_REVIEW.md). Added TTS Host-header regression tests and `npm audit --omit=dev --audit-level=high`; run #199 passed with 0 production npm vulnerabilities. User-installed Python packages, model/voice files and FFmpeg builds remain outside the repository's redistribution scope and need exact-version review before bundling.
- [ ] **M35 — Production deployment.** Deploy the static frontend without making hosted processing mandatory.
- [ ] **M36 — End-to-end validation.** Complete and inspect a representative exported production package.

## Current main-branch validation

M06–M34 automated implementation is merged into `main` by PR #1 at commit `0f6bb317508f028627d02bcece7b414598438399` (2026-11-10 16:57:47 UTC). **GitHub Actions run #199 passed on commit `0ba72cc6cf2b8fc3b00d446612f44ab0ec0f9491`:** Python sidecar compilation, **9 Python tests** (2 TTS Host-validation tests and 7 renderer tests, including HTTP upload → FFmpeg render → MP4 download), ESLint, **91 Vitest tests across 18 files**, TypeScript typecheck, Vite production build, static artifact upload, and `npm audit --omit=dev --audit-level=high` (**0 production npm vulnerabilities**). [Open run #199](https://github.com/somildholakia/GridSplit/actions/runs/42858412750). Run #195 remains the earlier M26–M31 implementation validation baseline; run #131 remains the historical M17–M21 baseline.

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

Implementation and automated validation for M22–M25 are merged into `main` (run #182 is the recorded pre-merge evidence). Implementation notes and current manual acceptance gaps are in [docs/M22-M25.md](M22-M25.md). The live timeline uses project-local second-based clip positions; the separate rational-time timeline helper is not yet the live editor's canonical storage format. The timeline preview schedules saved narration/dialogue WAV segments in the browser and does not mix music/SFX or render video. JSON backups keep image metadata but do not include IndexedDB media blobs.

Manual browser review of image import, mapping persistence, playback/seek, actual WAV synchronization, and the 196-image contact sheet remains open. M14–M16 also remain open for real Kokoro model/voice generate → playback → download acceptance.

## M26–M31 implementation and validation

All six milestones are implemented and merged into `main`; the CI workflow passed in run #195 on the pre-merge feature revision. The workflow compiled both Python sidecars, passed 6 Python tests (including a real FFmpeg/ffprobe transition + audio-mix render), passed ESLint and 89 Vitest tests across 17 files, completed TypeScript typecheck and the Vite production build, and uploaded the static artifact. The checkboxes above record this automated completion. A target-device browser run with the user's installed FFmpeg/ffprobe, actual project media and local Kokoro models remains a separate release acceptance task. See [docs/M26-M31.md](M26-M31.md).

## M12–M16 implementation and validation

Detailed implementation and setup instructions are in [docs/M12-M16.md](M12-M16.md), [docs/M17-M19.md](M17-M19.md), and [docs/M20-M21.md](M20-M21.md). M12–M13 satisfy their automated completion evidence. M14–M16 implementation is committed and browser CI passes, but their checkboxes remain open pending a real local model/voice generate → playback → WAV-download smoke test. M17–M21 have automated implementation and CI evidence from run #131.


## M32–M36 integration and release gates

M32's automated vertical slice now covers the deterministic script parser, measured sample-based sync, SRT/VTT captions, scene/image mapping and timeline construction. A separate Python HTTP integration test uploads a manifest-verified ZIP to the local renderer, polls the job, verifies H.264/AAC output and downloads the MP4. This exercises the renderer API end to end, but it is not a browser automation run through every React screen or a user-created project archive.

M33 adds a 500-scene, 500-image, 1,000-clip timeline performance regression test with a generous 10-second ceiling. The local renderer now limits simultaneous work to two jobs and prunes old completed jobs (eight retained, six-hour TTL) on subsequent API requests. These are regression controls, not device-specific benchmarks of 500 actual image blobs, TTS inference, or long-form MP4 rendering.

M34's code-scope review is documented in [SECURITY_REVIEW.md](SECURITY_REVIEW.md). The production JavaScript dependency audit reports zero vulnerabilities at the configured high-severity threshold. The TTS and render sidecars remain loopback-only and reject unexpected Host/Origin headers; archive validation and local job cleanup are tested. Python runtime dependency advisories and exact versions/licenses for user-installed models, voices, FFmpeg builds and codecs remain external release checks because those assets are not bundled.

M35 is still open: the merged main commit `0f6bb317` has not reached production. The current `gridsplit-kappa.vercel.app` production alias still points to the older M01–M05 deployment. Vercel rejected the production deployment attempt with HTTP 402 `api-deployments-free-per-day` after the Hobby team exceeded 100 deployments in 24 hours; Vercel advised retrying after 24 hours. No billing or plan settings were changed. M36 is still open: the HTTP test uses a deterministic minimal fixture, not a complete archive exported from the actual browser UI using a real script, generated Kokoro speech, numbered images, music/SFX, and target-device FFmpeg.

M14–M16 remain open for real local Kokoro model/voice generation → playback → WAV download. M22–M25 still require manual target-browser validation of image import, mapping persistence, preview/seek/audio synchronization, and the recorded 196-image contact-sheet sample. Do not treat automated CI or a preview HTTP 200 as proof of those acceptance checks.
