# Image Extraction Feature

The existing GridSplit contact-sheet workflow lives here.

## Preservation contract

- Keep the row-aware detector and crop exporter in `src/lib` until they are moved with parity tests.
- Keep uploads, image decoding, crop analysis, manual tile inclusion, split/merge, border trim, and ZIP creation local to the device.
- Keep the current user-facing extractor behavior while the broader studio shell is introduced.
- Do not replace real extraction with mock data or placeholder output.

## Current entry point

`ImageExtractionApp.tsx` is the existing GridSplit app screen. `src/App.tsx` composes it as the initial application route until the project/dashboard navigation is implemented.
