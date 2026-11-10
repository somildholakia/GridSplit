# GridSplit Studio

GridSplit Studio is a local-first workspace for preparing scripts and storyboard contact sheets for video production. The existing GridSplit image splitter remains available inside the studio and can still turn detected image grids into individually named crops.

**No account or hosted media-processing service is required.** Script extraction, scene preparation, image analysis, cropping, and ZIP creation run in the browser. Speech generation is optional and uses a separately installed local TTS sidecar; it does not send scripts to a cloud provider.

## Current capabilities

### Script Studio (M06–M11)
- Responsive production-studio shell, reusable components, and project dashboard.
- Create, open, rename, duplicate, archive, restore, and delete local projects. Deletion asks for confirmation.
- Browser-local autosave and restore, with a visible save-failure state.
- Versioned JSON backup export/import. Imported copies receive fresh project, scene, and block IDs; existing projects are kept.
- Paste scripts or import TXT, DOCX, and text-based PDF files locally (10 MB import limit).
- Parse chapter/part headings, scene/sequence headings, Markdown headings, paragraphs, narration, dialogue, SFX, and music cues.
- Recognise `[NARRATOR]`, `[CHARACTER: NAME]`, `[SFX: NAME]`, and `[MUSIC: NAME]` markers.
- Retain the original script separately from the editable scene breakdown.
- Edit chapter and scene titles, segment type, dialogue speaker, SFX/music cue labels, and block text.
- Add, remove, reorder, split, merge, and move scene blocks between adjacent scenes.

**Document import notes:** PDF.js is bundled with the app and extracts selectable PDF text on-device. Scanned-image PDFs without a text layer are not OCR'd and are reported as unsupported. DOCX import reads the main WordprocessingML document part; footnotes, tracked changes, and embedded text boxes are not included.

### Audio Studio (M12–M16 implementation)
- Manage stable narrator and dialogue character identities per project.
- Assign each character a voice, language, and speech speed.
- Connect to the optional Kokoro ONNX sidecar on loopback (`127.0.0.1`).
- Generate, cancel, retry, and regenerate narration/dialogue blocks independently.
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

### Production Studio (M22–M25 implementation)

- Store numbered storyboard images in a project, with original files in local IndexedDB and browser-generated thumbnails.
- Review missing frame numbers, sequence gaps, repeated frame numbers, and identical-content fingerprints; correct numbering and reorder images manually.
- Map multiple images to each scene and reuse one image across different scenes.
- Build an initial image/audio schedule from the measured duration of locally saved WAV segments, with explicit warnings for missing audio or images.
- Edit clip start times and durations, nudge clips, view image/audio lanes on a time ruler, and seek a playhead with a live frame preview.
- Play and pause a timeline while local narration/dialogue WAV segments are scheduled against scene positions using Web Audio.

The M22–M25 implementation and automated verification status are tracked in [docs/M22-M25.md](docs/M22-M25.md). GitHub Actions run #164 passed 75 tests across 15 files, lint, typecheck, production build, optional Python sidecar syntax, and static artifact upload. Manual browser acceptance remains open. The live editor uses second-based project timeline positions; it does not yet provide audio mixing, music/SFX processing, transitions, image effects, MP4 rendering, or media-inclusive project packaging.

### Image Splitter
- Upload browser-supported PNG, JPG, WebP, GIF, and other image formats (up to 100 MB).
- Detect horizontal row bands, then estimate vertical separators independently for each row.
- Preview every detected tile before export.
- Select/deselect individual tiles; split wide tiles or merge adjacent tiles in the same row.
- Apply a manually specified, evenly spaced row/column grid as a fallback.
- Configure border trim, filename prefix, starting number, and zero-padding.
- Export selected tiles as PNG crops in a ZIP, alongside a CSV manifest.

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

The static production output is written to `dist/` and can be deployed to Vercel, Netlify, GitHub Pages, or any static host. Hosting distributes the frontend only; project and media processing remain local to the browser.

## How image detection works

GridSplit first finds horizontal image bands, then analyses each band independently. For each row it builds a luminance/contrast projection, estimates repeated tile pitch through normalized autocorrelation, and uses a spacing-constrained dynamic program to select likely vertical separators. Neighbouring rows can have different widths and numbers of tiles. This is traditional image processing, not semantic image understanding: textured artwork, missing borders, merged cells, and irregular layouts may still require manual correction.

## Privacy and storage

Images and imported scripts are processed locally in the browser. Studio project data is saved in the current browser's `localStorage`; it is not synced between browsers or devices. Export a JSON backup to move project metadata between devices. (The JSON project backup stores project data, source text, and image metadata; it does not embed IndexedDB image or audio binaries. A media-inclusive portable archive is planned for M30.)

## Scope and roadmap

This feature branch contains the M06–M25 implementation: design system, dashboard, local projects, script import/parsing/editing, local audio workflow, measured timing and subtitles, original image splitter, project-local image sequence management, many-to-many scene mapping, measured image/audio scheduling, and a visual timeline with local playback. GitHub Actions run #164 passed for the M22–M25 implementation (75 tests across 15 files, lint, typecheck, production build, optional Python sidecar syntax, and artifact upload). Real Kokoro synthesis still requires user-installed model/voice files and a local generate → playback → download smoke test. Audio mixing, transitions/effects, FFmpeg/MP4 rendering, and a media-inclusive portable project archive remain later milestones.

## License

GridSplit is MIT licensed. The locally bundled PDF.js dependency is Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Local audio generation (M12–M16)

GridSplit includes a character/voice workspace and an optional Kokoro ONNX local TTS provider. Follow [local-tts/README.md](local-tts/README.md) to set up the sidecar, then open **Audio studio** in an active project. Model and voice files are installed by the user and are not included in this repository. The browser calls only a loopback service; WAV blobs are stored in local IndexedDB.

See [docs/M12-M16.md](docs/M12-M16.md) for milestones and limitations.
