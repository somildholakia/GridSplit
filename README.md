# GridSplit Studio

GridSplit Studio is a local-first workspace for preparing scripts and storyboard contact sheets for video production. The existing GridSplit image splitter remains available inside the studio and can still turn detected image grids into individually named crops.

**No account or hosted media-processing service is required for the default workflow.** Script extraction, scene preparation, image analysis, cropping, and ZIP creation run in the browser. Speech generation is optional and defaults to a separately installed local TTS sidecar. Advanced users may explicitly configure an HTTPS Cloudflare Quick Tunnel to a temporary GPU runtime; only then is selected narration/dialogue text sent to that remote runtime.

## Current capabilities

### Script Studio (M06–M11)
- Responsive production-studio shell, reusable components, and project dashboard.
- Create, open, rename, duplicate, archive, restore, and delete local projects. Deletion asks for confirmation.
- Browser-local autosave and restore, with a visible save-failure state.
- Versioned JSON backup export/import. Imported copies receive fresh project, scene, and block IDs; existing projects are kept.
- Paste scripts or import TXT, DOCX, and text-based PDF files locally (10 MB import limit).
- Parse chapter/part headings, scene/sequence headings, Markdown headings, paragraphs, narration, dialogue, SFX, and music cues.
- Recognise `[NARRATOR]`, `[CHARACTER: NAME]`, `[SFX: NAME]`, and `[MUSIC: NAME]` markers plus narration/voiceover, screenplay-style speaker labels, music/BGM/score, SFX/foley/ambience and bracketed stage directions.
- Keep ordinary prose mentioning music or sound classified as narration rather than misclassifying it as a production cue.
- Retain the original script separately from the editable scene breakdown.
- Edit chapter and scene titles, segment type, dialogue speaker, SFX/music cue labels, and block text.
- Add, remove, reorder, split, merge, and move scene blocks between adjacent scenes.

**Document import notes:** PDF.js is bundled with the app and extracts selectable PDF text on-device. Scanned-image PDFs without a text layer are not OCR'd and are reported as unsupported. DOCX import reads the main WordprocessingML document part; footnotes, tracked changes, and embedded text boxes are not included.

### Audio Studio (M12–M16 implementation)
- Manage stable narrator and dialogue character identities per project.
- Assign each character a voice, language, and speech speed.
- Connect to the optional Kokoro ONNX sidecar on loopback (`127.0.0.1`) or explicitly enter an HTTPS Cloudflare Quick Tunnel for a temporary user-started GPU runtime.
- Keep loopback as the default; arbitrary remote hosts and insecure HTTP tunnels are rejected, and there is no automatic remote fallback.
- In temporary GPU mode, selected narration/dialogue text is sent over HTTPS to the configured runtime; generated WAVs are still stored locally in browser IndexedDB.
- Generate, cancel, retry, and regenerate narration/dialogue blocks independently.
- Use **Generate all remaining** to synthesize pending narration/dialogue segments sequentially with progress, cancellation, ready-segment skipping and retry. Music/SFX cues are not sent to TTS.
- Persist WAV audio locally in IndexedDB; review with the browser audio player and download individual WAV files.
- The Kokoro model and matching voice file are user-installed and are not bundled or downloaded by GridSplit. Real model-backed synthesis/playback smoke testing remains an explicit acceptance step.

### Media timing and subtitles (M17–M19)
- Re-measure saved WAV blobs from their actual sample headers and derive exact sample-based durations.
- Export deterministic scene/segment synchronization JSON with rational timestamps.
- Export segment-level SRT and WebVTT captions; word-level alignment is not fabricated.

### Multi-image intake (M20–M21)
- Add multiple image files or choose a folder where browser directory selection is supported.
- Natural-sort numbered frames, filter invalid/oversized files, and remove individual queue entries.
- Export an ordered ZIP of unchanged originals with a CSV manifest.
- In Production Studio, import images into projects, review duplicate content instead of silently dropping it, correct sequence numbers and order, map images to scenes, and build an initial schedule from measured WAV durations.

### Production Studio (M22–M31 implementation)

