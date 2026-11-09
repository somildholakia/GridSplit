# GridSplit — Project Status

Last updated: 2026-11-09

## Current checkpoint

**MVP foundation committed on \`main\`.**

Latest implementation commit before this checkpoint: \`f42caa4a17df40c9640270e1c75903ac6302d7ed\` — Improve separator detection and sanitize ZIP filenames.

## Product goal

A static, browser-only utility that converts storyboard contact sheets and image grids into individual image crops. The product must not use generative AI, machine learning, OCR, remote image-processing APIs, or an image-upload backend.

## Implemented

- React 18 + TypeScript + Vite application shell.
- Dark responsive UI for upload and extraction review.
- Local image loading through the browser File API.
- Traditional pixel-intensity / contrast projection for likely horizontal and vertical separators.
- Separate crop rectangles based on detected boundaries.
- Tile gallery with include/exclude selection.
- Evenly spaced manual row/column fallback.
- Adjustable border trim.
- Custom filename prefix, start number, and zero-padding.
- Sequential PNG cropping with JSZip download.
- CSV manifest and ZIP README.
- Filename-prefix sanitization.
- Project README, MIT license, and GitHub Actions build workflow.

## Current limitations

- The detector is heuristic. It can mistake strong artwork edges for separators or miss faint / interrupted borders.
- The review UI supports selecting and excluding tiles, but not dragging individual boundaries.
- The even-grid fallback assumes equal cell dimensions.
- Merged panels are currently split by detected global boundaries and must be excluded manually when they are not individual frames.
- One contact sheet is processed per session.
- A full dependency install, TypeScript build, and browser end-to-end test have not yet been confirmed in this environment.

## Next milestones

1. Run \`npm install\`, \`npm run typecheck\`, and \`npm run build\`; fix any compile issues.
2. Test the supplied 1536 × 864 storyboard contact sheet and compare the generated tile count against the expected 196 frames.
3. Improve local separator continuity so merged title panels and interrupted lines are handled more accurately.
4. Add draggable boundary editing and per-row / per-column corrections.
5. Add a crop-edge / grid overlay on the source image.
6. Add test fixtures for regular grids, uneven rows, dark contact sheets, and merged cells.
7. Add multi-file batch processing and deployment configuration after extraction accuracy is stable.

## Local development

\`\`\`bash
npm install
npm run dev
npm run typecheck
npm run build
\`\`\`

No checkpoint should be marked complete until its implementation and verification are both done.
