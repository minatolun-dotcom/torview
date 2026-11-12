# Search plugins

Drop qBittorrent-style Python plugins (`.py`) here. They are executed by the backend
via `python/run_plugin.py` with a `novaprinter`/`helpers` shim, so plugins from
https://github.com/qbittorrent/search-plugins/wiki/Unofficial-search-plugins work as-is.

Each plugin must define `search(what, category='all')` and call
`novaprinter.prettyPrinter({...})` with at least `link` and `name`.

A default `yts.py` (YTS JSON API) is included.

Restart the backend after adding/removing plugins.
EOF