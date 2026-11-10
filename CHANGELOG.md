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
