# Supplied storyboard contact sheet — preliminary probe

- Input: 1536 × 864 pixels.
- Processing type: non-AI luminance, contrast, autocorrelation, and spacing-constrained boundary selection.
- Horizontal row bands: 13 image-bearing bands.
- Dark footer: the trailing 32-pixel strip was rejected as a near-uniform dark band.
- Preliminary regions: approximately 210.
- Desired final count: 196 individual image crops.

## Interpretation

The first-generation global grid detector is not suitable for this sheet because column separators shift between rows. The row-aware prototype treats each image band independently and uses a per-row tile pitch.

The preliminary count is intentionally not treated as a pass. The visible sheet includes a title panel, a continuation panel, and some inconsistent/merged borders. The website's tile actions allow users to split, merge, include, and exclude individual crop regions.

## Verification still required

- Run the real TypeScript implementation in the browser.
- Confirm row boundaries and every crop visually.
- Correct the preliminary 210 regions to the expected 196.
- Export the ZIP and verify it contains 196 PNGs plus its manifest and README.