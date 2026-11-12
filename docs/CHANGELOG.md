# Changelog

## 2026-11-12 — M37 browser animation and batch audio

- PR #22 merged browser-based still-image animation with six motion presets, 3–60 second image duration, selected/all-sequence export, MP4 where supported and WebM fallback.
- Animation recorder chunks stream to OPFS where supported; browsers without OPFS use an in-memory fallback. Long recordings remain real-time.
- Added sequential Audio Studio batch generation with progress/cancellation; ready audio is skipped and music/SFX are excluded from TTS.
- Expanded parser cue recognition and raised the Production Studio project image cap to 1,200.
- PR CI #43184510763 and post-merge main CI #43185852867 passed. Secondary production deployment `gridsplit-studio.vercel.app` is READY.
- Real Kokoro generation/playback and M36 media export/restore/re-render remain open.

## 2026-11-10 — 196-image ZIP export regression

- Added `src/lib/exportZip.test.ts` to validate exactly 196 uniquely numbered PNG archive entries, 197 manifest lines, representative crop coordinates, one draw/encode per selection, and safe filename-prefix sanitization.
- Recorded the original 1536 × 864 contact-sheet reference probe: 13 image rows and 210 candidate regions. The exact 196 browser-crop result still requires manual correction and visual acceptance; mocked-canvas export tests do not verify pixel content.
- CI run #232 passed the complete workflow, including the new regression, typecheck, security/sidecar checks, FFmpeg integration, and production build.
- PR #9 updated local TTS/renderer setup instructions for the deployed frontend origin. The latest main source is merged, but Vercel currently rejects a new deployment due to its free daily deployment quota (HTTP 402).

## 2026-11-10 — Production UI acceptance and local sidecar setup

- Recorded a second public production UI acceptance sweep with 16 passing checks across script parsing, image sequence and mapping states, timeline prerequisites, mixing, effects, render profiles, and ZIP export/restore controls. Real media operations remain unverified.
- Corrected the Audio Studio setup link to point to the current `main/local-tts` directory rather than an obsolete feature branch.
- Clarified how to use the public Vercel frontend with strictly loopback-only Kokoro and FFmpeg sidecars by allowlisting the exact production origin. Updated the in-app setup instructions and sidecar READMEs; no remote renderer or cloud TTS was introduced.

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
