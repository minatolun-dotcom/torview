import express from 'express'
import cors from 'cors'
import multer from 'multer'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import WebTorrent from 'webtorrent'
import { spawn } from 'node:child_process'
import TorrentSearchApi from 'torrent-search-api'

const PORT = process.env.PORT || 3001
const TOKEN = process.env.TORVIEW_TOKEN || 'torview-dev'
const TTL_MS = Number(process.env.TORRENT_TTL_MS || 60 * 60 * 1000) // 1h
const MAX_TOTAL_BYTES = Number(process.env.MAX_TOTAL_BYTES || 10 * 1024 ** 3) // 10GB
const MAX_TORRENT_BYTES = Number(process.env.MAX_TORRENT_BYTES || MAX_TOTAL_BYTES) // default: same as disk cap (10GB); 0 = unlimited

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
const PYTHON_SHIMS = path.join(process.cwd(), 'python')
const RUNNER = path.join(PYTHON_SHIMS, 'run_plugin.py')

function listPlugins() {
  try { return fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.py')).sort() } catch { return [] }
}

function runPythonPlugin(pluginFile, query, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const pluginPath = path.join(PLUGIN_DIR, pluginFile)
    const child = spawn('python3', [RUNNER, pluginPath, query, 'all'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill('SIGKILL') } catch {}
      resolve({ plugin: pluginFile, results: [], error: 'timeout' })
    }, timeoutMs)
    child.stdout.on('data', d => { stdout += d })
    child.stderr.on('data', d => { stderr += d })
    child.on('close', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      let results = []
      try { results = JSON.parse(stdout || '[]') } catch (e) { /* ignore */ }
      if (!Array.isArray(results)) results = []
      resolve({ plugin: pluginFile, results, error: stderr.trim() || null })
    })
    child.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ plugin: pluginFile, results: [], error: String(e.message) })
    })
  })
}

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
    const torrent = client.add(src, { path: path.join(os.tmpdir(), 'torview'), deselect: true })
    await waitForReady(torrent)
    if (MAX_TORRENT_BYTES > 0 && torrent.length > MAX_TORRENT_BYTES) {
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
  res.json(listPlugins().map(f => ({ name: f, public: true })))
})

app.get('/api/search', async (req,res)=>{
  const q=(req.query.q||'').toString().trim()
  if(!q) return res.status(400).json({error:'q required'})
  const limit=Math.min(parseInt(req.query.limit||'40',10)||40,100)
  // optional plugin filter: ?plugins=a.py,b.py
  let plugins = listPlugins()
  if (req.query.plugins) {
    const wanted = String(req.query.plugins).split(',').map(s=>s.trim()).filter(Boolean)
    if (wanted.length) plugins = plugins.filter(p => wanted.includes(p))
  }
  if (plugins.length === 0) {
    // fallback to built-in torrent-search-api
    try {
      TorrentSearchApi.enablePublicProviders()
      const results = await Promise.race([
        TorrentSearchApi.search(q, 'All', limit),
        new Promise((_,r)=>setTimeout(()=>r(new Error('search timeout')),12000)),
      ])
      const out=(results||[]).map(r=>({title:r.title,size:r.size,seeds:r.seeds,peers:r.peers,magnet:r.magnet||null,link:r.link||null,provider:r.provider||null}))
      return res.json({query:q, results:out.slice(0,limit)})
    } catch(e){ return res.status(500).json({error:String(e&&e.message||e)}) }
  }
  // run all plugins in parallel with per-plugin timeout
  const runs = await Promise.all(plugins.map(p => runPythonPlugin(p, q, 12000)))
  const aggregated = []
  const errors = []
  for (const r of runs) {
    if (r.error) errors.push({ plugin: r.plugin, error: r.error })
    for (const item of r.results) aggregated.push(item)
  }
  // de-dup by magnet/link
  const seen = new Set()
  const unique = []
  for (const r of aggregated) {
    const key = r.magnet || r.link || r.title
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(r)
  }
  res.json({ query: q, results: unique.slice(0, limit), errors })
})

app.get('/api/plugins', (req,res)=>{
  res.json({
    plugins: listPlugins(),
    pluginDir: PLUGIN_DIR,
    runner: RUNNER,
    note: 'Drop qBittorrent-style .py plugins into search-plugins/. They are executed with a novaprinter/helpers shim. See python/ for the shim.',
  })
})

app.get('/api/health', (req,res)=>res.json({ok:true, auth: TOKEN!=='torview-dev'}))

app.listen(PORT, ()=>console.log(`torview server on http://localhost:${PORT} (token: ${TOKEN})`))
