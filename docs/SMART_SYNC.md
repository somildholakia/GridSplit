# Smart Sync — Google Drive analysis for Motion Studio

Smart Sync creates a narration-aware image timeline from an image ZIP and a soundtrack without uploading either source file to ChatGPT.

## Colab workflow

1. Open Motion Studio and download **Drive Smart Sync analyzer (.ipynb)**.
2. Open the notebook in Google Colab and select a T4 GPU when available.
3. Run the cell and approve Google Drive mounting.
4. Set `FOLDER_PATH`, `IMAGE_ZIP_NAME`, and `AUDIO_FILE_NAME` to the source files in the mounted Drive. The notebook defaults to the sample folder and filenames used for the Mars E1 source.
5. Wait for audio transcription and visual/text matching. The notebook downloads `gridsplit-sync.json` and also saves it beside the source files in Drive.
6. In Motion Studio, load the images and the exact audio file, then choose **Import sync JSON**. The importer validates the audio filename, duration, image set, and contiguous timeline before applying the schedule.

## Analysis

- Images are extracted from the Drive ZIP in natural filename order.
- faster-whisper transcribes speech into timestamped segments.
- The CLIP vision/text model scores image content against short narration windows.
- A monotonic dynamic-programming pass keeps image order chronological while selecting the best matching speech windows.
- Timeline boundaries are smoothed toward the soundtrack duration and cover the full audio without gaps.
- If transcription contains no speech, the analyzer emits a clearly labeled even-timing fallback rather than claiming semantic alignment.

The JSON includes `format: "gridsplit-motion-sync"`, `version: 1`, audio filename/duration, per-image start/end seconds, matched narration text, and similarity-derived confidence. The confidence is a model similarity indicator, not a calibrated probability.

## Current integration boundary

The notebook reads the media directly from Drive and generates the timing manifest. Motion Studio's JSON importer applies those timings to media already loaded into the browser workspace; it currently does not mount or browse Google Drive from the website. The source media remains in Drive throughout analysis. The app's separate Colab renderer still receives the portable project archive from Motion Studio.

## Large media and Colab

The Colab gateway now accepts project archives up to 3 GB in retryable 3 MB chunks. Extracted media is limited to 8 GB and 10,000 archive entries. Colab runtime disk capacity and session/GPU limits remain controlled by Google. NVENC is used only when available and verified; otherwise FFmpeg falls back to CPU libx264.
