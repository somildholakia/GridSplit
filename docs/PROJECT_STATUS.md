# GridSplit Studio — Project Status

**Last updated:** 2026-11-12  
**Repository:** `somildholakia/GridSplit`  
**Main branch:** `main` — application code commit `e30fba7e363eb786c972fb01be9b439f22ad10c1`. The secondary Vercel production project `gridsplit-studio` serves this exact commit.  
**Latest release record:** PR #22 — browser image animation, batch audio generation, and expanded script classification  
**Merged pull request:** https://github.com/somildholakia/GridSplit/pull/22  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

## Current checkpoint

**M37 — browser image animation and production workflow improvements are implemented, merged, validated, and deployed.** PR #22 added a browser-only Image Animation Studio, sequential “Generate all remaining” speech generation with progress/cancellation, and broader deterministic script cue detection. Music and sound-effect blocks are excluded from the speech queue. Production image-sequence imports now allow up to 1,200 project images.

**Validation:** PR-branch CI run [#43184510763](https://github.com/somildholakia/GridSplit/actions/runs/43184510763) passed the dependency audits, Python sidecar checks, ESLint, Vitest, TypeScript typecheck, production build and static artifact upload. Post-merge main CI run [#43185852867](https://github.com/somildholakia/GridSplit/actions/runs/43185852867) also passed on merge commit `e30fba7e363eb786c972fb01be9b439f22ad10c1`.

**Production deployment:** the secondary Vercel account's `gridsplit-studio` project is `READY` at [https://gridsplit-studio.vercel.app](https://gridsplit-studio.vercel.app), deployment `dpl_5VXNM3wSoDumaV5RtjNMpsmE6y8Q`, serving merge commit `e30fba7e`. The public root returned HTTP 200, and the served JavaScript bundle contains the new batch-audio, image-animation, 1,200-image-cap and parser-cue code. The separate legacy `gridsplit-kappa.vercel.app` project is not asserted to have been updated by this deployment.

**Remaining release gates:** M14–M16 still need a real Kokoro model/voice synthesis → playback → WAV-download test. M36 still needs a representative target-device/browser media workflow: actual image import and timeline review, local FFmpeg/ffprobe render, browser-generated portable archive export, restore and re-render. GitHub CI fixtures do not substitute for those device-specific steps.

## Milestone state

- **M01–M05:** Complete on `main` — repository audit, product requirements, architecture/ADRs, source restructuring, and CI baseline.
- **M06:** Complete on main (merged via PR #1) — design tokens, reusable studio components, responsive workspace navigation.
- **M07:** Complete on main (merged via PR #1) — dashboard, statistics, project search, active/archive views, project actions.
- **M08:** Complete on main (merged via PR #1) — local project create/rename/duplicate/archive/restore, autosave, validated versioned JSON backups.
- **M09:** Complete on main (merged via PR #1) for paste, TXT, DOCX, and selectable-text PDF import. Scanned/image-only PDF OCR is not included.
- **M10:** Complete on main — deterministic chapter/scene/paragraph parsing now recognises narrator/voiceover, screenplay speaker labels, bracketed stage directions, music/BGM/score and SFX/foley/ambience markers. Ordinary prose that merely mentions music or sound remains narration; parser regression tests cover the supported cues.
- **M11:** Complete on main (merged via PR #1) — editable scenes/blocks, reorder, cross-scene moves, split, merge, add, and remove.
- **M12:** Complete on main (merged via PR #1) — stable narrator/dialogue identities and per-character voice/language/speed.
- **M13:** Complete on main (merged via PR #1) — local TTS provider contract, voice/health checks, abortable requests, WAV metadata parsing, and loopback endpoint guard.
- **M14:** Implemented; real Kokoro ONNX model/voice synthesis smoke test remains pending.
- **M15:** Implemented; live generation with an installed model remains pending.
- **M16:** Implemented; sequential batch generation with progress, stop/cancel, ready-segment skipping and retry is available. Real generation with an installed model, playback and WAV download remain pending.
- **M17:** Complete on main (merged via PR #1) — read stored WAV headers and derive duration from real sample frames/sample rate.
- **M18:** Complete on main (merged via PR #1) — deterministic versioned synchronization JSON with rational segment and scene timing.
- **M19:** Complete on main (merged via PR #1) — segment-level SRT/VTT export from measured timing, without invented word alignment.
- **M20:** Complete on main (merged via PR #1) — flat-image fallback and even-grid boundary regression fixtures; original detector/crop/export behavior retained. The 196-image sample remains unverified.
- **M21:** Complete on main (merged via PR #1) — multi-file/folder intake, natural relative-path ordering, duplicate/type/size validation, 500-image cap, removable queue, and local ordered ZIP/CSV bundle.
- **M22:** Complete on main — project-local image assets and thumbnails, IndexedDB originals, sequence correction/reorder and gap/duplicate/unnumbered review. The project import cap is now 1,200 images; the separate M21 intake queue retains its own 500-file batch cap.
- **M23:** Complete on main (merged via PR #1) — many-to-many scene/image mapping, normalization, persistence, and duplicate-project reference remapping.
- **M24:** Complete on main (merged via PR #1) — rebuildable image/audio schedule using actual WAV sample-derived durations and explicit missing-media warnings.
- **M25:** Complete on main (merged via PR #1) — visual image/audio timeline, time ruler, playhead, image preview, seek/play/pause/stop, clip start/duration editing, nudging, and Web Audio scheduling of locally saved speech segments. Manual browser playback review remains open.
- **M26:** Complete on main (merged via PR #1) — four local narration/dialogue/music/SFX mix tracks, persisted levels, mute/solo/fades, local music/SFX assets and Web Audio preview; automated validation passed in CI run #195.
- **M27:** Complete on main (merged via PR #1) — per-image transitions and static/Ken Burns/pan/zoom effects persist by timeline clip ID and are consumed by the renderer; automated render fixture passed in run #195.
- **M28:** Complete on main (merged via PR #1) — loopback-only Python renderer with exact-origin/Host checks, archive validation, progress and cancellation; Python syntax, archive and render tests passed in run #195.
- **M29:** Complete on main (merged via PR #1) — aspect-ratio profiles and local H.264/AAC MP4 export with ffprobe validation; real FFmpeg/ffprobe fixture passed in run #195.
- **M30:** Complete on main (merged via PR #1) — media-inclusive portable ZIP with editable project, source images, generated speech, imported music/SFX, checksums, synchronization JSON and SRT/VTT; validation passed in run #195.
- **M31:** Complete on main (merged via PR #1) — archive verification and new-project restore with ID/reference remapping and rollback of failed media writes; automated validation passed in run #195.
- **M32:** Automated integration slice complete — script/sync/subtitle/mapping/timeline test and HTTP ZIP-to-MP4 local render test passed in run #199. Full browser-driven project export is still M36.
- **M33:** Performance regression baseline complete — 500 scenes, 500 images, 1,000 clips under a 10-second test ceiling; renderer bounded to two active jobs/eight retained finished jobs. Real target-device/media profiling is still open.
- **M34:** Complete on `main` via PR #3 (merge commit `e080b90eae670f0983840750fb41a7f08759717a`). The security review documents the renderer/TTS threat boundaries, loopback Host/Origin checks, archive validation and local storage. The optional TTS sidecar now has a committed cross-platform `local-tts/uv.lock` for Python 3.10–3.13, pinned `uv` 0.13.5 and development-only `pip-audit` 2.10.1; CI validates the lock with `uv lock --check` and scans the synchronized environment with `pip-audit --strict`. Runs #217 and #224 passed with no known Python dependency vulnerabilities plus the Python, frontend and build suites. Exact provenance/licenses of user-installed model/voice/phonemizer/FFmpeg assets remain external release checks.
- **M35:** Production deployment is READY on the secondary Vercel account at [gridsplit-studio.vercel.app](https://gridsplit-studio.vercel.app), project `gridsplit-studio`, deployment `dpl_5VXNM3wSoDumaV5RtjNMpsmE6y8Q`, serving main commit `e30fba7e`. Public root returned HTTP 200. This updates the secondary project; the separate legacy `gridsplit-kappa.vercel.app` deployment is not asserted to be on the same commit.
- **M36:** Open — the SHA-256-gated 209-candidate/196-selected sample preset is deployed with current main, but actual browser export and pixel review remain unverified. Real Kokoro audio generation/playback, target-browser image/timeline synchronization, local FFmpeg MP4 output, media-inclusive ZIP inspection, archive restore and re-render remain required.
- **M37:** Complete on main via PR #22 — browser Image Animation Studio (six camera-motion presets; selected-image or ordered-project export; MP4 where browser-supported, WebM fallback; chunked OPFS output where available), sequential batch TTS generation, expanded deterministic audio cue classification, and a 1,200-image project import cap. PR CI #43184510763 and post-merge main CI #43185852867 passed.

The detailed acceptance checklist is maintained in [docs/CHECKPOINTS.md](CHECKPOINTS.md).

## Validation and delivery boundaries

GitHub Actions run #199 validated the M06–M34 implementation before merge. PR #10's run #232 subsequently passed the exporter regression together with the Python security/sidecar checks, FFmpeg integration, npm audit, lint, unit tests, typecheck and production build. On the Python-dependency PR branch, run #217 additionally passed committed-lock validation (`uv lock --check`), `pip-audit --strict` (no known vulnerabilities found), 9 Python tests, ESLint, 91 Vitest tests across 18 files, TypeScript typecheck, Vite build and artifact upload. [Run #217](https://github.com/somildholakia/GridSplit/actions/runs/42865601179). The production frontend is live at `gridsplit-kappa.vercel.app`. Its smoke test verified the core dashboard, script parser, Audio Studio shell and Production Studio shell; it does not establish real Kokoro synthesis, media rendering, image-sequence acceptance or complete project export/restore.

The CI result verifies code and fixtures on GitHub's runner. The 196-entry ZIP test uses mocked canvas output and verifies archive naming/manifest integrity only. The exact `1000277512.png` contact sheet has now been visually reviewed: the overlay shows 209 candidates (15 / 16 × 11 / 18), and PR #17 excludes 13 non-story panels to select 196. CI run #254 passed the corrected helper tests and full workflow. An independent diagnostic ZIP contains 196 decodable PNGs but is not an export from the app. Browser export/pixel review remains open. A real-media target-device acceptance pass with Kokoro-generated WAVs, imported music/SFX and the user's installed FFmpeg/ffprobe also remains open.

## Local-first and scope constraints

- Project data and generated audio remain in browser-local storage/IndexedDB.
- The optional Kokoro sidecar is loopback-only and expects the user to install compatible model and voice files; weights are not bundled.
- No paid APIs, mandatory subscriptions, or usage-based cloud media processing are required.
- Folder selection is progressive enhancement; multi-file selection remains available.
- M21 exports the selected original images with an ordered manifest. M22 adds project-local image assets, IndexedDB originals, thumbnails, sequence review and correction. M23 adds scene mapping. JSON backups preserve image metadata but do not bundle IndexedDB image binaries; the portable media archive remains M30.
- M17–M19 provide segment-level timing and captions; word/phoneme alignment is not claimed.
- M25 provides editable image/audio lanes and synchronized local speech playback. M26–M31 add local mixing, transitions/effects, FFmpeg/MP4 rendering, media-inclusive project ZIP export and restore. M32–M34 add automated integration/performance regressions and the application security review. CI run #199 and Python-lock runs #217/#224 validate the baseline automated scope; run #254 validates the corrected 196-crop selection. Production deployment and the public dashboard/script/audio/production-shell smoke test are complete; real target-device media acceptance and full browser-generated package inspection remain open.

## Current next steps

The secondary M35 production deployment is live at `gridsplit-studio.vercel.app` on main commit `e30fba7e`. The next release gates are target-device real Kokoro synthesis/playback/download and M36's end-to-end media acceptance: import the sample, verify actual image/timeline playback, render with local FFmpeg/ffprobe, export the browser-generated media archive, restore it, and re-render. These require the user's installed local model/voice files and FFmpeg/ffprobe; setup is documented in [local-tts/README.md](../local-tts/README.md) and [local-render/README.md](../local-render/README.md).

## Operating rules

- Preserve the working extractor and keep source assets on-device.
- Verify every engine, model, voice, codec, and bundled asset license before adoption.
- Keep project data and export packages portable and versioned.
- Record real test results; never infer success from code or mock screens.
- Update the status, checkpoint list, architecture, and changelog after each milestone.
