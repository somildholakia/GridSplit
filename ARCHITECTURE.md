# GridSplit Studio — Architecture and Processing Design

**Document status:** M03 decisions recorded  
**Last reviewed:** 2026-11-10  
**Requirements baseline:** [PRODUCT_REQUIREMENTS.md](PRODUCT_REQUIREMENTS.md) v1.0.0  
**Audited code baseline:** commit `cfddbcfd22018da87002c93a8ebbdaaa229829cb`

## 1. Architecture decisions

GridSplit Studio will use a **shared React/TypeScript application with local processing-host adapters**. The browser build remains a first-class product; an optional Tauri desktop host can expose native filesystem, subprocess, and rendering capabilities without duplicating the editor UI.

No cloud processing service is part of the required architecture. Static hosting may distribute app files only.

### 1.1 Runtime topology

```text
React + TypeScript UI (shared web/desktop)
  ├─ Project workspace / Script / Scenes / Characters
  ├─ Image Studio / Mapping / Timeline / Subtitles / Export
  └─ Application services
       ├─ ProjectRepository
       │    ├─ IndexedDB metadata + Blob assets
       │    └─ OPFS large-asset store (progressive enhancement)
       ├─ ProcessingHost
       │    ├─ BrowserHost (Web Workers, Web Audio, WebAssembly)
       │    └─ DesktopHost (optional Tauri commands / local processes)
       ├─ TtsProvider registry (local-only providers)
       ├─ Renderer registry (local-only renderers)
       └─ Import/export (versioned project ZIP)
```

- **Decision:** Keep the current single Vite app and evolve it feature-first. Do not convert to a monorepo before there is a concrete cross-package need.
- **Decision:** UI components must not call FFmpeg, ONNX Runtime, model downloads, or native processes directly. They use typed domain/application interfaces.
- **Decision:** CPU-heavy detection, audio decoding, synthesis, hashing, and rendering belong in workers or native processes where supported. The UI thread handles editing and orchestration.
- **Decision:** Browser capability detection is explicit. No browser-only feature may be presented as universal where filesystem, SharedArrayBuffer, codec, or storage support differs.

### 1.2 Target source layout

```text
src/
  app/                    composition, navigation, app providers
  domain/                 schema, IDs, timebase, validation, pure algorithms
  features/
    projects/              project library and lifecycle
    script/                source text, parsing, chapters, scenes
    characters/            speaker and voice assignment
    audio/                 TTS providers, segment jobs, playback, waveform
    image-extraction/      existing GridSplit detector and crop workflow
    images/                sequence import, sorting, duplicate/gap review
    mapping/               scene-to-image relationships
    timeline/              edit decisions, tracks, playback
    subtitles/             SRT/VTT, styling and preview
    rendering/             local render jobs and export
  infrastructure/
    storage/               IndexedDB, OPFS, desktop filesystem adapters
    processing/            browser/desktop hosts, worker protocols
    tts/                   concrete local provider adapters
    media/                 metadata probes, decoders, renderer adapters
  lib/                     compatibility utilities during migration
  workers/                 browser worker entry points
```

This is the target organization, not a claim that every folder or feature has been implemented. M04 begins by moving the existing extractor UI behind a feature boundary and establishing domain modules. Remaining modules are introduced only as milestones require them.

## 2. Canonical project schema

### 2.1 Schema contract

- **Decision:** The project archive's `project.json` is canonical metadata; generated timeline and mapping JSON files are reproducible sidecars derived from it.
- **Decision:** Start with `schemaVersion: 1`; every future incompatible schema change requires an explicit migration.
- **Decision:** Stable UUIDs identify projects, scenes, script blocks, speakers, audio segments, assets, tracks, and clips.
- **Decision:** Asset references use stable asset IDs and logical relative archive paths, never machine-specific absolute paths.
- **Decision:** Original script text and imported source file metadata remain immutable. Manual parser corrections are stored as structured edits.
- **Decision:** User-authored edit decisions are stored separately from generated/probed metadata so regeneration does not erase intentional edits.
- **Decision:** Every generated audio segment stores engine/runtime/model/voice IDs and the relevant configuration/provenance.

### 2.2 Required top-level shape

The following is a conceptual v1 contract. Concrete TypeScript types and runtime validation are added in M04/M08; this example is not a completed serializer.

```json
{
  "schemaVersion": 1,
  "project": { "id": "uuid", "name": "Project", "createdAt": "ISO-8601", "updatedAt": "ISO-8601" },
  "settings": {
    "video": { "width": 1920, "height": 1080, "fps": { "num": 30, "den": 1 } },
    "audio": { "preferredSampleRate": 48000 }
  },
  "sourceScript": { "assetId": "asset-script", "originalText": "...", "format": "plain-text" },
  "chapters": [],
  "scenes": [],
  "speakers": [],
  "assets": [],
  "audioSegments": [],
  "sceneImageMappings": [],
  "tracks": [],
  "subtitleCues": [],
  "jobs": []
}
```

