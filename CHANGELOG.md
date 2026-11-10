# Changelog

All notable changes to GridSplit Studio are recorded here.

The project is evolving from the original GridSplit contact-sheet extractor into a local-first audio/video production studio. Entries distinguish documentation and audit work from implemented runtime functionality.

## [Unreleased]

### Added
- M01 repository audit documentation in `ARCHITECTURE.md`.
- Milestone checklist in `docs/CHECKPOINTS.md`.
- Audited baseline, capability gaps, and validation state in `docs/PROJECT_STATUS.md`.

### Verified
- GitHub Actions run #15 passed dependency installation, lint, 11 tests, TypeScript typecheck, Vite production build, and static artifact upload.
- M06–M11 studio implementation and the M12–M16 local audio workflow are recorded in the feature-branch history and detailed milestone notes.

### Delivery boundary
- CI build artifacts are downloadable static web builds, not production deployments.
- Real Kokoro model/voice synthesis, playback, and WAV download remain a target-device acceptance test.
- No model, voice pack, TTS binary, FFmpeg binary, or native desktop runtime is bundled.

## M02 — Product requirements
- Added `PRODUCT_REQUIREMENTS.md` v1.0.0 with stable requirement IDs and priorities.
- Added functional, privacy, platform, timing, recovery, accessibility, and release acceptance criteria.
- M02 is a requirements baseline only; no new runtime feature is claimed.

## M03 — Architecture and processing design
- Updated `ARCHITECTURE.md` with accepted web/desktop host boundaries, versioned project contract, rational media timebase, local storage, TTS provider, and renderer interfaces.
- Added `docs/decisions/ADRs.md` with accepted architectural decisions.
- Recorded upstream licensing findings and release gates; no TTS engine, voice pack, model, FFmpeg binary, or native runtime was added.

## M04 — Repository restructuring
- Moved the current extractor screen to `src/features/image-extraction/ImageExtractionApp.tsx`; retained `src/App.tsx` as the application composition entry.
- Added initial v1 domain contracts and rational media-time utilities.
- Preserved the existing detector, crop editing, and ZIP exporter code paths.

## M05 — CI/CD and automated validation
- Added `package-lock.json`, clean `npm ci` installs, ESLint, Vitest, TypeScript typecheck, production build, and static build-artifact upload.
- GitHub Actions run #15 passed: 3 test files / 11 tests, lint, typecheck, production build, and artifact upload.
- Production deployment remains deferred to M35.

## M12–M16 — Character and local audio workflow
- Added stable narrator/dialogue character records with voice, language, and speed preferences.
- Added engine-independent provider interfaces and an optional loopback-only Kokoro ONNX sidecar.
- Added per-block generation, cancellation, retry/regenerate, fingerprint reconciliation, and IndexedDB WAV persistence.
- Added native browser audio preview, sample-derived duration display, and individual WAV download.
- **Acceptance pending:** no real model/voice synthesis → playback → download cycle has yet been verified on a target device.

## M17–M19 — Measured timing and subtitles
- Added WAV-header remeasurement from locally stored audio blobs and exact rational sample-derived durations.
- Added versioned deterministic `gridsplit.sync` JSON with scene and segment timing.
- Added segment-level SRT and WebVTT export; word-level alignment is not claimed.
- Added regression coverage for exact sample-derived accumulation and sub-second subtitle cue boundaries.

## M22–M25 — Project images, scene mapping, measured schedule, and timeline

- Added IndexedDB-backed project image storage, generated thumbnails, sequence-number correction, manual order controls, and issue review for gaps, repeated frame numbers, identical content, and unnumbered files.
- Added safe shared-image handling so duplicated projects can retain the same source image blobs without deleting media still referenced elsewhere.
- Added validated project image metadata, many-to-many scene mappings, and correct scene/mapping/clip remapping when projects are duplicated.
- Added image/audio schedule construction from measured WAV durations and visible missing-media warnings.
- Added a visual two-track timeline, ruler, playhead, current-frame preview, seek/play/pause/stop, clip start/duration editing, nudging, and local Web Audio scheduling of speech segments.
- Added automated coverage for sequence parsing/review, mapping normalization, time-to-image selection, schedule distribution, project schema validation, and production-project duplication.
- GitHub Actions run #182 passed: lint, 76 tests across 15 files, typecheck, production build, optional Python sidecar syntax check, and static artifact upload. [Run #182](https://github.com/somildholakia/GridSplit/actions/runs/42826679257).
- Manual browser playback and real model WAV validation remain open. The live timeline still stores second-based positions; mixing, transitions, effects, MP4 rendering, and media-inclusive portable packaging remain later milestones.

