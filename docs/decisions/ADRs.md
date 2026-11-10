# Architecture Decision Records — GridSplit Studio

**Status:** M03 baseline decisions  
**Date:** 2026-11-10

## ADR-0001: Shared web application with optional native processing host

**Status:** Accepted

**Decision:** Keep React, TypeScript, and Vite as the shared application UI. Implement platform capabilities behind processing-host and storage interfaces. The web build runs browser-supported local work; a future optional Tauri v2 host can expose local filesystem operations and native process execution for large media tasks.

**Reasons:** Preserves the existing app and static-host option while acknowledging that browsers cannot directly launch native binaries and can have memory, file API, and cross-origin isolation limitations.

**Consequences:** UI cannot directly depend on Tauri APIs or native tools. Host adapters require explicit capability detection and tests. Desktop is optional, not a mandatory hosted service.

## ADR-0002: Canonical project data and exact media time

**Status:** Accepted

**Decision:** Version the project schema from version 1 and treat `project.json` as canonical metadata. Store audio source positions as integer sample counts with sample rate; video as integer frame indices with rational FPS; cross-media timeline positions as normalized rational seconds serialized with decimal-string numerator/denominator. Use BigInt internally.

**Reasons:** Avoids guessed durations, floating-point drift, and loss of precision when aligning source media with multiple sample rates and frame rates.

**Consequences:** UI must format values separately from storage. Rational conversion and migration utilities require unit tests. Timeline, subtitle and render projections must derive from the same edit-decision records.

## ADR-0003: Local TTS engines and model licensing are separate concerns

**Status:** Accepted

**Decision:** Implement a local TTS provider abstraction first. Evaluate Kokoro ONNX as the first model candidate with ONNX Runtime Web/native. Do not bundle Piper or eSpeak NG by default because their current upstream projects are GPL-licensed and would require an explicit, reviewed redistribution strategy. Treat voices, tokenizer/phonemizer packages, runtimes and models as separate license items.

**Reasons:** The application is MIT-licensed and the product requires transparent, reusable local software. A permissive model license does not automatically cover the complete inference stack or all voice assets.

**Consequences:** M13/M14 must pin versions and perform offline/quality/performance tests before integration. No model or voice is bundled by M03.

## ADR-0004: Rendering is local and capability-driven

**Status:** Accepted

**Decision:** Implement rendering through an optional Python sidecar that invokes the user's system-installed FFmpeg/ffprobe process. The sidecar binds to loopback only, requires an explicit exact-origin allowlist, validates project archives, exposes progress/cancellation, and validates the resulting MP4. Do not bundle or download FFmpeg or codecs in the web application.

**Reasons:** Browser renderers have memory/threading constraints; native processes improve large-file reliability but need an explicit local host. FFmpeg licensing changes based on compile-time options and linked libraries.

**Consequences:** H.264/AAC profiles require support from the exact installed FFmpeg build; GridSplit checks the resulting stream metadata with ffprobe. The user is responsible for installing and licensing that build. Rendering remains optional, local and never falls back to a cloud API.

## ADR-0005: Local assets with portable project archives

**Status:** Accepted

**Decision:** Use IndexedDB for project metadata and Blob fallback; OPFS is a progressive enhancement for large asset storage. A future desktop host may provide a native project directory. The versioned ZIP export is the portability boundary and never contains machine-specific absolute paths.

**Reasons:** Supports browser storage and project portability without a server dependency.

**Consequences:** Storage quota and archive validation are release-critical. Project import validates before writes; cleanup distinguishes temporary/cache assets from user-owned source media.
