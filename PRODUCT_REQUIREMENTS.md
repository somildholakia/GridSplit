# GridSplit Studio — Product Requirements

**Document ID:** GSS-PRD-001  
**Version:** 1.0.0  
**Status:** Baseline requirements approved for implementation planning  
**Date:** 2026-11-10  
**Source:** GridSplit Studio master project prompt supplied by the product owner

This document converts the master prompt into testable requirements. It defines intended product behavior; it does not claim that unimplemented features already exist. A requirement is complete only when it is implemented, tested, and recorded in the milestone checklist.

## 1. Product vision and scope

GridSplit Studio is a free, browser-only, local-first production studio that takes a written script plus numbered images or a storyboard/contact sheet and produces editable narrated video. Users must be able to use the public website from a current mobile or desktop browser without installing a phone app, CLI, Python runtime, FFmpeg binary, TTS sidecar, native helper, or desktop editor. Project media is processed on the user's device; optional model files may be downloaded by the browser after an explicit user action and cached locally.

The product combines:
1. Script, chapter, scene, and dialogue preparation.
2. Offline, segment-based voice generation.
3. Accurate media metadata and synchronization.
4. Contact-sheet extraction and image-sequence management.
5. Editable multitrack video timeline.
6. Browser-based rendering and a portable project export.

The browser running GridSplit Studio performs the processing using browser APIs, workers, WebAssembly, and supported media codecs. A hosted static frontend distributes application code only; it must not make remote processing or an online account necessary. No local sidecar or command-line setup is part of the user's workflow.

### Out of scope

- Paid or metered APIs as required dependencies.
- Cloud-only rendering or mandatory remote model inference.
- User-required native app installs, Python/Node/FFmpeg command-line setup, loopback TTS/render sidecars, or third-party desktop editors.
- Mandatory user accounts, subscription gates, or usage quotas.
- Server-side upload of scripts, images, generated audio, or project archives.
- Undocumented model/voice redistribution or unsupported controls presented as working features.
- Silent modification of the source script or silent omission of media.

## 2. Product principles and priorities

| Priority | Meaning |
|---|---|
| P0 | Required for the core product and release acceptance |
| P1 | Required for a complete professional workflow but may follow the first functional vertical slice |
| P2 | Improvement or optional advanced capability |

1. **Local first:** user media and project data stay on the user's device by default.
2. **Free by design:** no API key or paid service is required for the complete workflow.
3. **Preserve original material:** keep the original script and source images; edits are represented separately.
4. **Deterministic where possible:** parsers, filename ordering, mapping rules, metadata, and timeline math must be reproducible.
5. **Actual timing:** measure real decoded media durations. Never estimate exact word timing from character or word count.
6. **Recoverable processing:** retry a failed audio segment or render step without restarting successful work where practical.
7. **Transparent limitations:** show unsupported engine capabilities, missing media, uncertain detections, and license limitations explicitly.
8. **Portable projects:** a project archive contains sufficient assets and metadata to reopen and continue editing.

## 3. Personas and primary journey

### Primary user

A creator or editor who has a script and a set of storyboard images and wants to create narrated videos without paying per-generation or per-render fees.

### Primary journey

1. Create a local project.
2. Paste or import a script without altering the original.
3. Review parsed chapters, scenes, narration, dialogue, SFX, and music cues.
4. Assign speakers and locally available voices.
5. Generate audio as independent segments and review/regenerate only the segments that need work.
6. Import numbered images, folders, or contact sheets; correct extraction results.
7. Map images to scenes and review missing/unmatched items.
8. Synchronize visuals to actual audio durations.
9. Edit tracks, timing, transitions, effects, and subtitles.
10. Preview and render an MP4 locally.
11. Export a complete portable ZIP and reopen it later.

## 4. Functional requirements

### 4.1 Project and storage

