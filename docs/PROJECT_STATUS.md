# GridSplit — Project Status

Last updated: 2026-11-09

## Current checkpoint

**Row-aware extraction and manual tile correction committed on `main`.**

Latest implementation commit: `8fb2305f8ab2e3e92e6adbdc5c0fda815e9cd00c`.

## Product goal

A static, browser-only utility that converts storyboard contact sheets and image grids into individual image crops. Do not use generative AI, machine learning, OCR, remote image-processing APIs, or an image-upload backend.

## Implemented

- React 18 + TypeScript + Vite application shell and responsive dark interface.
- Local image loading through the browser File API.
- Traditional luminance / contrast projection for horizontal row-band detection.
- Per-row vertical separator analysis rather than one shared global column grid.
- Normalized autocorrelation to estimate the tile pitch in each row.
- Spacing-constrained dynamic programming to select plausible separators.
- Dark, nearly uniform footer-band suppression.
- Tile gallery with include/exclude selection.
- Manual per-tile split and merge-with-next controls.
- Uniform row/column fallback.
- Adjustable border trim.
- Custom filename prefix, start number, and zero-padding.
- Sequential PNG cropping with JSZip download.
- CSV crop manifest and ZIP README.
- Local-only image processing and filename-prefix sanitization.
- MIT license and GitHub Actions build workflow.

## Sample-sheet investigation

The supplied storyboard sheet is 1536 × 864 pixels. A Python reference implementation of the row-wise scoring and boundary-selection logic found 13 image-bearing horizontal bands and identified the final 32-pixel strip as a dark footer rather than another image row.

The reference probe produced approximately 210 candidate crop rectangles before manual review. This is a preliminary segmentation result, **not** proof that the requested final total of 196 has been achieved. The contact sheet contains title/continuation panels, repeated or irregular borders, and uneven row layouts. The app now provides per-tile split/merge and include/exclude controls for correction.

The TypeScript application itself has not yet been run through a dependency install, TypeScript build, or browser end-to-end test in this environment. Do not mark the 196-image sample target complete until the website build runs and the exported ZIP is inspected.

## Current limitations

- Separator detection remains heuristic and may select artwork edges or miss faint / interrupted borders.
- Row-wise pitch estimation can be less reliable on short rows or highly irregular layouts.
- Split divides a tile at its horizontal midpoint; Merge joins a tile to the next tile in the same row.
- The current editor does not provide freehand boundary dragging or arbitrary crop handles.
- One contact sheet is processed per session.
- Production build and browser download flow still need verification.

## Next milestones

1. Verify `npm install`, `npm run typecheck`, and `npm run build` in a Node 22 environment.
2. Run the website against the supplied contact sheet; inspect the detected row bands and the 210 preliminary regions.
3. Correct the segmentation to reach the expected 196 individual images, then export and inspect all files.
4. Add automated fixtures for regular grids, merged title panels, variable row widths, footer strips, and dark fantasy images.
5. Add draggable crop-boundary editing and batch upload.
6. Configure Vercel deployment after the extraction workflow is verified.

## Local development

```bash
npm install
npm run dev
npm run typecheck
npm run build
```

No milestone should be marked complete until implementation and verification are both done.