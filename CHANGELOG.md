# Changelog

All notable changes to GridSplit Studio are recorded here.

The project is currently evolving from the original GridSplit contact-sheet extractor into a local-first audio/video production studio. Entries distinguish documentation and audit work from implemented runtime functionality.

## [Unreleased]

### Added
- M01 repository audit documentation in `ARCHITECTURE.md`.
- Milestone checklist in `docs/CHECKPOINTS.md`.
- Audited baseline, capability gaps, and validation state in `docs/PROJECT_STATUS.md`.

### Verified
- Latest GitHub Actions build for the audited `main` HEAD passed dependency installation, TypeScript type-check, and Vite production build on 2026-11-09.

### Not changed
- No application source code, dependencies, extraction behavior, or deployment configuration changed in this audit commit.
- No audio/video studio feature is claimed as implemented.

## M02 — Product requirements
- Added `PRODUCT_REQUIREMENTS.md` v1.0.0 with stable requirement IDs and priorities.
- Added functional, privacy, platform, timing, recovery, accessibility, and release acceptance criteria.
- M02 is a requirements baseline only; no new runtime feature is claimed.

## M03 — Architecture and processing design
- Updated `ARCHITECTURE.md` with accepted web/desktop host boundaries, versioned project contract, rational media timebase, local storage, TTS provider and renderer interfaces.
- Added `docs/decisions/ADRs.md` with five accepted architectural decisions.
- Recorded current upstream licensing findings and release gates. Kokoro ONNX is an evaluation candidate only; Piper/eSpeak NG are not default-bundled.
- No TTS engine, voice pack, model, FFmpeg binary, or native runtime was added.

## M04 — Repository restructuring
- Moved the current extractor screen to `src/features/image-extraction/ImageExtractionApp.tsx`; retained `src/App.tsx` as the application composition entry.
- Added initial v1 domain contracts in `src/domain/project.ts` and rational media-time utilities in `src/domain/time.ts`.
- Preserved the existing detector, crop editing, and ZIP exporter code paths.
- Initial CI caught a stale relative type import after the move; corrected it in `488de1e`. The corrected Node 22 typecheck and production build passed.

## M05 — CI/CD and automated validation
- Added `package-lock.json` (npm lockfile v3) and switched CI to clean `npm ci` installs with npm cache.
- Added ESLint configuration and a `lint` script.
- Added Vitest coverage for rational time math, project schema-version handling, and GridSplit detector invariants.
- GitHub Actions run #15 passed: lint, 3 test files / 11 tests, TypeScript typecheck, production build, and artifact upload.
- Added a commit-specific `dist/` artifact with 14-day retention. Production deployment remains deferred to M35.

## M12–M16 — Character and local audio workflow (CI #98 passed; local model smoke test pending)

### Added
- Stable narrator and dialogue character records with voice, language, and speed preferences.
- Engine-independent provider interfaces and WAV sample metadata validation.
- Optional Kokoro ONNX loopback sidecar; user-supplied model and voice files remain outside the repository.
- Per-block narration/dialogue generation, cancellation, retry/regenerate, fingerprint reconciliation, and IndexedDB WAV persistence.
- Native browser audio preview, sample-derived duration display, and individual WAV download.
- Unit tests for WAV metadata, loopback endpoint privacy, character stability, segment reconciliation, copied-project reference remapping, and interrupted-generation recovery.
- GitHub Actions run #98: lint, 42 tests across 9 files, TypeScript typecheck, production build, Python sidecar syntax compilation, and artifact upload all passed.

### Boundaries
- No cloud TTS fallback or bundled/downloaded model weights.
- Real sidecar synthesis is not claimed until run with user-installed weights and matching voice files.
- Word alignment, subtitles, timeline duration correction, mixing, and video rendering remain later milestones.
