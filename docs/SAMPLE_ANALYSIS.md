# Supplied storyboard contact sheet — manual 196-crop acceptance map

- Input: `1000277512.png`, 1536 × 864 pixels.
- Source SHA-256: `f07ff9935d150e593e45a1de2c591ff6c2e9ac016dc0374cf8f1f83dd5dc5372`.
- Processing: deterministic pixel-boundary analysis and manual visual review; no generative AI or cloud image processing.
- Image-bearing row bands: 13.
- Preliminary TypeScript detector result recorded by the reference probe: 210 candidate rectangles (12 rows of 16 plus a final row of 18).
- Requested output count: 196 individual crops.

## Manual correction map

The supplied sheet is irregular. The title card spans two detector candidates in the first row, the last row contains a "To Be Continued" card, and 11 repeated-number panels must be excluded to meet the requested 196-crop interpretation.

Apply these corrections to the detector's 210 candidates:

1. In row 1, merge candidate columns 1 and 2 to reconstruct the wide title card, then exclude that merged title card.
2. Exclude the repeated-number panels at these one-based row/column positions: R2C11, R3C13, R4C15, R5C11, R6C12, R7C14, R8C16, R9C13, R10C12, R11C13, and R12C13.
3. Exclude R13C17, the "To Be Continued" card.
4. Keep the remaining image panels in row-major order.

Count arithmetic: 210 preliminary candidates − 1 title-card merge − 1 title card − 11 repeated-number panels − 1 continuation card = **196 selected crops**.

The repeated-number exclusions are a manual interpretation of the user's requested 196-image result, not semantic image recognition. GridSplit does not infer story meaning or use AI to decide which panels belong in a sequence. The user must review the proposed crop selection before exporting.

## Diagnostic export generated during this continuation

An independent deterministic crop pass over this exact source produced a ZIP containing:
- 196 PNG files named `frame-001.png` through `frame-196.png`;
- `manifest.csv` with one row per crop and source row/column plus pixel coordinates; and
- `README.txt` describing the manual correction boundary.

Diagnostic ZIP SHA-256: `2f8c3f82c793b3a3f24ee4fc0bcdcd3921fc1e78f2dd144adbc3b08356eb8206`.

**Important boundary:** this diagnostic ZIP was generated independently from the image using a manually reviewed crop map. It is not an export from the deployed GridSplit browser UI and does not prove that the app's detector automatically reaches 196. It is a reference output for comparing the browser result and the crop geometry.

## Numbering discrepancy to resolve

The companion `The_Bell_Beneath_Blackwater_Script.md` lists 198 intended shots. The contact sheet contains repeated/misprinted visible labels and does not provide a clean one-to-one numbered sequence (for example, the first row skips a visible 012 label and the final row does not show a clean 197 label). Therefore the 196-crop output follows the explicit contact-sheet target, but it must not be treated as a reconciled 198-shot script manifest until those two counts are resolved.

## Automated ZIP regression coverage

The Vitest regression exercises the portable image ZIP exporter with 196 selected crop records and a mocked browser canvas. It verifies:
- 196 distinct PNG paths with stable `frame-001.png` through `frame-196.png` numbering;
- 197 CSV lines (header plus one manifest record per crop);
- representative manifest coordinates and gutter-adjusted dimensions;
- exactly 196 canvas draw/PNG-encoding calls; and
- filename-prefix sanitization against path separators.

This is an export/manifest unit test. The mocked canvas does not prove image-pixel correctness, actual browser canvas decoding, automatic detection accuracy, or acceptance of this sample.

## Verification still required

- Run the real TypeScript implementation in a browser with the original 1536 × 864 sample.
- Apply the correction map above and visually review all 196 browser crops.
- Export from the browser UI and compare the 196 PNGs and manifest against the diagnostic ZIP.
- Resolve the 196 contact-sheet target versus the 198-shot companion script before final video assembly.
- Separately complete M36 with real story images/audio, local Kokoro generation, FFmpeg rendering, media-inclusive archive restore and re-render on the target device.
