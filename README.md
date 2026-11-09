# GridSplit

GridSplit turns storyboard contact sheets and image grids into separate, sequentially named image files.

**No AI. No OCR. No backend.** Image analysis, cropping, and ZIP generation run entirely in the browser using the Canvas API and traditional pixel-based boundary detection.

## Features

- Upload PNG, JPG, WebP, GIF, and other formats supported by the browser (up to 100 MB).
- Detect likely horizontal and vertical separators from pixel contrast and dark border continuity.
- Preview every detected tile before export.
- Select or deselect individual tiles to omit title cards, empty cells, and merged panels.
- Apply a manually specified, evenly spaced row/column grid when automatic detection needs help.
- Configure border trim, filename prefix, starting number, and zero-padding.
- Export selected tiles as lossless PNG crops in a ZIP, alongside a CSV manifest.
- Keep source images on-device; there are no image uploads, accounts, or third-party processing services.

## Run locally

Requirements: Node.js 20 or newer and npm.

\`\`\`bash
npm install
npm run dev
\`\`\`

Open the local URL printed by Vite.

## Production build

\`\`\`bash
npm run typecheck
npm run build
npm run preview
\`\`\`

The static production output is written to \`dist/\` and can be deployed to Vercel, Netlify, GitHub Pages, or any static host.

## How detection works

GridSplit samples luminance across the image and scores each row and column for local contrast and dark separator-like pixels. Candidate lines are smoothed, thresholded, ranked, and used to build a set of crop rectangles. It is a heuristic, not a semantic image understanding system: textured artwork, thin borders, merged cells, and uneven layouts can require manual correction. Review the tile gallery and deselect non-frame cells before exporting.

The "Apply even grid" option is a fallback for regular sheets where you know the number of rows and columns. Auto-detected boundaries are retained as independent positions, so uneven row heights can still be used.

## Privacy

All processing happens in the browser tab. GridSplit does not transmit images to a server. PNG output preserves the decoded source pixels without introducing additional lossy compression.

## Current scope

This first release supports one contact sheet per session. Manual correction currently focuses on row/column count and per-tile inclusion; direct dragging of individual separator lines and batch upload are planned improvements.

## License

MIT
