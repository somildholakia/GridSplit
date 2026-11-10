# Changelog

## Unreleased — M22–M25 production workflow (verified by CI)

- Added WAV-header remeasurement from locally stored audio blobs and exact rational sample-derived durations.
- Added versioned deterministic synchronization JSON with scene and segment timing.
- Added segment-level SRT and WebVTT export without claiming word alignment.
- Added sub-second subtitle timestamp regression coverage.
- Added extractor regression fixtures for flat-image fallback and even-grid boundaries.
- Added multi-file/folder image intake, natural relative-path ordering, duplicate/type/size validation, a 500-image batch cap, queue removal, and a local ZIP/CSV source bundle.
- Added regression coverage for nested-folder ordering and the batch cap.
- **GitHub Actions run #131 passed:** lint, 58 tests across 12 files, TypeScript typecheck, production build, optional Python sidecar syntax check, and static artifact upload.
- Added project-local production image assets, IndexedDB original-image storage, local thumbnails, sequence numbering correction, order controls, gap/duplicate/unnumbered review, and shared-blob-safe cleanup.
- Added many-to-many scene/image mappings, normalization, persistent metadata, and project-duplication remapping.
- Added initial image/audio schedule creation from measured WAV durations with missing-media warnings.
- Added a visual image/audio timeline with a time ruler, playhead, frame preview, seek/play/pause/stop, editable clip positions/durations, nudging, and Web Audio playback of local speech segments.
- Added production model, project-store validation, schedule, image-boundary, and duplication tests.
- **GitHub Actions run #182 passed:** lint, 76 tests across 15 files, TypeScript typecheck, production build, optional Python sidecar syntax check, and static artifact upload. [Run #182](https://github.com/somildholakia/GridSplit/actions/runs/42826679257).
- Manual browser/audio acceptance remains open; this does not claim MP4 rendering, audio mixing, transitions, or media-inclusive archive export.
- M14–M16 real-model Kokoro synthesis/playback/download acceptance remains pending; no manual runtime verification is implied by CI.
- The 196-image sample contact sheet remains unverified. [Run #131](https://github.com/somildholakia/GridSplit/actions/runs/42817826847) passed the current feature-branch lint, tests, typecheck, production build, sidecar syntax check, and artifact upload.
