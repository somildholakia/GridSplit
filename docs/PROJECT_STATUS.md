# GridSplit Studio — Project Status

**Last updated:** 2026-11-10  
**Repository:** `somildholakia/GridSplit`  
**Baseline branch:** `main` (M01–M05)  
**Active development branch:** `feat/m06-m11-studio-script-workflow` (M06–M34 automated scope)  
**Open pull request:** https://github.com/somildholakia/GridSplit/pull/1  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

## Current checkpoint

M01–M05 remain the verified baseline on `main`. The Studio implementation for M06–M31 is on the feature branch in draft PR #1 and has **not** been merged into `main`.

**Latest code validation: GitHub Actions run #199 passed on commit `0ba72cc6cf2b8fc3b00d446612f44ab0ec0f9491`.** The workflow compiled both Python sidecars, passed **9 Python tests** (including an HTTP upload → local FFmpeg render → MP4 download test), ESLint, **91 Vitest tests across 18 files**, TypeScript typecheck, Vite production build, static artifact upload and production npm dependency audit (**0 vulnerabilities at the high-severity threshold**). [Open run #199](https://github.com/somildholakia/GridSplit/actions/runs/42858412750).

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
- **M26:** Complete on the feature branch — four local narration/dialogue/music/SFX mix tracks, persisted levels, mute/solo/fades, local music/SFX assets and Web Audio preview; automated validation passed in CI run #195.
- **M27:** Complete on the feature branch — per-image transitions and static/Ken Burns/pan/zoom effects persist by timeline clip ID and are consumed by the renderer; automated render fixture passed in run #195.
- **M28:** Complete on the feature branch — loopback-only Python renderer with exact-origin/Host checks, archive validation, progress and cancellation; Python syntax, archive and render tests passed in run #195.
- **M29:** Complete on the feature branch — aspect-ratio profiles and local H.264/AAC MP4 export with ffprobe validation; real FFmpeg/ffprobe fixture passed in run #195.
- **M30:** Complete on the feature branch — media-inclusive portable ZIP with editable project, source images, generated speech, imported music/SFX, checksums, synchronization JSON and SRT/VTT; validation passed in run #195.
- **M31:** Complete on the feature branch — archive verification and new-project restore with ID/reference remapping and rollback of failed media writes; automated validation passed in run #195.
- **M32:** Automated integration slice complete — script/sync/subtitle/mapping/timeline test and HTTP ZIP-to-MP4 local render test passed in run #199. Full browser-driven project export is still M36.
- **M33:** Performance regression baseline complete — 500 scenes, 500 images, 1,000 clips under a 10-second test ceiling; renderer bounded to two active jobs/eight retained finished jobs. Real target-device/media profiling is still open.
- **M34:** Application security/privacy review documented in [SECURITY_REVIEW.md](SECURITY_REVIEW.md); Host/Origin/archive checks and 0-production-npm-vulnerability audit passed. Python dependency audit and exact licenses for externally installed model/voice/FFmpeg assets remain external release checks.
- **M35:** Open — feature preview is READY, but main still serves M01–M05 and PR #1 is still a draft/unmerged.
- **M36:** Open — no real browser-generated full project package has yet been produced and inspected on a target device.

The detailed acceptance checklist is maintained in [docs/CHECKPOINTS.md](CHECKPOINTS.md).

## Validation and delivery boundaries

GitHub Actions run #199 passed on the current feature-branch head: **9 Python tests** (including a real HTTP ZIP upload → local FFmpeg/ffprobe render → MP4 download), ESLint, **91 Vitest tests across 18 files**, TypeScript typecheck, Vite production build, static artifact upload, and npm production dependency audit (**0 vulnerabilities at the high-severity threshold**). [Run #199](https://github.com/somildholakia/GridSplit/actions/runs/42858412750). The static web artifact and Vercel preview are not a production release or proof of target-device compatibility.

The CI result verifies the code and smoke fixture on GitHub's runner. A user-device browser acceptance pass with representative images, generated Kokoro WAVs, imported music/SFX and the user's installed FFmpeg/ffprobe remains open. M14–M16 model/voice synthesis and M22–M25 real browser timeline/playback review also remain separate manual acceptance checks. The 196-image contact-sheet sample remains unverified; no manual pass is claimed.

## Local-first and scope constraints

- Project data and generated audio remain in browser-local storage/IndexedDB.
- The optional Kokoro sidecar is loopback-only and expects the user to install compatible model and voice files; weights are not bundled.
- No paid APIs, mandatory subscriptions, or usage-based cloud media processing are required.
- Folder selection is progressive enhancement; multi-file selection remains available.
- M21 exports the selected original images with an ordered manifest. M22 adds project-local image assets, IndexedDB originals, thumbnails, sequence review and correction. M23 adds scene mapping. JSON backups preserve image metadata but do not bundle IndexedDB image binaries; the portable media archive remains M30.
- M17–M19 provide segment-level timing and captions; word/phoneme alignment is not claimed.
- M25 provides editable image/audio lanes and synchronized local speech playback. M26–M31 add local mixing, transitions/effects, FFmpeg/MP4 rendering, media-inclusive project ZIP export and restore. M32–M34 add automated integration/performance regressions and the application security review. CI run #199 validates this automated scope; target-device acceptance, production promotion and full browser-generated package inspection remain open.

## Current next steps

M26–M34 automated implementation and CI validation are complete on the feature branch (run #199). M35 production promotion and M36 representative browser-generated package inspection remain open. Local renderer setup and target-device browser acceptance remain manual checks; install FFmpeg/ffprobe and run the sidecar using [local-render/README.md](../local-render/README.md). M22–M25 browser playback review and M14–M16 real Kokoro model/voice synthesis acceptance also remain open.

## Operating rules

- Preserve the working extractor and keep source assets on-device.
- Verify every engine, model, voice, codec, and bundled asset license before adoption.
- Keep project data and export packages portable and versioned.
- Record real test results; never infer success from code or mock screens.
- Update the status, checkpoint list, architecture, and changelog after each milestone.
