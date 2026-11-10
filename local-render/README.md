# GridSplit Studio — optional local video renderer

The renderer is an optional Python standard-library sidecar that invokes FFmpeg and ffprobe installed on the user's own computer. It binds to **127.0.0.1 only**. GridSplit does not upload project files to a hosted renderer, download codec binaries, or require a paid API.

## Requirements

- Python 3.10 or newer
- FFmpeg with libx264 and AAC encoding enabled
- ffprobe available in the same PATH
- A running GridSplit Studio frontend

Install FFmpeg using the package manager for your operating system. GridSplit does not bundle it. Check the exact build and linked codec licenses before redistributing any FFmpeg binary.

## Start

From the repository root, allow the exact origin of the frontend tab. For the Vite development server:

    python local-render/server.py --allow-origin http://localhost:5173

For another local Vite address or an explicitly trusted static deployment, pass that exact origin with another --allow-origin argument. Do not add wildcard origins. Keep the sidecar running while rendering. It listens at http://127.0.0.1:8766.

## Use the deployed GridSplit website

You can use the public static frontend while rendering stays on your own computer. From the repository root, start the renderer with the exact production origin:

```bash
python local-render/server.py --allow-origin https://gridsplit-kappa.vercel.app
```

For local development, use `--allow-origin http://localhost:5173`. To use both the local development page and the public website, pass both flags:

```bash
python local-render/server.py --allow-origin http://localhost:5173 --allow-origin https://gridsplit-kappa.vercel.app
```

Keep the browser endpoint at `http://127.0.0.1:8766`. The production site does not proxy media to Vercel: the browser sends the archive directly to the loopback renderer on the same computer. Never bind the renderer to a LAN interface or configure a remote processing host.

## Security and privacy

- The server binds to IPv4 loopback only; it does not listen on LAN interfaces.
- Requests with an unexpected Host header or non-allowlisted browser Origin are rejected.
- The browser sends a complete .gridsplit.zip archive to the local process. The sidecar validates archive paths, entry counts, expanded size, and SHA-256 hashes before rendering.
- Jobs remain on the local machine. No telemetry or media upload is implemented.
- At most two render jobs run concurrently. Completed/failed/cancelled job metadata is bounded to the eight most recent jobs and a six-hour retention window; expired/overflow temporary directories are pruned when another API request arrives.
- Stop the sidecar with Ctrl+C. If the process is stopped before a later request triggers cleanup, remove any remaining `gridsplit-render-*` temporary folders manually.

## Render behavior

The renderer creates H.264 video (libx264) and AAC audio, applies the selected output dimensions/frame rate, uses timeline image order, fills image timeline gaps with black, applies supported per-image zoom/pan effects and xfade transitions, and mixes available narration/dialogue/music/SFX tracks with gain, mute/solo and fade settings. It then probes the MP4 and checks codecs, dimensions, and timeline duration before the browser downloads it.

A renderer job can be cancelled from the Studio UI. FFmpeg and ffprobe must support the selected media formats; unsupported input files produce a readable job error. The output is not claimed complete until ffprobe validation succeeds.

## Validate the sidecar

    python -m py_compile local-tts/server.py local-render/server.py
    python -m unittest discover -s local-tts -p 'test_*.py'
    python -m unittest discover -s local-render -p 'test_*.py'