Detailed requirements:
- `assets[]`: `id`, `kind`, `filename`, `mimeType`, `sizeBytes`, optional SHA-256, logical path, origin, and provenance.
- `scenes[]`: stable scene ID, order, chapter ID, source range, and ordered narration/dialogue/SFX/music blocks.
- `audioSegments[]`: segment/scene/block/speaker IDs, exact text, asset ID, status, actual sample count, sample rate, channels, codec/container, provider/model/voice metadata, and optional trusted alignment data.
- `sceneImageMappings[]`: stable mapping ID, scene IDs, image asset ID, order, optional explicit display range, and whether it is automatic or user-authored. A scene may map to multiple images; an image may cover multiple scenes.
- `tracks[]`: track type, order, mute/solo/level, and clips with asset references, source trims, timeline positions, fades, transitions, and image effects.
- `subtitleCues[]`: text, speaker, style, rational start/end time, and optional word alignment provenance.
- `jobs[]`: job ID, job type, status, input fingerprint, completed stages, error details, and resumable checkpoints where supported.

## 3. Media timing and synchronization

### 3.1 Exact source time

- **Decision:** Preserve audio timing as integer sample counts plus the decoded sample rate. An audio asset duration is exactly `sampleCount / sampleRate` seconds.
- **Decision:** Preserve video placement as integer frame indices plus a rational FPS (`num / den`).
- **Decision:** Use a normalized rational-time representation for cross-media timeline positions: `{ "numerator": "integer-string", "denominator": "positive-integer-string" }` seconds. BigInt arithmetic is used in memory; decimal strings make JSON portable and avoid 53-bit integer truncation.
- **Decision:** Conversion to display milliseconds or renderer-specific timestamps occurs at a declared boundary with documented rounding. Never accumulate clip positions by repeatedly adding rounded floating-point seconds.
- **Decision:** Transitions, subtitle ranges, and audio placements reference canonical timeline positions. Word-level cue timestamps require trustworthy aligner output and its provenance.

Example: an audio segment with 44,100 samples at 22,050 Hz is exactly 2 seconds. A 75-frame clip at 25/1 FPS is exactly 3 seconds. These exact source measurements are retained, even if the UI formats them as decimal seconds.

### 3.2 Timeline authority

- The project edit-decision/timeline model is the single source of truth for preview, subtitles, synchronization, and rendering.
- `timeline.json` is a deterministic sidecar projection of canonical project state.
- `scene_mapping.json` is a deterministic projection of scene/image mapping records.
- Actual decoded audio duration determines segment end time. If a segment is regenerated, the engine updates its measured sample metadata and dependent synchronization is recalculated.
- User-pinned image durations and manual clip edits are preserved. Recalculation must flag conflicts rather than silently overwrite deliberate edits.
- Missing media, unmatched scene IDs, duplicate references, timeline gaps, and missing audio are visible warnings.

## 4. Local storage and project portability

- **Decision:** IndexedDB stores project records, asset metadata, jobs, and a browser-compatible Blob fallback.
- **Decision:** Use the Origin Private File System (OPFS) when available for large media/model assets; fall back to IndexedDB blobs or user-selected file/directory workflows where appropriate.
- **Decision:** Tauri's local filesystem adapter is optional and only available in the desktop build. It must enforce explicit app-owned project directories and safe path validation.
- **Decision:** The portable ZIP is the interchange/backup boundary. It contains versioned `project.json`, source media, generated segments, sidecar metadata, subtitles, README, and license/provenance notices.
- **Decision:** Archive import validates paths, sizes, manifest/schema, checksums where present, and migration compatibility before writing anything to a project.
- **Decision:** Temporary files and cached model assets are tracked separately from user-authored assets. Cleanup never deletes source assets or autosaved project data.
- **Decision:** Model/voice downloads are user-initiated, integrity-checked, and stored locally. A previously installed project must remain usable offline.

## 5. TTS provider architecture and licensing

### 5.1 Provider contract

A provider exposes:
- Stable provider/runtime identifier and version.
- Available languages, voices, and their license/provenance records.
- Capability flags for speed, pitch, volume, word/phoneme alignment, speaker conditioning, and sample rates.
- Local model/runtime availability and integrity status.
- A segment synthesis method with cancellation and structured errors.
- Output metadata with exact sample count, sample rate, channels, format, and optional trusted alignment.

A provider must not claim unsupported capabilities. A segment job is idempotent by input fingerprint where practical; retrying one segment does not invalidate successful unrelated segments.

### 5.2 Engine decisions

- **Evaluation candidate, not yet integrated:** Kokoro-82M ONNX with ONNX Runtime Web or a native ONNX Runtime host. The ONNX Community model card currently declares Apache-2.0 for the v1.0 ONNX model. The runtime, tokenizer/phonemizer dependencies, and each voice asset still require their own license/provenance review and offline compatibility testing.
- **Optional external-provider candidate:** Piper's current OHF-Voice repository is GPL-3.0. The engine and each voice package must be assessed separately. Do not bundle it into the MIT app by default.
- **Optional lightweight external-provider candidate:** eSpeak NG is GPL-3.0-or-later. It may be evaluated as an optional separately installed engine, but is not included in the default distribution until the product's copyleft policy and notices are reviewed.
- **Decision:** Do not make a final TTS engine commitment in M03. M13/M14 must benchmark quality, language coverage, speed, memory, CPU/GPU support, alignment support, and model/voice license provenance on target hardware before adding a runtime or weights.
- **Decision:** The TTS interface itself remains engine-agnostic and free of network-provider dependencies.

