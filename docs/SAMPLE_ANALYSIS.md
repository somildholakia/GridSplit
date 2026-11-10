# Supplied storyboard contact sheet — preliminary probe

- Input: `1000277512.png`, 1536 × 864 pixels.
- Processing type: non-AI luminance, contrast, autocorrelation, and spacing-constrained boundary selection.
- Horizontal row bands: 13 image-bearing bands.
- Dark footer: the trailing 32-pixel strip was rejected as a near-uniform dark band.
- Candidate regions in the reproducible reference probe: 210 (12 rows of 16 plus a final row of 18).
- Desired final count: 196 individual image crops.

## Interpretation

The first-generation global grid detector is not suitable for this sheet because column separators shift between rows. The row-aware algorithm treats each image band independently and uses a per-row tile pitch.

The 210-region number is a preliminary detector result from a reference implementation of the current TypeScript boundary-selection logic. It is not evidence that the deployed browser run has been completed or that the candidate rectangles are all visually correct. It is 14 above the requested 196-crop result. The visible sheet includes title/continuation material and inconsistent or merged borders; the tile review controls support manual split, merge, include and exclude corrections.

## ZIP export regression coverage

A Vitest regression now exercises the portable image ZIP exporter with 196 selected crop records and a mocked browser canvas. It verifies:
- 196 distinct PNG paths with stable `frame-001.png` through `frame-196.png` numbering;
- 197 CSV lines (header plus one manifest record per crop);
- first/last manifest coordinates and gutter-adjusted dimensions;
- exactly 196 canvas draw/PNG-encoding calls; and
- filename-prefix sanitization against path separators.

This is an export/manifest unit test. The mocked canvas deliberately does not prove image-pixel correctness, actual browser canvas decoding, automatic detection accuracy, or acceptance of this sample.

## Verification still required

- Run the real TypeScript implementation in the browser with the original 1536 × 864 sample.
- Confirm row boundaries and every crop visually; correct the preliminary 210 regions to the expected 196.
- Export the browser result and verify the archive contains the 196 expected PNG crops plus its manifest and README.
- Separately complete M36 with real story images/audio, local Kokoro generation, FFmpeg rendering, media-inclusive archive restore and re-render on the target device.
