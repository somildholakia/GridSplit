# Continuous Integration and Build Artifacts

**Workflow:** `.github/workflows/build.yml`  
**Runner:** GitHub Actions, Ubuntu, Node.js 22, Python 3  
**Pre-merge validation SHA:** `0ba72cc6cf2b8fc3b00d446612f44ab0ec0f9491`  
**Merged main SHA:** `0f6bb317508f028627d02bcece7b414598438399`

## Automated checks

For pull requests to `main`, pushes to `main`, and manual dispatch, CI:

1. Installs the locked JavaScript dependency graph with `npm ci`.
2. Installs FFmpeg for the deterministic local-render integration fixture.
3. Compiles the optional TTS and renderer Python sidecars.
4. Runs the TTS Host-header security tests and local renderer tests, including HTTP ZIP upload → FFmpeg render → MP4 download.
5. Audits production npm dependencies using `npm audit --omit=dev --audit-level=high`.
6. Runs ESLint, Vitest, TypeScript typecheck and the Vite production build.
7. Uploads the static `dist/` artifact for 14 days.

The workflow has read-only repository permissions, npm caching, and cancels superseded runs on the same ref.

## Latest verified run

**GitHub Actions run #199 passed** on pre-merge feature commit `0ba72cc6cf2b8fc3b00d446612f44ab0ec0f9491`. The implementation was subsequently merged into `main` at `0f6bb317508f028627d02bcece7b414598438399`; a separate post-merge run on that merge commit is not yet recorded.

- Python syntax compilation: passed for both sidecars.
- TTS security suite: **2 tests passed**.
- Renderer suite: **7 tests passed**, including a real local HTTP workflow using FFmpeg/ffprobe.
- Production npm dependency audit: **0 vulnerabilities** at the configured high-severity threshold.
- ESLint: passed.
- Vitest: **18 test files, 91 tests passed**.
- TypeScript typecheck: passed.
- Vite production build: passed.
- Static build artifact upload: passed.

[View GitHub Actions run #199](https://github.com/somildholakia/GridSplit/actions/runs/42858412750).

The performance regression test parses and schedules a 500-scene/500-image project with 1,000 timeline clips under a 10-second CI ceiling. This is a synthetic baseline, not a hardware benchmark of actual image blobs, local TTS model inference or long-form rendering.

## Delivery and verification boundaries

The uploaded artifact is the static frontend build, not a production deployment. A READY Vercel preview exists at `gridsplit-5alhvnqz3-somildholakias-projects.vercel.app` from the pre-merge validation SHA. PR #1 is merged, but production promotion (M35) remains open: the current production alias `gridsplit-kappa.vercel.app` still serves the older M01–M05 deployment. Vercel rejected a production deployment request with HTTP 402 `api-deployments-free-per-day` after the Hobby team exceeded 100 deployments in 24 hours; retry is available after the quota window resets.

CI's HTTP render fixture validates the sidecar API and MP4 output using a tiny generated image archive. It does not automate every browser screen or prove that a real GridSplit UI export containing the user's images, generated Kokoro audio, music/SFX and local codecs is complete. That full target-device package acceptance remains M36.

The workflow audits production npm dependencies. The optional Python sidecar's dependency graph is installed by users separately; it is not bundled or yet covered by a pinned Python lockfile/audit in CI. Likewise, model weights, voice files, FFmpeg binaries and codecs are user-installed and must be assessed by exact revision/build before redistribution.

Real Kokoro model/voice synthesis, playback and WAV download remain open acceptance checks (M14–M16). Manual browser review of image import, mapping persistence, timeline playback/seek, audio synchronization, and the 196-image sample remains open (M22–M25). Selectable-text PDF import is supported; scanned-image PDF OCR is out of scope.