## 6. Local rendering architecture

- **Decision:** Define a renderer interface that consumes a validated timeline snapshot and a local asset resolver. Renderer output must include a probe/validation report.
- **Browser candidate:** FFmpeg WebAssembly can support small/medium jobs without a native install, but its WebAssembly core inherits FFmpeg and linked codec licenses. Multi-thread builds require cross-origin isolation/SharedArrayBuffer headers; memory and browser constraints mean it is not the only renderer path.
- **Desktop candidate:** Tauri v2 can host the same React UI while delegating large renders to a local FFmpeg process or vetted native libraries. This is an optional host, not a mandatory subscription or hosted worker.
- **Decision:** Large or long renders should prefer the desktop/native host where browser memory, filesystem, or codec constraints make browser processing unreliable.
- **Decision:** Do not ship an FFmpeg build until its exact configure flags, linked libraries, codecs, license notices, corresponding source, and redistribution obligations are recorded. FFmpeg's official guidance distinguishes the default LGPL path from optional GPL components; GPL/nonfree options must not be enabled accidentally.
- **Decision:** H.264/AAC availability is a renderer capability, not an unconditional assumption. The selected encoder/decoder libraries and any patent obligations must be reviewed. The app must show supported output profiles based on the installed renderer.
- **Decision:** Render progress is real only when the host reports measurable progress; otherwise the UI uses an honest indeterminate state. Cancellation and stage-based recovery are required where supported.

## 7. Security, privacy, and failure handling

- No project content is sent to an application server.
- Optional asset acquisition must be explicit and limited to model/voice files. Download provenance, version, size, and SHA-256 are recorded where supplied or computed.
- Imported archives are untrusted input. Validate path traversal, decompressed size, file count, MIME hints, schema, and checksums before adoption.
- Use explicit user consent before overwriting or removing assets.
- Local worker/native messages are typed, versioned, and validated at boundaries.
- Jobs use stable IDs, statuses, input fingerprints, and recoverable stage records. Failed jobs retain diagnostic information but do not expose project content to telemetry.
- Capability failures are surfaced in UI; no provider silently switches to cloud.

## 8. License and upstream research baseline (reviewed 2026-11-10)

| Component/candidate | Upstream license/status observed | Project rule |
|---|---|---|
| Kokoro-82M v1.0 ONNX model | Apache-2.0 on the ONNX Community model card | Evaluation candidate; audit voices and preprocessing/runtime dependencies separately |
| ONNX Runtime Web | Browser inference runtime; source repository is MIT-licensed | Pin a reviewed version and check the runtime license/third-party notices during integration |
| Piper (OHF-Voice) | GPL-3.0 | Do not bundle by default; engine and voice assets need separate review |
| eSpeak NG | GPL-3.0-or-later | Do not bundle by default; review redistribution/compliance before optional integration |
| FFmpeg | LGPL-2.1-or-later baseline; optional GPL components change obligations | Pin exact build flags and linked external libraries; preserve notices/source requirements |
| ffmpeg.wasm wrapper/core | Wrapper and FFmpeg-derived core are different licensing layers | Audit wrapper, core and codecs independently; multithreading has deployment-header requirements |
| Tauri | MIT/Apache-2.0 code | Optional host candidate; inspect every bundled plugin and binary separately |

Upstream references:
- Kokoro ONNX model card: https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX
- ONNX Runtime Web: https://github.com/microsoft/onnxruntime/tree/main/js/web
- Piper: https://github.com/OHF-Voice/piper1-gpl
- eSpeak NG: https://github.com/espeak-ng/espeak-ng
- FFmpeg legal guidance: https://ffmpeg.org/legal.html
- FFmpeg WebAssembly: https://github.com/ffmpegwasm/ffmpeg.wasm
- Tauri: https://github.com/tauri-apps/tauri

This is a technical license inventory, not legal advice. Licensing is rechecked at the exact revision and for the exact files shipped in every release.

## 9. Validation plan

- Pure domain algorithms and schema validators are unit tested.
- Sample counts and rational-time arithmetic are tested at edge cases and across common sample rates and project FPS values.
- Each TTS provider is tested against offline fixture inputs, repeatability expectations, cancellation, actual duration, and failure/retry.
- Each renderer is tested with a small known timeline and output probed for frame rate, duration, dimensions, codecs, audio layout, and readability.
- Browser and desktop hosts are tested independently; unsupported features fail clearly.
- Project export/import round trips must preserve stable IDs, assets, original script, mapping, timeline, subtitles, and edit decisions.

## 10. Migration order

1. M01 repository audit — complete.
2. M02 product requirements — complete.
3. M03 architecture and processing decisions — this document and ADRs.
4. M04 feature/domain boundary refactor — preserve existing extractor.
5. M05 automated validation and CI hardening — tests before new studio feature expansion.
6. M06 onward — implement the user-facing production studio modules incrementally.
