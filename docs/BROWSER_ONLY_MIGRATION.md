# Browser-only migration

**Goal:** GridSplit Studio must be usable from its public website in a mobile or desktop browser. Users must not install an Android/iOS app, terminal, Python, Node.js, FFmpeg/ffprobe, local TTS sidecar, loopback renderer, or a third-party editor.

The website is the application. Script/image/audio/video processing runs on-device in browser workers and browser media APIs. Browser-delivered model/codec assets may be downloaded after the user explicitly starts setup, then cached by the browser. Project media is never uploaded to an application server.

## Current branch scope

Branch: `feat/browser-only-1200-images-hour-plus`

- **Implemented in this branch:** project image ceiling raised to 2,400; galleries and per-scene mapping are paginated at 60 assets; image thumbnails are loaded for the active page plus the current timeline frame; imports are saved in batches of 12; browser storage quota is checked before import.
- **Implemented in this branch:** timeline width is capped with adaptive pixels-per-second scaling; ruler density adapts with duration; timeline labels retain hours (for example `1:00:00.0`); Production Tools uses hour-aware labels.
- **Automated coverage added:** pure capacity tests for the 2,400-image limit, bounded page size, one-hour/two-hour scaling, bounded ruler ticks, and hour-aware labels. These tests still need a successful GitHub Actions run and target-browser verification.
- **Not implemented yet:** in-browser speech synthesis and complete browser-only MP4 rendering. The current application code still presents the optional loopback Kokoro sidecar for TTS and the Python + FFmpeg/ffprobe sidecar for MP4 rendering. Do not describe the current deployed site as phone-install-free for the entire workflow until these are replaced and accepted.

## Migration milestones

### B01 — High-capacity project and long timeline (current branch)

- Support at least 2,400 project images.
- Avoid rendering every image thumbnail or mapping checkbox simultaneously.
- Import files incrementally and yield to the UI between batches.
- Check reported browser storage quota before writing large batches; show actionable errors rather than silently skipping files.
- Keep timeline geometry, time labels, ruler density, clip controls, and seek ranges usable beyond one hour.
- Keep all timeline time arithmetic based on real audio sample durations and the project timebase; do not impose a hidden 60-minute cap.

**Acceptance:** import and navigate 1,200 images, then verify the 2,400 logical ceiling; map images across several scenes; verify paging and global order; inspect 1-hour and 2-hour timelines; verify storage exhaustion fails safely. Device storage may limit how many full-resolution originals can fit even though the product ceiling is 2,400.

### B02 — Browser TTS

- Replace `KokoroLocalProvider` and loopback URL settings with a typed browser TTS provider.
- Run inference in a dedicated Web Worker, never on the React UI thread.
- Offer explicit first-use model download, model/voice provenance, progress, cancellation, retry, and cached-model status.
- Prefer a small quantized model and browser-supported WASM/WebGPU backends, with feature detection and a low-resource fallback.
- Preserve segment-level generation, speaker/voice assignment, actual WAV sample metadata, and retry semantics.
- Keep generated WAV blobs in browser-managed local storage and provide a no-cloud, no-paid-key workflow.
- Confirm language and voice coverage before removing currently shown voice options. Do not show a voice as available unless the browser model actually provides it.

**Acceptance:** from a fresh mobile browser profile, open the website, download the model with explicit consent, generate two speaker segments, reload the site, regenerate one segment, and verify that cached model files work without requiring a native sidecar. Confirm cancellation and low-memory failures are recoverable.

### B03 — Browser video rendering

- Replace `renderProjectLocally`, the Python HTTP renderer, and FFmpeg/ffprobe installation steps with a browser renderer.
- Use browser-native WebCodecs where supported and a pinned, license-reviewed WebAssembly fallback where required.
- Render in a Worker. Use bounded chunks/segments and browser-managed temporary storage (OPFS where supported) rather than holding a complete one-hour video, all decoded frames, or the entire source archive in RAM.
- Preserve the existing render profile, image motion/transitions, narration/dialogue/music/SFX mix, subtitles, progress, cancellation, and output validation.
- Detect available encoders and formats before starting. Do not claim MP4/H.264/AAC support unless the current browser path can actually encode and validate it. Provide a clear compatible fallback when needed.
- Keep codec, model, wrapper, and WebAssembly licensing/provenance documented.

**Acceptance:** render short representative projects on mobile and desktop browsers; then perform staged long-form acceptance at 15 minutes, 60 minutes, and 120 minutes on named target devices. Verify readable output, timestamps, audio continuity, sync drift, cancellation, storage cleanup, and recoverability after a tab interruption. A 1–2 hour timeline is supported by the editor; successful export duration and speed remain device- and browser-dependent.

### B04 — Browser storage and recovery

- Store large source assets and render intermediates in a browser-managed store; keep metadata/indexes small.
- Request persistent browser storage only with a clear explanation and respect the user's choice.
- Show used/available storage where the browser exposes it and reserve headroom for final exports.
- Provide incremental project archive export/import, checksum verification, and safe restore without requiring a local file-processing app.
- Revoke object URLs and delete temporary render chunks on completion, cancellation, or safe recovery.

### B05 — Remove local-install UX

Only after B02 and B03 meet their acceptance gates:

- Remove loopback endpoint fields and local sidecar health checks from the normal UI.
- Remove all phone-facing install commands for Python, FFmpeg, ffprobe, uv, Node.js, and local model servers.
- Replace them with browser capability checks, model-download controls, storage warnings, and clear export-format availability.
- Keep developer-only local tooling in repository docs only; do not expose it as a user requirement.

### B06 — Release verification

- Run lint, unit tests, typecheck, production build, dependency/license audits, and GitHub Actions.
- Test the deployed public website in a clean Android Chrome profile and desktop Chrome/Firefox/Safari as supported.
- Verify no script, image, WAV, archive, or video upload occurs during local editing and rendering.
- Verify all image pages, full-order edits, 1-hour and 2-hour time displays, export validation, archive restore, and failure recovery.
- Publish only after successful CI and target-device media acceptance; deployment of a frontend shell alone is not evidence that model inference or MP4 export works.

## Resource and compatibility constraints

A capacity target is not a guarantee that every handset can store 2,400 originals or render a 120-minute file at 1080p. Browser storage quotas, available memory, hardware codecs, thermal throttling, background-tab suspension, and model size vary by device and browser. GridSplit must detect/report those limits and fail safely; it must not silently fall back to a paid or cloud service.
