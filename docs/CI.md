# Continuous Integration and Build Artifacts

**Current workflow:** M05 baseline plus M12–M21 validation steps  
**Runner:** GitHub Actions, Ubuntu, Node.js 22

## Automated checks

For pull requests to `main`, pushes to `main`, and manual dispatch, CI performs:

1. Install JavaScript dependencies with `npm ci --no-audit --no-fund` from the committed lockfile.
2. Compile-check the optional Python TTS sidecar with `python -m py_compile local-tts/server.py`.
3. Run ESLint on the TypeScript source tree.
4. Run Vitest unit tests.
5. Run the TypeScript project typecheck.
6. Run the Vite production build.
7. Upload the commit-specific `dist/` artifact for 14 days.

The workflow has read-only repository permissions, npm caching, and cancels superseded runs on the same ref.

## Latest verified run

**GitHub Actions run #115 passed** on PR head `f611f937dccc158501a71ef592557a5630e9cbd9`.

- Python sidecar syntax compilation: passed.
- ESLint: passed.
- Vitest: **12 test files, 53 tests passed**.
- TypeScript typecheck: passed.
- Production build: passed.
- Static build artifact upload: passed.

[View GitHub Actions run #115](https://github.com/somildholakia/GridSplit/actions/runs/42815634774)

Audio-specific automated coverage includes WAV header/sample metadata parsing, local endpoint loopback/privacy validation, stable character reconciliation, voice/text fingerprint invalidation, copied-project segment reference remapping, and interrupted-generation recovery. M17–M19 coverage adds mixed-rate rational timeline accumulation, sync metadata, and SRT/VTT generation; M20–M21 coverage adds extractor fallback/grid regression fixtures and image intake validation/natural sorting.

## Delivery and verification boundaries

The uploaded artifact is the static frontend build, not a production deployment. Production deployment remains M35.

Python compilation does not install the optional Kokoro model/runtime or prove real speech synthesis. The CI runner does not contain the user-supplied model/voice files. M14–M16 remain open in the milestone checklist until a target machine runs the sidecar and completes a real generate → playback → WAV-download smoke test.

Browser interaction testing of the protected Vercel preview and the 196-image contact-sheet acceptance test are also still unverified.