- **GSS-PROJ-001 (P0):** Create, open, rename, duplicate, and delete local projects.
- **GSS-PROJ-002 (P0):** Persist project metadata and edit decisions locally; autosave must not overwrite the original imported script.
- **GSS-PROJ-003 (P0):** Represent projects with a versioned, validated schema and explicit migration behavior.
- **GSS-PROJ-004 (P0):** Recover from interrupted segment generation and interrupted render jobs without marking incomplete outputs successful.
- **GSS-PROJ-005 (P0):** Import and export portable project archives. A restored project must retain source assets, metadata, generated media, and edit decisions.
- **GSS-PROJ-006 (P1):** Provide project duplication and safe cleanup of temporary/intermediate data with confirmation for destructive operations.

### 4.2 Script Studio

- **GSS-SCRIPT-001 (P0):** Accept pasted plain text and TXT files.
- **GSS-SCRIPT-002 (P1):** Import DOCX and PDF text locally, reporting extraction failures and preserving the imported original.
- **GSS-SCRIPT-003 (P0):** Support long scripts, chapters, paragraphs, scenes, narration, and dialogue.
- **GSS-SCRIPT-004 (P0):** Parse the deterministic markers `[NARRATOR]`, `[CHARACTER: NAME]`, `[SFX: NAME]`, and `[MUSIC: NAME]`.
- **GSS-SCRIPT-005 (P0):** Store parsed content separately from the original source and retain source order and source text.
- **GSS-SCRIPT-006 (P0):** Allow users to correct scene boundaries, segment types, speaker assignment, and cue labels manually.
- **GSS-SCRIPT-007 (P0):** Never silently rewrite, summarize, translate, or discard source-script text.
- **GSS-SCRIPT-008 (P1):** Export or inspect the structured scene representation for diagnostics.

### 4.3 Audio Studio and TTS

- **GSS-AUDIO-001 (P0):** Offer production presets for audiobook, podcast, cinematic storytelling, documentary, advertisement, educational narration, and meditation.
- **GSS-AUDIO-002 (P0):** Provide an offline TTS provider abstraction; no paid API key may be necessary.
- **GSS-AUDIO-003 (P0):** Generate individual audio segments, not one indivisible whole-script request.
- **GSS-AUDIO-004 (P0):** Persist a stable segment ID, scene ID, speaker ID, exact input text, output path/asset ID, generation status, and engine configuration for every segment.
- **GSS-AUDIO-005 (P0):** Measure actual duration from decoded media sample count and sample rate and persist sample rate/channel count where available.
- **GSS-AUDIO-006 (P0):** Allow preview, deletion, and regeneration of one segment without forcing successful segments to regenerate.
- **GSS-AUDIO-007 (P0):** Maintain consistent speaker-to-voice assignment within a project.
- **GSS-AUDIO-008 (P1):** Support language, speed, pitch, and volume only when the selected engine advertises that capability. Do not show unsupported controls as functional.
- **GSS-AUDIO-009 (P1):** Support lightweight fallback TTS for low-resource devices, with voice-quality limitations clearly disclosed.
- **GSS-AUDIO-010 (P0):** Record engine, runtime, model, voice, configuration, and license/provenance identifiers with generated assets.

### 4.4 Audio metadata and synchronization metadata

- **GSS-META-001 (P0):** Produce `timeline.json`, `scene_mapping.json`, `subtitles.srt`, `subtitles.vtt`, and `project.json` from canonical project state.
- **GSS-META-002 (P0):** Record project FPS/timebase, scene IDs, segment IDs, actual audio durations, start/end times, image assignments, image display durations, transitions, subtitles, speakers, SFX, and music placements as applicable.
- **GSS-META-003 (P0):** Derive audio timing from decoded sample counts/sample rate, with integer or rational timebase representation to avoid accumulated floating-point drift.
- **GSS-META-004 (P0):** Store word-level timings only when supplied by a trustworthy aligner or an engine with documented timestamp semantics.
- **GSS-META-005 (P0):** Otherwise expose segment/phrase timing derived from actual media duration; never invent exact word timestamps from text length.
- **GSS-META-006 (P1):** Embed chapters or metadata in media formats only where supported; sidecar JSON remains canonical.
- **GSS-META-007 (P0):** Make metadata generation deterministic for equivalent inputs and project state.

