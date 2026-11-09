# GridSplit

GridSplit turns storyboard contact sheets and image grids into separate, sequentially named image files.

**No AI. No OCR. No backend.** Image analysis, cropping, and ZIP generation run entirely in the browser using the Canvas API and traditional pixel-based boundary detection.

## Features

- Upload PNG, JPG, WebP, GIF, and other formats supported by the browser (up to 100 MB).
- Detect horizontal row bands, then estimate vertical separators independently for each row.
- Preview every detected tile before export.
- Select or deselect individual tiles; split wide tiles or merge adjacent tiles in the same row.
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

GridSplit first finds horizontal image bands, then analyses each band independently. For each row it builds a luminance/contrast projection, estimates the repeated tile pitch through normalized autocorrelation, and uses a spacing-constrained dynamic program to select likely vertical separators. This allows neighbouring rows to have different widths and different numbers of tiles. It is traditional image processing, not semantic image understanding: textured artwork, missing borders, merged cells, and very irregular layouts can still require manual correction.

The "Apply uniform grid" option is a fallback for sheets with a known regular layout. In automatic mode, each row keeps its own detected boundaries. Use "Split" to divide a wide tile in half, "Merge" to join it with the next tile in the same row, or click a tile to include/exclude it.

## Privacy

All processing happens in the browser tab. GridSplit does not transmit images to a server. PNG output preserves the decoded source pixels without introducing additional lossy compression.

## Current scope

This release processes one contact sheet per session. Manual correction currently includes per-tile inclusion, horizontal split, and merge-with-next actions. Direct dragging of separator lines, batch upload, and deeper validation fixtures remain planned.

## License

MIT
