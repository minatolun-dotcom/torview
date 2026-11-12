# Torrent Preview

A web app that previews torrent video without a full download — seeks to sample
points and captures frames/clips, fetching only the needed pieces.

Two modes:
- **Universal (recommended)**: backend bridge (Node + WebTorrent over TCP/UDP) so
  any magnet works, plus torrent search.
- **Browser-only**: pure WebTorrent over WebRTC (only WebRTC-capable peers).

## Run (universal)

```bash
npm install
npm run dev:full
```

Open http://localhost:5173. Backend on http://localhost:3001.
Default access token: `torview-dev` (override with `TORVIEW_TOKEN` env var).

## Run (browser-only, no backend)

```bash
npm run dev
```
(Only torrents seeded by WebRTC-capable peers will have peers.)

## Features
- Search torrents across built-in providers (ThePirateBay, 1337x, YTS, EZTV, …).
- Add by magnet/URL or `.torrent` file.
- Stream selected file with HTTP Range support (partial download).
- Generate 5 preview frames sampled across duration.
- Extract 5 short clips (~2s) at sample points.
- Scrubber: drag to seek, live thumbnail.

## Custom search plugins
Drop a JS provider in `search-plugins/` (see `search-plugins/README.md`) and restart.

## Notes
- Native qBittorrent `.py` plugins are not executed; built-in JS providers cover the
  same major indexers. Custom JS providers can replicate any source.
- Only browser-playable codecs (MP4/WebM/…) are previewable.
EOF