### 4.5 Image Studio and existing GridSplit extraction

- **GSS-IMG-001 (P0):** Preserve existing contact-sheet detection, row-aware crop analysis, manual inclusion/exclusion, split/merge, border trim, sequential naming, and ZIP export behavior.
- **GSS-IMG-002 (P0):** Import multiple images and, where browser/desktop platform support allows, directories.
- **GSS-IMG-003 (P0):** Sort numbered filenames with natural numeric ordering (for example 2 before 10).
- **GSS-IMG-004 (P1):** Detect duplicate assets and missing sequence numbers and present them as reviewable warnings.
- **GSS-IMG-005 (P0):** Retain image previews and support manual crop corrections, split, merge, include, and exclude actions.
- **GSS-IMG-006 (P0):** Export individual crops with deterministic, configurable filenames and a manifest.
- **GSS-IMG-007 (P0):** Never silently discard an unmatched or excluded image; show its status and preserve source assets.
- **GSS-IMG-008 (P0):** Keep source images local and do not transmit them to an application server.
- **GSS-IMG-009 (P0):** Support at least 2,400 source images per project, bounded batch imports, browser-storage quota checks, recoverable interruption, and paginated image/mapping galleries. The 2,400 value is a logical product ceiling; actual import size must respect the device's reported storage and memory budget.

### 4.6 Image-to-scene mapping and synchronization

- **GSS-SYNC-001 (P0):** Support both one scene to many images and one image across many scenes.
- **GSS-SYNC-002 (P0):** Generate a suggested mapping using sequence order and scene order, while allowing manual correction.
- **GSS-SYNC-003 (P0):** Handle cases where there are more images than scenes and fewer images than scenes.
- **GSS-SYNC-004 (P0):** Calculate visual display times using the actual audio timeline and explicit project FPS.
- **GSS-SYNC-005 (P0):** Recalculate dependent visual timing after audio regeneration or edits without overwriting deliberate user choices without notice.
- **GSS-SYNC-006 (P0):** Warn about missing images, missing audio, duplicate assignments, unmatched scene IDs, and uncovered timeline ranges.
- **GSS-SYNC-007 (P1):** Support a configurable synchronization policy (for example distribute images evenly inside a scene or pin durations manually).

### 4.7 Video Editor

- **GSS-EDIT-001 (P1):** Provide an editable multitrack timeline with image, narration, dialogue, music, SFX, and subtitle tracks.
- **GSS-EDIT-002 (P1):** Support playback, seek, zoom, navigation, drag/reorder, trim, split, and merge.
- **GSS-EDIT-003 (P1):** Display image thumbnails and audio waveforms when assets are available.
- **GSS-EDIT-004 (P1):** Support volume, mute, solo, fade-in/out, and crossfade controls for applicable audio clips.
- **GSS-EDIT-005 (P1):** Support image transitions and static/slow zoom/pan/Ken Burns effects.
- **GSS-EDIT-006 (P0):** Treat canonical timeline data as the source of truth; no independent guessed clip durations.
- **GSS-EDIT-007 (P0):** Keep preview and render calculations derived from the same edit-decision data.

### 4.8 Subtitle Studio

- **GSS-SUB-001 (P0):** Generate SRT and WebVTT from source text and actual segment/phrase timing.
- **GSS-SUB-002 (P0):** Support styling metadata for font, position, size, color, background, and optional character-specific styling in the editor/render profile.
- **GSS-SUB-003 (P0):** Offer word-level subtitles only when trustworthy word timing exists.
- **GSS-SUB-004 (P1):** Support subtitle preview and manual correction before export.
- **GSS-SUB-005 (P0):** Preserve subtitle timing consistency with the canonical project timebase.

