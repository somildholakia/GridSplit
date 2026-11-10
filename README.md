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

Images and imported scripts are processed locally in the browser. Studio project data is saved in the current browser's `localStorage`; it is not synced between browsers or devices. Export a JSON backup to move project metadata between devices. (The JSON project backup stores project data and source text; it is not yet a portable archive containing generated audio/video media.)

## Scope and roadmap

This branch contains the M06–M16 implementation: design system, dashboard, local project management, script import, deterministic parsing, manual scene segmentation, character/voice management, local TTS provider, per-segment generation controls, and audio preview UI. Real Kokoro synthesis/playback still requires user-installed model/voice files and a local smoke test. Timeline synchronization, audio mixing, subtitles, MP4 rendering, and complete production ZIP export remain later milestones.

## License

GridSplit is MIT licensed. The locally bundled PDF.js dependency is Apache-2.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Local audio generation (M12–M16)

GridSplit includes a character/voice workspace and an optional Kokoro ONNX local TTS provider. Follow [local-tts/README.md](local-tts/README.md) to set up the sidecar, then open **Audio studio** in an active project. Model and voice files are installed by the user and are not included in this repository. The browser calls only a loopback service; WAV blobs are stored in local IndexedDB.

See [docs/M12-M16.md](docs/M12-M16.md) for milestones and limitations.
