import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import WebTorrent from 'webtorrent'
import TorrentSearchApi from 'torrent-search-api'

const PORT = process.env.PORT || 3001
const TOKEN = process.env.TORVIEW_TOKEN || 'torview-dev'
const TTL_MS = Number(process.env.TORRENT_TTL_MS || 60 * 60 * 1000) // 1h
const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_BYTES || 5 * 1024 ** 3) // 5GB
const MAX_TORRENT_BYTES = Number(process.env.MAX_TORRENT_BYTES || 2 * 1024 ** 3) // 2GB

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

// ---- auth gate ----
function authToken(req) {
  const h = req.headers['authorization'] || ''
  if (h.toLowerCase().startsWith('bearer ')) return h.slice(7).trim()
  return req.headers['x-torview-token'] || req.query.token || ''
}
app.use((req, res, next) => {
  if (req.path === '/api/health') return next()
  if (authToken(req) !== TOKEN) return res.status(401).json({ error: 'unauthorized' })
  next()
})

const client = new WebTorrent()
const torrents = new Map()

const PLUGIN_DIR = path.join(process.cwd(), 'search-plugins')
if (!fs.existsSync(PLUGIN_DIR)) fs.mkdirSync(PLUGIN_DIR, { recursive: true })
try { TorrentSearchApi.enablePublicProviders() } catch (e) { console.warn(e.message) }
async function loadCustomProviders() {
  for (const f of fs.readdirSync(PLUGIN_DIR)) {
    if (!f.endsWith('.js')) continue
    try {
      const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, f)).href)
      const m = mod.default || mod
      if (m && m.name && typeof m.search === 'function') TorrentSearchApi.addProvider(m)
    } catch (e) { console.warn('plugin load failed', f, e.message) }
  }
}
await loadCustomProviders()

const MIME = { mp4:'video/mp4', webm:'video/webm', ogv:'video/ogg', mov:'video/quicktime', mkv:'video/x-matroska', avi:'video/x-msvideo', mp3:'audio/mpeg', m4a:'audio/mp4', srt:'text/plain', vtt:'text/vtt', txt:'text/plain' }
function mimeFor(name){ const ext=(name.split('.').pop()||'').toLowerCase(); return MIME[ext]||'application/octet-stream' }

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } })

function dirSize(p) {
  let total = 0
  try {
    for (const f of fs.readdirSync(p, { withFileTypes: true })) {
      const fp = path.join(p, f.name)
      if (f.isDirectory()) total += dirSize(fp)
      else { try { total += fs.statSync(fp).size } catch {} }
    }
  } catch {}
  return total
}

function torrentInfo(t){
  return { id:t.infoHash, name:t.name, length:t.length, downloaded:t.downloaded, progress:t.progress, peers:(t.numPeers||0),
    files: t.files.map((f,i)=>({index:i, name:f.name, path:f.path, length:f.length})) }
}

function waitForReady(torrent, timeoutMs=60000){
  return new Promise((resolve,reject)=>{
    if (torrent.ready) return resolve(torrent)
    const onReady=()=>{cleanup();resolve(torrent)}
    const onErr=(e)=>{cleanup();reject(e)}
    const timer=setTimeout(()=>{cleanup();reject(new Error('metadata timeout'))},timeoutMs)
    function cleanup(){clearTimeout(timer);torrent.removeListener('ready',onReady);torrent.removeListener('error',onErr)}
    torrent.on('ready',onReady); torrent.on('error',onErr)
  })
}

// ---- cleanup sweep ----
function sweep() {
  const now = Date.now()
  for (const [id, entry] of torrents) {
    if (id === 'pending') continue
    if (now - entry.addedAt > TTL_MS) {
      try { client.remove(entry.torrent, ()=>{}) } catch {}
      torrents.delete(id)
    }
  }
  // enforce disk cap by dropping oldest
  const root = path.join(os.tmpdir(), 'torview')
  if (fs.existsSync(root) && dirSize(root) > MAX_TOTAL_BYTES) {
    const sorted = [...torrents.entries()]
      .filter(([id])=>id!=='pending')
      .sort((a,b)=>a[1].addedAt-b[1].addedAt)
    for (const [id, entry] of sorted) {
      if (dirSize(root) <= MAX_TOTAL_BYTES * 0.8) break
      try { client.remove(entry.torrent, ()=>{}) } catch {}
      torrents.delete(id)
    }
  }
}
setInterval(sweep, 60 * 1000)