- Store up to 1,200 numbered storyboard images in a project, review sequence gaps/duplicates, correct frame numbers, and reorder images.
- Map multiple images to scenes and reuse images across scenes.
- Build an editable image/audio timeline from measured WAV durations, with playhead, seek, preview, and clip editing.
- Mix narration, dialogue, music and SFX on four independent tracks with gain, mute/solo and fade controls. Import music/SFX locally.
- Add per-image Ken Burns, pan/zoom motion and cut/fade/dissolve/wipe transitions.
- Render H.264/AAC MP4 locally with the optional Python sidecar, using FFmpeg/ffprobe installed on the user's own computer.
- Export media-inclusive `.gridsplit.zip` packages with project metadata, original images, generated WAVs, imported music/SFX, checksums, measured synchronization JSON, SRT/VTT subtitles and README.
- Restore an archive as a new editable project, remapping IDs and restoring media into browser-local IndexedDB.

Milestone notes: [M22–M25](docs/M22-M25.md) and [M26–M31](docs/M26-M31.md). GitHub Actions [run #199](https://github.com/somildholakia/GridSplit/actions/runs/42858412750) passed 9 Python tests (including HTTP ZIP upload → local FFmpeg render → MP4 download), lint, 91 Vitest tests across 18 files, typecheck, production build, static artifact upload and production npm audit (0 vulnerabilities at the high-severity threshold). Browser/device acceptance remains a separate release check.

### Browser Image Animation Studio (M37)

- Open **Production Studio → Image animation** to animate one selected image or the full ordered project sequence.
- Choose Ken Burns zoom, zoom-out, pan-left, pan-right, floating motion or cinematic drift.
- Set 3–60 seconds per image and motion intensity; output uses a 1280 × 720 canvas at 30 FPS.
- Render in-browser with `canvas.captureStream()` and `MediaRecorder`. MP4 is selected only when the browser supports a suitable codec; otherwise output is WebM.
- Recorder chunks write to OPFS when available; browsers without OPFS use an in-memory Blob fallback.
- This creates camera-style movement from stills, not generative object/character animation. It does not add timeline audio; use the optional local FFmpeg renderer for the full timeline mix.
- Rendering is real-time: a 60-minute output takes about 60 minutes to record. Long exports depend on browser storage, memory and codec support.

**Local rendering:** FFmpeg and ffprobe must be installed separately. GridSplit does not bundle binaries/codecs or use a hosted renderer. Follow [local-render/README.md](local-render/README.md) to start the loopback-only renderer. The installed build must provide H.264 (libx264) and AAC encoders.
### Image Splitter
- Upload browser-supported PNG, JPG, WebP, GIF, and other image formats (up to 100 MB).
- Detect horizontal row bands, then estimate vertical separators independently for each row.
- Preview every detected tile before export.
- Select/deselect individual tiles; split wide tiles or merge adjacent tiles in the same row.
- Apply a manually specified, evenly spaced row/column grid as a fallback.
- Configure border trim, filename prefix, starting number, and zero-padding.
- Export selected tiles as PNG crops in a ZIP, alongside a CSV manifest.

### Integration, performance and security checks (M32–M34)

- Integration tests cover script parsing → measured synchronization → captions → image mapping → production timeline, plus a real local HTTP archive-upload → FFmpeg render-job → validated MP4 download.
- A synthetic performance regression covers 500 scenes, 500 images and 1,000 timeline clips with a 10-second CI ceiling. The local renderer allows at most two active jobs and retains at most eight finished jobs for up to six hours.
- The TTS sidecar validates loopback Host headers, and both sidecars validate their local request boundaries. The optional local TTS Python graph is pinned in `local-tts/uv.lock`; CI checks the lock with `uv lock --check` and audits the synchronized environment with `pip-audit --strict` (`pip-audit` remains dev-only). See [the security review](docs/SECURITY_REVIEW.md).

**Release boundary:** M01–M37 implementation is merged. PR #22 and post-merge main CI runs [#43184510763](https://github.com/somildholakia/GridSplit/actions/runs/43184510763) and [#43185852867](https://github.com/somildholakia/GridSplit/actions/runs/43185852867) passed. Current main commit `e30fba7e` is deployed at [gridsplit-studio.vercel.app](https://gridsplit-studio.vercel.app) on the secondary Vercel account. Real Kokoro synthesis/playback/download and M36 target-device browser media export → archive restore → re-render remain open.

## Run locally

Requirements: **Node.js 22.13 or newer (or Node.js 24+)** and npm. PDF.js 6.5 requires this runtime range.

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Validate and build

```bash
npm run lint
npm test
npm run typecheck
npm run build
npm run preview
```

The static production output is written to `dist/` and can be deployed to Vercel, Netlify, GitHub Pages, or any static host. Hosting distributes the frontend only; project and media processing remain local to the browser. For a target-device check of real Kokoro synthesis plus a loopback FFmpeg render, see [`local-render/acceptance_check.py`](local-render/README.md#target-device-media-acceptance-runner).

## How image detection works

GridSplit first finds horizontal image bands, then analyses each band independently. For each row it builds a luminance/contrast projection, estimates repeated tile pitch through normalized autocorrelation, and uses a spacing-constrained dynamic program to select likely vertical separators. Neighbouring rows can have different widths and numbers of tiles. This is traditional image processing, not semantic image understanding: textured artwork, missing borders, merged cells, and irregular layouts may still require manual correction.

## Privacy and storage

Images, scripts and imported media are processed locally by default. Studio project metadata is saved in the current browser's localStorage; image, generated-audio and music/SFX blobs are kept in IndexedDB. If a user explicitly selects a temporary remote GPU TTS endpoint, the selected narration/dialogue text is sent over HTTPS to that endpoint for synthesis; generated audio remains in the browser's IndexedDB. These stores are not synced between browsers or devices. JSON backup is metadata-only. Production Studio can export a media-inclusive .gridsplit.zip with editable project data, original images, generated WAVs, imported audio, measured synchronization metadata and SRT/VTT subtitles; restore recreates a new local project after checksum validation.

## Scope and roadmap

The main branch now includes GridSplit Studio through M34 automated implementation: design system, dashboard and project manager; script import/parsing/editing; optional local Kokoro TTS; measured WAV timing and captions; the original image splitter; image sequence management and scene mapping; a visual timeline; four-track audio mixing; transitions and image motion; optional loopback-only FFmpeg/MP4 rendering; and checksum-verified portable project export/restore. GitHub Actions validates TypeScript, 91 frontend tests, 9 Python tests, production npm dependency security, the production build, Python archive safety and a small HTTP-to-MP4 FFmpeg integration fixture. Target-device Kokoro synthesis, browser export of the corrected 196-image sample, real image/timeline playback and complete browser-generated package inspection remain open. Production deployment and the latest public dashboard/workspace/script smoke test have passed.

## License

GridSplit is MIT licensed. The locally bundled PDF.js dependency is Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Local audio generation (M12–M16)

GridSplit includes a character/voice workspace and an optional Kokoro ONNX TTS provider. Follow [local-tts/README.md](local-tts/README.md) to set up the default loopback sidecar, then open **Audio studio** in an active project. Model and voice files are installed by the user and are not included in this repository. For a temporary Colab GPU session, enter the HTTPS Quick Tunnel URL in Audio Studio after starting a CORS-enabled API and tunnel; keep the runtime active only while generating. The selected script text is sent to Colab in this mode, while WAV blobs remain in local IndexedDB.

See [docs/M12-M16.md](docs/M12-M16.md) for milestones and limitations. For local TTS from the public Vercel frontend, allow the exact frontend origin using `GRIDSPLIT_ALLOWED_ORIGINS` before starting the loopback sidecar; see [the setup guide](local-tts/README.md).

## Local rendering and portable projects (M26–M31)

Open **Production studio → Mix & export** to configure narration/dialogue/music/SFX levels, mute/solo, fades, image effects, output profiles, complete ZIP export and project restore. MP4 rendering uses the optional local FFmpeg sidecar; no hosted renderer is required.

Install FFmpeg and ffprobe yourself, then from the repository root run:

    python local-render/server.py --allow-origin http://localhost:5173

Use the exact browser origin for your frontend. For the public website, run the sidecar with `--allow-origin https://gridsplit-studio.vercel.app`; it still binds to 127.0.0.1 and media remains on your computer. See [local-render/README.md](local-render/README.md) and [docs/M26-M31.md](docs/M26-M31.md) for setup, archive contents and limits. GridSplit does not bundle FFmpeg or download codecs. The exact installed build must provide H.264 (libx264) and AAC encoding for the default MP4 export profile.
