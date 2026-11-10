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

## M20–M21 — Extractor regression and image intake
- Added flat-image fallback and uniform-grid boundary regression fixtures while retaining the existing detector/export flow.
- Added multi-file and browser-supported folder intake, natural relative-path ordering, duplicate/type/size validation, and a removable intake queue.
- Added a 500-image batch cap and local ordered ZIP/CSV source bundle.
- Added regression tests for nested-folder natural sorting and the documented batch limit.
- GitHub Actions run #131 passed lint, 58 tests across 12 files, typecheck, production build, Python sidecar syntax check, and artifact upload.
- The 196-image contact-sheet sample remains unverified; no manual review pass is claimed.
- GitHub Actions run #131 passed on the feature branch: lint, 58 tests across 12 files, typecheck, production build, optional Python sidecar syntax check, and static artifact upload. [Run details](https://github.com/somildholakia/GridSplit/actions/runs/42817826847).
