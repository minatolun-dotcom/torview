import fs from 'node:fs'
const p = 'node_modules/webtorrent/lib/torrent.js'
if (!fs.existsSync(p)) { console.log('webtorrent not installed; skip'); process.exit(0) }
let s = fs.readFileSync(p, 'utf8')
const old = '      this._debugId = arr2hex(parsedTorrent.infoHash).substring(0, 7)'
const nw = "      this._debugId = (typeof parsedTorrent.infoHash === 'string' ? parsedTorrent.infoHash : arr2hex(parsedTorrent.infoHash)).substring(0, 7)"
const old2 = '    this._debugId = arr2hex(parsedTorrent.infoHash).substring(0, 7)'
const nw2 = "    this._debugId = (typeof parsedTorrent.infoHash === 'string' ? parsedTorrent.infoHash : arr2hex(parsedTorrent.infoHash)).substring(0, 7)"
let changed = false
if (s.includes(old)) { s = s.replace(old, nw); changed = true }
if (s.includes(old2)) { s = s.replace(old2, nw2); changed = true }
if (changed) { fs.writeFileSync(p, s); console.log('patched webtorrent for parse-torrent 11.x') }
else { console.log('already patched or not needed') }
