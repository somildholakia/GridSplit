# Smart Sync — Google Drive analysis and direct Colab rendering

Smart Sync creates a narration-aware image timeline from an image ZIP and soundtrack without uploading the source media through the browser or ChatGPT.

## One-notebook workflow

1. In Motion Studio, download **Smart Sync + Live Colab notebook (.ipynb)**.
2. Open it in Google Colab and choose **Runtime → Change runtime type → T4 GPU** when available.
3. Run the notebook and approve the Google Drive mount.
4. Confirm `FOLDER_PATH`, `IMAGE_ZIP_NAME`, and `AUDIO_FILE_NAME`. The defaults target the Mars E1 folder and files supplied for this task.
5. The notebook transcribes the WAV with faster-whisper, extracts the images in natural filename order, compares image content with timestamped narration windows using CLIP, and generates `gridsplit-sync.json` in the Drive folder. It also starts the direct Colab rendering gateway and prints a temporary Cloudflare Quick Tunnel URL.
6. Import the generated JSON in Motion Studio using **Import sync JSON**. The website does not need the 1.28 GB ZIP or 233 MB WAV loaded locally.
7. Paste the tunnel URL into **Colab Quick Tunnel URL**, select **Test Connection**, and click **Render directly from Google Drive on Colab**.

## What gets matched

- faster-whisper generates timestamped narration segments.
- Transcript windows are compared with CLIP image embeddings.
- A monotonic dynamic-programming pass keeps the ordered images in their original sequence while selecting the best-fitting narration windows.
- Smoothed image boundaries cover the complete soundtrack without timeline gaps.
- If transcription contains no speech, the analyzer labels the output as an even-timing fallback rather than claiming semantic alignment.

The JSON format is `gridsplit-motion-sync`, version 1. Each image entry includes its relative ZIP filename, start/end seconds, matched transcript excerpt and similarity-derived confidence. Similarity is a ranking signal, not a calibrated probability.

## Direct Drive render

The browser sends only the mounted Drive folder path, ZIP/audio filenames, sync JSON, and render settings to Colab. Colab validates the media, extracts the selected images to a temporary runtime workspace, copies the soundtrack, builds a standard GridSplit project and runs the existing FFmpeg renderer. The validated MP4 is returned to the website in retryable byte ranges.

Source media remains in Google Drive. Temporary extracted copies and rendered output are stored in the Colab runtime and cleaned with the normal renderer job lifecycle. Keep the Colab runtime and its tunnel running until the MP4 has downloaded. The tunnel URL is a temporary bearer link; do not share it publicly.

## Capacity and limitations

- Colab gateway project uploads support up to 3 GB, while direct Drive rendering avoids sending the source ZIP through the browser entirely.
- Extracted media is limited to 8 GB and the ZIP to 10,000 entries.
- The free Colab T4 is not guaranteed. The renderer probes NVENC and falls back to CPU libx264 if GPU encoding is unavailable or fails.
- The website can apply the manifest to already imported media for timeline preview; direct Drive render does not require browser media import.
- Image matching quality depends on how well CLIP similarity represents the narration. Review the JSON and timeline before final publication.


## Troubleshooting: faster-whisper / PyAV

The notebook explicitly installs `faster-whisper==1.2.1` with `av==18.1.0`. The released faster-whisper decoder passes the `metadata_errors` keyword to `av.open`, while PyAV 19 removed that keyword. Installing an unpinned latest PyAV can therefore break both CUDA transcription and the CPU fallback.

When running an older copy of the notebook, execute this cell:

```python
!pip -q install --force-reinstall --no-deps "av==18.1.0"
```

Then choose **Runtime → Restart session** and run the notebook again. The Ubuntu apt mirror source warning and unauthenticated Hugging Face Hub warning do not cause this PyAV exception; a Hugging Face token is optional and only affects download rate limits.