### 4.9 Browser rendering and export

- **GSS-RENDER-001 (P0):** Render on-device in the browser without paid APIs, cloud rendering, user-installed command-line tools, native apps, or local sidecars.
- **GSS-RENDER-002 (P0):** Support MP4 with H.264 video and AAC audio when the browser exposes compatible encoders or a bundled, license-compliant WebAssembly encoder is available; capability-check before starting and provide an explicit supported fallback when not available.
- **GSS-RENDER-003 (P0):** Support 720p and 1080p; 24, 25, and 30 FPS; configurable aspect ratio.
- **GSS-RENDER-004 (P0):** Composite images, transitions/effects, narration/dialogue, music, SFX, and subtitles from canonical timeline data.
- **GSS-RENDER-005 (P0):** Normalize final audio with user reviewable settings and avoid clipping.
- **GSS-RENDER-006 (P0):** Show real render progress when the engine exposes it; otherwise show honest indeterminate progress.
- **GSS-RENDER-007 (P0):** Support cancellation and safe cleanup; resume/retry from persisted stages where the renderer makes it practical.
- **GSS-RENDER-008 (P0):** Validate output duration, dimensions, frame rate, codecs, and file readability before declaring render success.
- **GSS-RENDER-009 (P0):** Export a ZIP containing final media, source images, audio segments, metadata, subtitles, and README.
- **GSS-RENDER-010 (P0):** Preserve project metadata sufficient to reopen and continue editing.
- **GSS-RENDER-011 (P0):** Support timelines of at least two hours, including hour-aware rulers, time displays, export metadata, and long-duration synchronization without fixed one-hour caps. Rendering must use chunked/segmented processing and device capability checks rather than assuming a one-hour export is feasible on every phone.

## 5. Canonical data and timing requirements

The canonical project data must be versioned and schema-validated. At minimum it must represent:
- Project identity, schema version, title, creation/update times, and project settings.
- Original source script and parsed chapters/scenes/segments.
- Speakers, voice selections, and engine/model provenance.
- Local asset registry for images, audio, subtitle, and rendered outputs.
- Contact sheet extraction geometry and user crop decisions.
- Scene/image mappings, including many-to-many links.
- Audio sample counts, sample rate, channel layout, and asset duration.
- Video FPS as an explicit rational number and timeline positions in an integer/rational tick domain.
- Subtitle cues and optional alignment provenance.
- Tracks, clip trims, transitions, image effects, mix settings, and render profile.
- Job status and recoverable stage metadata.

Floating-point seconds may be displayed in the UI, but source timing must be traceable to samples or frame/tick positions. Rounding occurs only at a declared conversion boundary.

## 6. Privacy, security, and dependency requirements

- **GSS-SEC-001 (P0):** No script, image, audio, generated media, or project content is sent to a remote service by default.
- **GSS-SEC-002 (P0):** No analytics, telemetry, or crash upload contains user project content. Any optional diagnostic sharing must be explicit and scrubbed.
- **GSS-SEC-003 (P0):** Validate file types, sizes, archive paths, and imported project structure. Prevent ZIP path traversal and unsafe extraction.
- **GSS-SEC-004 (P0):** Use object URL and temporary asset cleanup; avoid deleting user originals or autosaved projects as part of routine cleanup.
- **GSS-SEC-005 (P0):** Keep app distribution MIT unless a deliberate, documented licensing change is made after review.
- **GSS-SEC-006 (P0):** Audit the license of every engine, runtime, model, voice, codec, and bundled asset independently. A code license does not automatically license weights or voices.
- **GSS-SEC-007 (P0):** Provide license notices and provenance for redistributable assets and corresponding source where a license requires it.
- **GSS-SEC-008 (P0):** Do not ship optional copyleft engines or codec builds in a way that silently changes the product's distribution obligations.
- **GSS-SEC-009 (P0):** No API keys or secrets are required for normal local operation.

## 7. Platform and performance requirements

