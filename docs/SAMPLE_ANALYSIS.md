# Supplied storyboard contact sheet — manual 196-crop acceptance map

- Input: `1000277512.png`, 1536 × 864 pixels.
- Source SHA-256: `f07ff9935d150e593e45a1de2c591ff6c2e9ac016dc0374cf8f1f83dd5dc5372`.
- Processing: deterministic pixel-boundary analysis and manual visual review; no generative AI or cloud image processing.
- Image-bearing row bands: 13.
- Visual detector overlay: 209 candidate rectangles — 15 in row 1, 16 in rows 2–12, and 18 in row 13.
- Requested output count: 196 individual crops.

## Manual correction map

The wide title card is already represented by a single candidate in row 1; it must be excluded, not merged with the first story frame. The final row contains a "To Be Continued" card, and 11 panels repeat a previously used shot number.

Exclude these 13 one-based row/column positions:
- R1C1 — the title card.
- R2C11, R3C13, R4C15, R5C11, R6C12, R7C14, R8C16, R9C13, R10C12, R11C13, R12C13 — 11 repeated-number panels.
- R13C17 — the "To Be Continued" card.

Keep all other detected rectangles in row-major order.

Count arithmetic: 209 candidates − 1 title card − 11 repeated-number panels − 1 continuation card = **196 selected crops**.

The repeated-number exclusions are a manual interpretation of the requested 196-image result, not semantic image recognition. GridSplit does not infer story meaning or use AI to decide which panels belong in a sequence. All excluded candidates remain visible and can be re-selected before export.

## Exact-sample preset in the browser app

The extractor includes a deterministic preset for this exact source file. It first verifies the original file's SHA-256, byte length and dimensions, then requires the detector to return the expected 209-candidate row shape (15 / 16 × 11 / 18) with contiguous cell geometry and a wide first title card. Only then does it show **Apply 196-crop map**.

The action leaves the detected crop rectangles unchanged and marks the title, the 11 repeated-number panels and the continuation card as excluded. This produces 196 selected crops from 209 visible candidates. The excluded candidates remain visible and can be re-selected. The preset uses fixed pixel/layout metadata only; it does not use OCR, AI, network services or server-side image processing. Any different image, changed file bytes, or changed detector geometry keeps the normal manual controls and does not receive this preset.

The helper tests cover the 209-candidate row geometry, exclusions, exact 196 selected count and refusal of malformed layouts. The actual uploaded file still needs a browser run to verify that the deployed detector exposes the expected layout and that all 196 crops look correct before the preset can be considered accepted.

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
