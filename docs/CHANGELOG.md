# Changelog

## Unreleased — M17–M21 implementation

- Added WAV-header remeasurement from locally stored audio blobs and exact rational sample-derived durations.
- Added versioned deterministic synchronization JSON with scene and segment timing.
- Added segment-level SRT and WebVTT export without claiming word alignment.
- Added extractor regression fixtures for flat-image fallback and even-grid boundaries.
- Added multi-file/folder image intake, natural filename ordering, validation, queue removal, and a local ZIP/CSV source bundle.
- Existing M14–M16 real-model Kokoro smoke test remains pending; no manual runtime verification is implied by these changes.