- **GSS-PLAT-001 (P0):** The web build works as a static site for browser-supported local tasks.
- **GSS-PLAT-002 (P0):** Core application code is shared between web and optional desktop builds.
- **GSS-PLAT-003 (P0):** Browser feature detection is required for directory handles, WebAssembly threading, audio decoding, and storage quotas; unsupported features need clear fallbacks.
- **GSS-PLAT-004 (P0):** The normal user workflow must not require a native desktop host or a separately installed phone application; browser capability differences must be disclosed and handled with supported browser paths.
- **GSS-PLAT-005 (P0):** Long operations run off the main UI thread where feasible and report cancellation/progress status truthfully.
- **GSS-PLAT-006 (P0):** Respect storage quotas and provide clear warnings before operations likely to exceed available memory or disk.
- **GSS-PLAT-007 (P0):** A project that exceeds available resources must fail safely without corrupting existing project data.

## 8. Usability and interface requirements

- **GSS-UX-001 (P0):** Use a professional dark production-studio interface, with clear distinction between projects, script, scenes, speakers, audio, images, mapping, timeline, preview, and export.
- **GSS-UX-002 (P0):** The UI must not resemble a generic chatbot; the primary interaction is an editor/workspace.
- **GSS-UX-003 (P0):** Show the active stage, readiness, warnings, and job status.
- **GSS-UX-004 (P0):** Preserve working GridSplit extractor UI and functionality during the staged migration.
- **GSS-UX-005 (P0):** Make operations keyboard accessible, responsive, and understandable on supported screen sizes.
- **GSS-UX-006 (P0):** Never show a control as enabled when the installed provider cannot perform that operation.

## 9. Acceptance criteria and release gates

The product is not considered complete until all P0 requirements pass and the following are demonstrated in a clean mobile and desktop browser profile, using only the website and browser-managed downloads:

1. Create and save a project; close and restore it.
2. Import a long script and verify the original text remains unchanged.
3. Parse narrator, character, SFX, and music markers; manually correct a scene.
4. Generate at least two offline voice segments; fail and retry one segment without replacing successful audio.
5. Measure each segment from actual samples and produce valid timeline metadata.
6. Produce SRT and VTT; confirm no unsupported word-level timings are fabricated.
7. Import numbered images and a contact sheet; naturally sort, extract, and manually correct images.
8. Map multiple images to one scene and one image across multiple scenes; display all warnings for unmatched assets.
9. Synchronize visuals against real segment durations and a chosen FPS.
10. Edit image/audio clips and preview the result.
11. Render a readable MP4 in the browser, without a local sidecar, Python, FFmpeg executable, or native app installation; record any codec fallback.
12. Import, map, edit, preview, and export a project with at least 1,200 images, and exercise the 2,400-image product ceiling subject to available storage.
13. Edit and synchronize a two-hour timeline, and confirm hour-aware displays, metadata and export timing.
14. Export and reopen a ZIP project, confirming assets, timeline, subtitles, and edit decisions remain intact.
15. Verify no project media was transmitted to an application server.
16. Verify the licenses/notices for every distributed binary, model, voice, and codec.

### Milestone-level acceptance

Milestone acceptance and evidence are maintained in `docs/CHECKPOINTS.md`. The master product requirements are not a replacement for milestone tests.

## 10. Requirement change control

- The public website is the complete user interface; do not require the user to install anything on a phone or computer to access core functionality.
- Model/codec assets may be downloaded and cached by the browser after clear disclosure; browser capability and device resource limits must be visible before long operations.

- Add new requirements with a stable ID, priority, owner decision, and acceptance criteria.
- If an implementation cannot satisfy a requirement, document the constraint and propose a local/offline alternative; do not silently relax it.
- Any use of network access for optional model/voice downloads must be user initiated, clearly disclosed, and never required for processing after the asset is installed.
- Any license change or dependency with copyleft obligations is an explicit release decision, not an incidental package addition.
- Update this file's version and the changelog when requirements materially change.
