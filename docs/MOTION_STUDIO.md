# GridSplit Motion Studio

Motion Studio is a standalone workspace for turning an ordered set of still images and one soundtrack into a moving MP4. It is a separate route in the GridSplit sidebar and does not change Script Studio, Audio Studio, Image Splitter, or the existing Production Studio.

## Current scope

- Import multiple still images and one narration/music file.
- Sort filenames naturally (for example, image-2 before image-10) and manually reorder the sequence.
- Read the soundtrack duration in the browser and distribute that full duration evenly across all image clips.
- Keep the final clip aligned to the exact soundtrack end by assigning any floating-point remainder to the last image.
- Preview the sequence against audio playback.
- Apply deterministic Ken Burns, zoom-in, zoom-out, pan-left, pan-right, or static camera motion.
- Apply dissolve, fade, wipe-left, wipe-right, or hard-cut transitions.
- Adjust transition duration, motion intensity, output aspect ratio, resolution, frame rate, soundtrack volume, and audio fades.
- Render H.264/AAC MP4 through the existing local FFmpeg sidecar and validate the output with ffprobe.
- Cancel a render and clean up temporary project media.

## Local setup

Install Python 3.10+ and FFmpeg with `ffprobe` and `libx264` available on the local machine. Then start the local renderer from the repository root.

For local development:

```bash
python local-render/server.py --allow-origin http://localhost:5173
```

For the deployed GridSplit frontend, allow its exact origin:

```bash
python local-render/server.py --allow-origin https://gridsplit-studio.vercel.app
```

Keep the sidecar running while rendering. In Motion Studio, leave the endpoint at `http://127.0.0.1:8766` and select **Check connection**. The renderer remains bound to loopback; it is not a public render server. See [local-render/README.md](../local-render/README.md) for the full security, setup, and codec notes.

## Processing and privacy

No paid API key, hosted inference provider, or local AI model is used. The browser handles imports and preview; the selected media is packaged locally and sent to the loopback FFmpeg process on the same computer. Temporary image and soundtrack blobs are removed when the render finishes or fails. Source files in the page are not modified.

The current FFmpeg pipeline uses the repository's existing `libx264` software encoder. It does not currently connect to Google Colab or automatically request a T4 GPU. Colab acceleration can be considered as a separate, opt-in export/import workflow; free T4 availability is not guaranteed and a Colab runtime should never be treated as a persistent render server.

## Important distinction

This first version creates **procedural camera animation**, not AI-generated motion inside the depicted subject. It moves and scales the complete still image and transitions between images. It does not animate a person's limbs, facial expressions, hair, smoke, water, or other objects independently.

Effekseer is a useful upstream reference for a later transparent particle/effect layer. Synfig is a useful reference for a separate 2D keyframe and layer-animation workspace. Neither desktop editor is embedded in this page. Particle overlays, layered parallax, masks, manual keyframes, and per-image effect overrides are future extensions and should be implemented as isolated effect layers rather than changing the existing Production Studio.