# GridSplit Studio — Project Status

**Last updated:** 2026-11-11  
**Repository:** `somildholakia/GridSplit`  
**Main branch:** `main` — latest application code commit `47570357900a123571a4959d47caafaa10ef348d`; deployed frontend runtime commit `9f43fc8dacebc4fdabdf77a7bbfc8d7719327cb6`. Documentation-only commits may advance `main` without changing application code.  
**Latest release record:** PR #11 — acceptance/deployment boundary  
**Merged pull request:** https://github.com/somildholakia/GridSplit/pull/1  
**Audited baseline:** `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

## Current checkpoint

**Visual refresh in progress:** branch `design/colourful-studio-ui` adds `src/theme.css` and loads it after the existing studio styles. It refreshes the complete application shell and all major workspaces with a colourful editorial palette, stronger hierarchy, accessible focus states and responsive layouts. The change is presentation-only; extraction, audio generation, project storage, timeline and export logic are unchanged. CI validation and review are pending; this branch has not been deployed.

Current application code on `main` is `47570357900a123571a4959d47caafaa10ef348d`. The deployed frontend runtime remains `9f43fc8dacebc4fdabdf77a7bbfc8d7719327cb6`; Vercel rejected the production deployment attempt for the earlier main build with HTTP 402 `api-deployments-free-per-day` and a 24-hour retry window. M01–M34 implementation, the Python TTS lock/audit, sidecar-origin corrections, local-media acceptance runner (PR #14), sample preset (PR #15), and corrected 209-to-196 candidate map (PR #17) are merged.

**Base Studio validation:** GitHub Actions run #199 passed on pre-merge commit `0ba72cc6cf2b8fc3b00d446612f44ab0ec0f9491`, including 9 Python tests, 91 Vitest tests across 18 files, ESLint, TypeScript typecheck, Vite production build, static artifact upload and production npm audit (0 vulnerabilities at the high-severity threshold). [Open run #199](https://github.com/somildholakia/GridSplit/actions/runs/42858412750). **Latest local-TTS dependency PR validation:** run #217 passed `uv lock --check`, `pip-audit --strict` (no known vulnerabilities found), 9 Python tests, 91 Vitest tests across 18 files, ESLint, typecheck, production build and artifact upload. [Open run #217](https://github.com/somildholakia/GridSplit/actions/runs/42865601179).

## Milestone state

- **M01–M05:** Complete on `main` — repository audit, product requirements, architecture/ADRs, source restructuring, and CI baseline.
- **M06:** Complete on main (merged via PR #1) — design tokens, reusable studio components, responsive workspace navigation.
- **M07:** Complete on main (merged via PR #1) — dashboard, statistics, project search, active/archive views, project actions.
- **M08:** Complete on main (merged via PR #1) — local project create/rename/duplicate/archive/restore, autosave, validated versioned JSON backups.
- **M09:** Complete on main (merged via PR #1) for paste, TXT, DOCX, and selectable-text PDF import. Scanned/image-only PDF OCR is not included.
- **M10:** Complete on main (merged via PR #1) — deterministic chapter/scene/paragraph parser with narration, dialogue, SFX, and music markers.
- **M11:** Complete on main (merged via PR #1) — editable scenes/blocks, reorder, cross-scene moves, split, merge, add, and remove.
- **M12:** Complete on main (merged via PR #1) — stable narrator/dialogue identities and per-character voice/language/speed.
- **M13:** Complete on main (merged via PR #1) — local TTS provider contract, voice/health checks, abortable requests, WAV metadata parsing, and loopback endpoint guard.
- **M14:** Implemented; real Kokoro ONNX model/voice synthesis smoke test remains pending.
- **M15:** Implemented; live generation with an installed model remains pending.
- **M16:** Implemented; real generated WAV playback and download review remains pending.
- **M17:** Complete on main (merged via PR #1) — read stored WAV headers and derive duration from real sample frames/sample rate.
- **M18:** Complete on main (merged via PR #1) — deterministic versioned synchronization JSON with rational segment and scene timing.
- **M19:** Complete on main (merged via PR #1) — segment-level SRT/VTT export from measured timing, without invented word alignment.
- **M20:** Complete on main (merged via PR #1) — flat-image fallback and even-grid boundary regression fixtures; original detector/crop/export behavior retained. The 196-image sample remains unverified.
- **M21:** Complete on main (merged via PR #1) — multi-file/folder intake, natural relative-path ordering, duplicate/type/size validation, 500-image cap, removable queue, and local ordered ZIP/CSV bundle.
- **M22:** Complete on main (merged via PR #1) — project-local image assets and thumbnails, 500-image project cap, frame-number correction, manual order, gap/duplicate/unnumbered review, IndexedDB originals, and shared-asset-safe cleanup.
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
- **M35:** Base production deployment is READY at [gridsplit-kappa.vercel.app](https://gridsplit-kappa.vercel.app) on frontend runtime commit `9f43fc8dacebc4fdabdf77a7bbfc8d7719327cb6` (deployment `dpl_6nTrXw6ySQMUr9V36tWicjNzoB36`). Current main `4757035` includes PR #14 local-media runner and PR #17 corrected 196-crop preset. The current main build is not live: Vercel rejected the earlier production request with HTTP 402 `api-deployments-free-per-day` and a 24-hour retry window. Public smoke test passed on the older runtime: dashboard access, four workspace navigations and two-scene script parsing. Local TTS and real media processing were not run. [Smoke test](https://agent.tinyfish.ai/runs/4fead7de-4604-4b7d-9af8-e54a6424a381) · [Preset CI #254](https://github.com/somildholakia/GridSplit/actions/runs/42888121310) · [post-merge main CI #255](https://github.com/somildholakia/GridSplit/actions/runs/42888303569).
- **M36:** Open — the exact sample now has a SHA-256-gated non-AI preset using 209 candidates and 13 exclusions to leave 196 selected crops. The preset is merged and CI-passed but is not deployed yet; browser export and pixel review remain unverified. The independent diagnostic ZIP is not an app export. Real Kokoro generation/playback, image/timeline playback, MP4 export, media-inclusive archive restore and re-render remain pending.

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

The base M35 deployment is live, but current main is not yet deployed because of Vercel's daily deployment quota. The next acceptance gates are deploying current main after the quota window, running `local-render/acceptance_check.py` on the target machine, then verifying the browser's 196-crop export, real image/timeline playback, and a browser MP4 export → archive restore → re-render pass. These require the user's installed local model/voice files and FFmpeg/ffprobe; setup is documented in [local-tts/README.md](../local-tts/README.md) and [local-render/README.md](../local-render/README.md).

## Operating rules

- Preserve the working extractor and keep source assets on-device.
- Verify every engine, model, voice, codec, and bundled asset license before adoption.
- Keep project data and export packages portable and versioned.
- Record real test results; never infer success from code or mock screens.
- Update the status, checkpoint list, architecture, and changelog after each milestone.
