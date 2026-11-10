# Changelog

## Unreleased — M17–M21 implementation and verification

- Added WAV-header remeasurement from locally stored audio blobs and exact rational sample-derived durations.
- Added versioned deterministic synchronization JSON with scene and segment timing.
- Added segment-level SRT and WebVTT export without claiming word alignment.
- Added sub-second subtitle timestamp regression coverage.
- Added extractor regression fixtures for flat-image fallback and even-grid boundaries.
- Added multi-file/folder image intake, natural relative-path ordering, duplicate/type/size validation, a 500-image batch cap, queue removal, and a local ZIP/CSV source bundle.
- Added regression coverage for nested-folder ordering and the batch cap.
- **GitHub Actions run #124 passed:** lint, 58 tests across 12 files, TypeScript typecheck, production build, optional Python sidecar syntax check, and static artifact upload.
- M14–M16 real-model Kokoro synthesis/playback/download acceptance remains pending; no manual runtime verification is implied by CI.
- The 196-image sample contact sheet remains unverified.