app.post('/api/torrent/add', upload.single('torrent'), async (req,res)=>{
  try{
    let src=null
    if (req.file) src=req.file.buffer
    else if (req.body && req.body.magnet) src=req.body.magnet
    else if (req.body && req.body.url) src=req.body.url
    if (!src) return res.status(400).json({error:'magnet, url, or torrent file required'})
    const torrent = client.add(src, { path: path.join(os.tmpdir(), 'torview') })
    await waitForReady(torrent)
    if (torrent.length > MAX_TORRENT_BYTES) {
      try { client.remove(torrent, ()=>{}) } catch {}
      return res.status(413).json({error:`torrent too large (>${MAX_TORRENT_BYTES} bytes)`})
    }
    torrents.set(torrent.infoHash, {torrent, addedAt: Date.now()})
    res.json(torrentInfo(torrent))
  } catch(e){ res.status(500).json({error: String(e&&e.message||e)}) }
})

app.get('/api/torrent/:id', (req,res)=>{
  const entry=torrents.get(req.params.id)
  if(!entry) return res.status(404).json({error:'not found'})
  const t=entry.torrent
  res.json({...torrentInfo(t), downloaded:t.downloaded, progress:t.progress, peers:t.numPeers})
})

app.delete('/api/torrent/:id', (req,res)=>{
  const entry=torrents.get(req.params.id)
  if(!entry) return res.status(404).json({error:'not found'})
  try { client.remove(entry.torrent, ()=>{}) } catch {}
  torrents.delete(req.params.id)
  res.json({ok:true})
})

app.get('/api/torrent/:id/file/:index', (req,res)=>{
  const entry=torrents.get(req.params.id)
  if(!entry) return res.status(404).end()
  const t=entry.torrent
  const idx=Number(req.params.index)
  if (!Number.isInteger(idx) || idx < 0 || idx >= t.files.length) return res.status(404).end()
  const file=t.files[idx]
  const size=file.length
  const mime=mimeFor(file.name)
  const range=req.headers.range
  const sendStream=(start,end)=>{
    res.status(range?206:200)
    if (range) res.set('Content-Range',`bytes ${start}-${end}/${size}`)
    res.set('Accept-Ranges','bytes')
    res.set('Content-Length', range ? end-start+1 : size)
    res.set('Content-Type',mime)
    const stream = file.createReadStream(range?{start,end}:{})
    stream.on('error', (e)=>{ try { res.destroy() } catch {} })
    req.on('close', ()=>{ try { stream.destroy() } catch {} })
    stream.pipe(res)
  }
  if (range){
    const m=/bytes=(\d+)-(\d*)/.exec(range)
    if(!m){ res.status(416).set('Content-Range',`bytes */${size}`).end(); return }
    const start=parseInt(m[1],10)
    const end=m[2]?parseInt(m[2],10):size-1
    if(!Number.isFinite(start)||!Number.isFinite(end)||start>=size||end>=size||start>end||start<0){
      res.status(416).set('Content-Range',`bytes */${size}`).end(); return
    }
    sendStream(start,end)
  } else {
    sendStream(0,size-1)
  }
})

app.get('/api/search/providers', (req,res)=>{
  res.json(TorrentSearchApi.getProviders().map(p=>({name:p.name, public:!!p.public})))
})

app.get('/api/search', async (req,res)=>{
  const q=(req.query.q||'').toString().trim()
  if(!q) return res.status(400).json({error:'q required'})
  const limit=Math.min(parseInt(req.query.limit||'40',10)||40,100)
  const cat=req.query.category||'All'
  try{
    const results=await Promise.race([
      TorrentSearchApi.search(q, cat, limit),
      new Promise((_,r)=>setTimeout(()=>r(new Error('search timeout')),25000)),
    ])
    const out=(results||[]).map(r=>({title:r.title,size:r.size,seeds:r.seeds,peers:r.peers,time:r.time,magnet:r.magnet||null,link:r.link||null,provider:r.provider||null}))
    const needMag=out.filter(r=>!r.magnet&&r.link).slice(0,15)
    await Promise.all(needMag.map(async r=>{ try { r.magnet=await TorrentSearchApi.getMagnet(r) } catch {} }))
    res.json({query:q, results:out})
  } catch(e){ res.status(500).json({error:String(e&&e.message||e)}) }
})

app.get('/api/plugins', (req,res)=>{
  res.json({builtin:TorrentSearchApi.getProviders().map(p=>p.name), customDir:PLUGIN_DIR,
    note:'Native qBittorrent .py plugins are not executed. Drop JS providers in search-plugins/ exporting {name,search}. Built-in providers cover the same major indexers.'})
})

app.get('/api/health', (req,res)=>res.json({ok:true, auth: TOKEN!=='torview-dev'}))

app.listen(PORT, ()=>console.log(`torview server on http://localhost:${PORT} (token: ${TOKEN})`))
