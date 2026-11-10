# GridSplit Studio — Project Status

**Last updated:** 2026-11-10  
**Repository:** `somildholakia/GridSplit`  
**Baseline branch:** `main` (M01–M05)  
**Active development branch:** `feat/m06-m11-studio-script-workflow` (M06–M25)  
**Open pull request:** https://github.com/somildholakia/GridSplit/pull/1  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

## Current checkpoint

M01–M05 remain the verified baseline on `main`. The Studio implementation for M06–M25 is on the feature branch in draft PR #1 and has **not** been merged into `main`.

**Latest code validation: GitHub Actions run #182 passed on the current implementation head.** The workflow completed the optional Python sidecar syntax check, npm clean install, ESLint, **76 Vitest tests across 15 files**, TypeScript typecheck, Vite production build, and static artifact upload. [Open run #182](https://github.com/somildholakia/GridSplit/actions/runs/42826679257).

## Milestone state

- **M01–M05:** Complete on `main` — repository audit, product requirements, architecture/ADRs, source restructuring, and CI baseline.
- **M06:** Complete on PR #1 — design tokens, reusable studio components, responsive workspace navigation.
- **M07:** Complete on PR #1 — dashboard, statistics, project search, active/archive views, project actions.
- **M08:** Complete on PR #1 — local project create/rename/duplicate/archive/restore, autosave, validated versioned JSON backups.
- **M09:** Complete on PR #1 for paste, TXT, DOCX, and selectable-text PDF import. Scanned/image-only PDF OCR is not included.
- **M10:** Complete on PR #1 — deterministic chapter/scene/paragraph parser with narration, dialogue, SFX, and music markers.
- **M11:** Complete on PR #1 — editable scenes/blocks, reorder, cross-scene moves, split, merge, add, and remove.
- **M12:** Complete on PR #1 — stable narrator/dialogue identities and per-character voice/language/speed.
- **M13:** Complete on PR #1 — local TTS provider contract, voice/health checks, abortable requests, WAV metadata parsing, and loopback endpoint guard.
- **M14:** Implemented; real Kokoro ONNX model/voice synthesis smoke test remains pending.
- **M15:** Implemented; live generation with an installed model remains pending.
- **M16:** Implemented; real generated WAV playback and download review remains pending.
- **M17:** Complete on PR #1 — read stored WAV headers and derive duration from real sample frames/sample rate.
- **M18:** Complete on PR #1 — deterministic versioned synchronization JSON with rational segment and scene timing.
- **M19:** Complete on PR #1 — segment-level SRT/VTT export from measured timing, without invented word alignment.
- **M20:** Complete on PR #1 — flat-image fallback and even-grid boundary regression fixtures; original detector/crop/export behavior retained. The 196-image sample remains unverified.
- **M21:** Complete on PR #1 — multi-file/folder intake, natural relative-path ordering, duplicate/type/size validation, 500-image cap, removable queue, and local ordered ZIP/CSV bundle.
- **M22:** Complete on PR #1 — project-local image assets and thumbnails, 500-image project cap, frame-number correction, manual order, gap/duplicate/unnumbered review, IndexedDB originals, and shared-asset-safe cleanup.
- **M23:** Complete on PR #1 — many-to-many scene/image mapping, normalization, persistence, and duplicate-project reference remapping.
- **M24:** Complete on PR #1 — rebuildable image/audio schedule using actual WAV sample-derived durations and explicit missing-media warnings.
- **M25:** Complete on PR #1 — visual image/audio timeline, time ruler, playhead, image preview, seek/play/pause/stop, clip start/duration editing, nudging, and Web Audio scheduling of locally saved speech segments. Manual browser playback review remains open.
- **M26–M36:** Not started.

The detailed acceptance checklist is maintained in [docs/CHECKPOINTS.md](CHECKPOINTS.md).

## Validation and delivery boundaries

GitHub Actions run #182 passed on the current implementation head: **15 test files / 76 tests passed**, plus lint, typecheck, production build, optional Python sidecar syntax check, and static artifact upload. [Run #182](https://github.com/somildholakia/GridSplit/actions/runs/42826679257). Lint, typecheck, production build, optional sidecar syntax check, and artifact upload also passed. The static web artifact is a CI build output; it is not a production deployment.

The Vercel status check on the current PR head reports a deployment failure due to the free-tier daily deployment quota. This is separate from the passing GitHub CI workflow. Interactive browser QA also remains unverified because a preview requires Vercel Authentication. No end-to-end browser acceptance pass is claimed. The 196-image contact-sheet sample and its preliminary region count are not treated as verified output.

## Local-first and scope constraints

- Project data and generated audio remain in browser-local storage/IndexedDB.
- The optional Kokoro sidecar is loopback-only and expects the user to install compatible model and voice files; weights are not bundled.
- No paid APIs, mandatory subscriptions, or usage-based cloud media processing are required.
- Folder selection is progressive enhancement; multi-file selection remains available.
- M21 exports the selected original images with an ordered manifest. M22 adds project-local image assets, IndexedDB originals, thumbnails, sequence review and correction. M23 adds scene mapping. JSON backups preserve image metadata but do not bundle IndexedDB image binaries; the portable media archive remains M30.
- M17–M19 provide segment-level timing and captions; word/phoneme alignment is not claimed.
- M25 provides editable image/audio lanes and synchronized local speech playback. Music/SFX mixing, levels, mute/solo, fades, transitions, image effects, FFmpeg rendering, MP4 export, media-inclusive project ZIP export, and end-to-end production validation remain later milestones.

## Next development milestone

**M26 — Audio mixing:** introduce independent narration/dialogue/music/SFX lanes with track levels, mute/solo, and fades. M22–M25 code and CI acceptance are complete; the manual browser smoke test documented in [docs/M22-M25.md](M22-M25.md) remains a release-acceptance task. The separate M14–M16 device acceptance test remains open until real model/voice files are installed and a generate → playback → WAV-download cycle is verified.

## Operating rules

- Preserve the working extractor and keep source assets on-device.
- Verify every engine, model, voice, codec, and bundled asset license before adoption.
- Keep project data and export packages portable and versioned.
- Record real test results; never infer success from code or mock screens.
- Update the status, checkpoint list, architecture, and changelog after each milestone.
