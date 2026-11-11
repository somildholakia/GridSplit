# GridSplit Studio — Security and Privacy Review

**Review scope:** application code on feature head `0ba72cc6cf2b8fc3b00d446612f44ab0ec0f9491`  
**Validation:** GitHub Actions [run #199](https://github.com/somildholakia/GridSplit/actions/runs/42858412750)  
**Status:** app-side review recorded; external runtime/media supply chain remains a release gate

## Data flow and privacy boundary

- The frontend is a static Vite application. Scripts, project metadata, original storyboard images, generated WAVs and imported music/SFX are stored in browser-local localStorage and IndexedDB.
- The optional local TTS and FFmpeg services are separate sidecars intended for same-device loopback use.
- Audio Studio also accepts an explicitly entered HTTPS Cloudflare Quick Tunnel subdomain for a temporary user-started remote TTS runtime. This is opt-in and is not a GridSplit-hosted service; in this mode, selected narration/dialogue text leaves the browser and is sent to that runtime for synthesis.
- The TTS model and voice files are installed by the user and are not committed or downloaded by GridSplit.
- FFmpeg/ffprobe are installed by the user. The repository does not ship binaries or codecs.
- JSON backups preserve project metadata. Media-inclusive portable ZIP export/restore is the media portability path.

## Local TTS sidecar

- Uvicorn is documented to bind to `127.0.0.1`; the local sidecar remains loopback-only.
- The browser endpoint allowlist accepts loopback URLs by default and permits only HTTPS subdomains of `trycloudflare.com` as the explicit temporary GPU exception. Arbitrary internet hosts, LAN addresses and HTTP tunnels remain rejected.
- The sidecar validates the request Host against `localhost`, `127.0.0.1` and `::1`, including optional ports; unexpected or malformed values receive HTTP 403.
- Browser origins are explicitly allowlisted; wildcard CORS is not used.
- Synthesis requests have bounded text length and validated voice/language/speed fields.
- Model and voice files are user-installed; the sidecar does not automatically fall back to a remote provider.
- Two Python unit tests cover accepted loopback Host values and rejected remote/ambiguous forms.

**Temporary remote GPU exception:** Cloudflare Quick Tunnels are public, temporary URLs and the Colab API described by the setup workflow is unauthenticated. Anyone who obtains the active URL may be able to submit synthesis requests. Use only for an intentional short session, avoid sensitive script text, and stop the tunnel and Colab runtime after use. The browser allowlist is a compatibility boundary, not authentication.

**Local-sidecar limit:** Host/CORS checks are not authentication. A local malicious process with access to the user's loopback interface may still call the sidecar. Do not expose the local sidecar to a LAN or public network.

## Local FFmpeg renderer

- The server binds to IPv4 loopback and applies exact Origin/Host checks.
- Before extraction it checks compressed/uncompressed size, entry count, compression ratios, path traversal, symbolic links, required metadata, manifest references and SHA-256 checksums.
- FFmpeg is launched with an argument array (not through a shell). Output is checked with ffprobe for MP4/H.264/AAC, dimensions, frame rate and duration.
- Renderer work is limited to two active jobs. Finished job metadata is bounded to eight retained jobs/six hours; stale job directories are pruned on subsequent API requests.
- The renderer test suite covers archive validation and a real HTTP archive upload → render job → MP4 download flow.

**Limit:** Rendering invokes locally installed FFmpeg. Its available codecs, linked libraries, security updates and licenses depend on the user's exact build.

## Storage, restore and archive safety

- Browser metadata and media are kept in localStorage/IndexedDB, not uploaded to a GridSplit server.
- Portable project restoration validates archive paths, media sizes and SHA-256 checksums before saving media; failed restores remove blobs already written.
- The renderer revalidates its uploaded archive independently instead of trusting only browser-side checks.
- Archive size and entry count are bounded. The product retains manual correction/review rather than automatically deleting possible duplicate images.

## Dependency and license review

- CI runs `npm audit --omit=dev --audit-level=high`; run #199 reported **0 production npm vulnerabilities** at that threshold.
- The bundled PDF.js dependency and optional Kokoro information are listed in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).
- The optional Python TTS sidecar dependency graph is committed in `local-tts/uv.lock`, generated with pinned uv 0.13.5 for Python 3.10–3.13. CI validates it with `uv lock --check` and audits the synchronized environment with `pip-audit --strict`. `pip-audit==2.10.1` is development-only and excluded from normal runtime installs. The default-branch handoff workflow commits only the generated lockfile from successful same-repository PR CI runs; it does not modify workflow definitions.
- Kokoro model/voice, phonemizer/runtime packages, FFmpeg binaries and codecs are not bundled. Their exact version, provenance, vulnerability status and license must be reviewed before creating a redistributable installer or combined binary package.

## Open release checks

1. Generate speech with the exact user-installed Kokoro model/voice, play it in the target browser and download the WAV (M14–M16).
2. Validate image import, scene mapping persistence, timeline playback/seek and synchronization in a real target browser (M22–M25).
3. Audit exact Python dependency versions and the exact model/voice/FFmpeg assets on the release machine before redistribution.
4. Keep both local sidecars bound to loopback; do not expose them on public hosts.
5. Inspect a complete browser-exported package and restore it on the target device (M36).

This review documents implemented application controls and their limits. It is not a formal penetration test, a legal opinion, or a guarantee that user-installed software and model assets are safe.
