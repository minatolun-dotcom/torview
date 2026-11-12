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
- Search torrents across all enabled plugins (The Pirate Bay, EZTV, YTS, Limetorrents, TorLock, Solidtorrents, TorrentProject, TorrentsCSV, …).
- Add by magnet/URL or `.torrent` file.
- Stream selected file with HTTP Range support (partial download).
- Generate 5 preview frames sampled across duration.
- Extract 5 short clips (~2s) at sample points.
- Scrubber: drag to seek, live thumbnail.

## Search plugins
Drop any qBittorrent-style Python plugin (`.py`) into `search-plugins/` and restart the backend.
They are executed via `python/run_plugin.py` with a `novaprinter`/`helpers` shim, so plugins from
https://github.com/qbittorrent/search-plugins/wiki/Unofficial-search-plugins work as-is.
A default `yts.py` (YTS JSON API) is included. Each plugin runs in its own process with a 12s timeout;
slow or unreachable plugins are reported in the `errors` array without blocking the rest.

## Notes
- Additional qBittorrent-style `.py` plugins can be dropped into `search-plugins/` and are
  picked up on backend restart.
- Only browser-playable codecs (MP4/WebM/…) are previewable.
EOF