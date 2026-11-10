# Third-party notices

## Mozilla PDF.js

GridSplit Studio bundles `pdfjs-dist` version `6.5.438`, the JavaScript PDF reader distributed by Mozilla PDF.js.

- Project: https://github.com/mozilla/pdf.js
- Package: https://www.npmjs.com/package/pdfjs-dist
- License: Apache License, Version 2.0
- License text: https://www.apache.org/licenses/LICENSE-2.0

PDF.js is used locally in the browser to extract selectable text from PDF scripts. The application bundles its matching worker asset; PDF files are not sent to a conversion service.

The upstream project retains its copyright and license notices. See the upstream distribution for the complete license text and any notices applicable to the bundled release.

## Optional Kokoro ONNX local TTS

GridSplit does not bundle Kokoro models, voice assets, or a Python runtime. Users may install the optional sidecar in [local-tts/README.md](local-tts/README.md).

- The current PyPI page lists `kokoro-onnx` 0.6.1 as MIT licensed and the Kokoro model as Apache-2.0. See https://pypi.org/project/kokoro-onnx/.
- Each voice, phonemizer, model, runtime, and transitive dependency keeps its own license and provenance. Do not assume a single model license covers the entire stack.
- The sidecar does not download or redistribute user-installed files. Verify exact revisions and notices before shipping a combined runtime.

This inventory is not legal advice.