## M20–M21 — Extractor regression and image intake
- Added flat-image fallback and uniform-grid boundary regression fixtures while retaining the existing detector/export flow.
- Added multi-file and browser-supported folder intake, natural relative-path ordering, duplicate/type/size validation, and a removable intake queue.
- Added a 500-image batch cap and local ordered ZIP/CSV source bundle.
- Added regression tests for nested-folder natural sorting and the documented batch limit.
- GitHub Actions run #131 passed lint, 58 tests across 12 files, typecheck, production build, Python sidecar syntax check, and artifact upload.
- The 196-image contact-sheet sample remains unverified; no manual review pass is claimed.
- GitHub Actions run #131 passed on the feature branch: lint, 58 tests across 12 files, typecheck, production build, optional Python sidecar syntax check, and static artifact upload. [Run details](https://github.com/somildholakia/GridSplit/actions/runs/42817826847).


## M26–M31 — Mixing, effects, local rendering and portable projects

- Added independent narration, dialogue, music and SFX mix tracks with persisted levels, mute/solo and fade automation, plus local music/SFX import and Web Audio mix preview.
- Added per-image transition and motion-effect settings, stored against clip IDs for local rendering.
- Added an optional Python FFmpeg sidecar that binds to loopback, checks exact browser Origin/Host, verifies ZIP paths and SHA-256 checksums, reports jobs/progress and supports cancellation.
- Added H.264/AAC MP4 output profiles and ffprobe validation for container, codecs, dimensions, frame rate and duration.
- Added media-inclusive .gridsplit.zip export: editable project metadata, original images, ready speech WAVs, music/SFX, sample-derived synchronization JSON, SRT/VTT subtitles, README and SHA-256 manifest.
- Added archive restoration with project/scene/block/asset/segment/track/clip ID remapping; imported media is stored locally and the source project remains untouched.
- Added audio-mix/profile/effect unit tests, archive safety/checksum tests, and a real FFmpeg transition + audio-mix render fixture to CI. GitHub Actions run #195 passed: 6 Python tests, 89 Vitest tests across 17 files, lint, typecheck, production build and static artifact upload. [Run #195](https://github.com/somildholakia/GridSplit/actions/runs/42854525430).
- The local FFmpeg executable and codecs are user-installed and not bundled. Target-device browser/renderer acceptance remains separate.


## M32–M34 — Integration, performance and security baseline

- Added a script-to-timeline integration test covering scene parsing, sample-derived synchronization, SRT/VTT captions, scene/image mapping and production timeline creation.
- Added a loopback HTTP integration test that uploads a manifest-validated project ZIP, submits and polls a local render job, then downloads and verifies the generated H.264/AAC MP4.
- Added a 500-scene/500-image/1,000-clip performance regression with a 10-second CI ceiling.
- Limited simultaneous local render jobs to two and bounded finished-job retention to eight results/six hours, with temporary-directory pruning.
- Added local TTS Host-header validation and regression tests. CI now audits production npm dependencies; run #199 passed with 0 vulnerabilities at the configured high-severity threshold.
- GitHub Actions run #199 passed 9 Python tests, 91 Vitest tests across 18 files, ESLint, typecheck, Vite build, production npm audit and static artifact upload. [Run #199](https://github.com/somildholakia/GridSplit/actions/runs/42858412750).
- Production deployment (M35), real target-device Kokoro/timeline acceptance (M14–M16 and M22–M25), and inspection of a full package exported from the browser using representative media (M36) remain open.
