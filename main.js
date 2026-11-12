const API = '' // same origin (Vite proxies /api to backend)
const DEFAULT_TOKEN = 'torview-dev'
function getToken() { return localStorage.getItem('torview-token') || DEFAULT_TOKEN }
function setToken(v) { localStorage.setItem('torview-token', v) }

const els = {
  searchInput: document.getElementById('searchInput'),
  searchBtn: document.getElementById('searchBtn'),
  searchResults: document.getElementById('searchResults'),
  providers: document.getElementById('providers'),
  torrentId: document.getElementById('torrentId'),
  addBtn: document.getElementById('addBtn'),
  fileBtn: document.getElementById('fileBtn'),
  fileInput: document.getElementById('fileInput'),
  status: document.getElementById('status'),
  progress: document.querySelector('#progress > div'),
  files: document.getElementById('files'),
  video: document.getElementById('video'),
  previewBtn: document.getElementById('previewBtn'),
  clipBtn: document.getElementById('clipBtn'),
  clearBtn: document.getElementById('clearBtn'),
  thumbs: document.getElementById('thumbs'),
  clips: document.getElementById('clips'),
  scrubber: document.getElementById('scrubber'),
  scrubThumb: document.getElementById('scrubThumb'),
  mode: document.getElementById('mode'),
  tokenInput: document.getElementById('tokenInput'),
  tokenBtn: document.getElementById('tokenBtn'),
}

let current = null // { id, info }
let pollTimer = null
let autoSampled = false

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?'
  const u = ['B','KB','MB','GB','TB']; let i=0
  while (n>=1024 && i<u.length-1){n/=1024;i++}
  return `${n.toFixed(1)} ${u[i]}`
}
function fmtTime(s){ if(!Number.isFinite(s)) return '?'; const m=Math.floor(s/60); const sec=Math.floor(s%60); return `${m}:${String(sec).padStart(2,'0')}` }
function setStatus(t){ els.status.textContent = t }

async function api(path, opts) {
  opts = opts || {}
  opts.headers = Object.assign({ 'X-Torview-Token': getToken() }, opts.headers || {})
  const r = await fetch(API + path, opts)
  if (!r.ok) { const j = await r.json().catch(()=>({error:r.statusText})); throw new Error(j.error || r.statusText) }
  return r.json()
}

// ---- Search ----
async function loadProviders() {
  try {
    const p = await api('/api/search/providers')
    els.providers.textContent = `Providers: ${p.map(x=>x.name).join(', ')}`
  } catch (e) { els.providers.textContent = 'Backend not reachable' }
}
els.searchBtn.addEventListener('click', doSearch)
els.searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch() })
async function doSearch() {
  const q = els.searchInput.value.trim()
  if (!q) return
  els.searchResults.innerHTML = 'Searching…'
  try {
    const data = await api('/api/search?q=' + encodeURIComponent(q))
    els.searchResults.innerHTML = ''
    if (!data.results.length) { els.searchResults.textContent = 'No results'; return }
    for (const r of data.results) {
      const div = document.createElement('div')
      div.className = 'result'
      div.innerHTML = `
        <div class="rtitle">${escapeHtml(r.title||'')}</div>
        <div class="rmeta">${escapeHtml(r.provider||'')} · ${fmtBytes(parseSize(r.size))} · seeds:${r.seeds||0} peers:${r.peers||0}</div>
      `
      const btn = document.createElement('button')
      btn.textContent = 'Add'
      btn.className = 'secondary'
      btn.onclick = () => addMagnet(r.magnet || r.link)
      div.appendChild(btn)
      els.searchResults.appendChild(div)
    }
  } catch (e) { els.searchResults.textContent = 'Error: ' + e.message }
}
function parseSize(s) {
  if (typeof s === 'number') return s
  if (!s) return NaN
  const m = String(s).match(/([\d.]+)\s*(KB|MB|GB|TB|B)?/i)
  if (!m) return NaN
  const v = parseFloat(m[1]); const u = (m[2]||'B').toUpperCase()
  const mul = {B:1,KB:1024,MB:1024**2,GB:1024**3,TB:1024**4}[u] || 1
  return v*mul
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }

// ---- Torrent add ----
async function addMagnet(magnet) {
  if (!magnet) { setStatus('No magnet link for this result'); return }
  setStatus('Adding torrent…')
  try {
    const info = await api('/api/torrent/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ magnet }) })
    onTorrentAdded(info)
  } catch (e) { setStatus('Error: ' + e.message) }
}
els.addBtn.addEventListener('click', () => addMagnet(els.torrentId.value.trim()))
els.fileBtn.addEventListener('click', () => els.fileInput.click())
els.fileInput.addEventListener('change', async () => {
  const f = els.fileInput.files[0]
  if (!f) return
  const fd = new FormData(); fd.append('torrent', f)
  setStatus('Uploading torrent…')
  try {
    const r = await fetch('/api/torrent/add', { method:'POST', body: fd, headers: { 'X-Torview-Token': getToken() } })
    const info = await r.json()
    if (!r.ok) throw new Error(info.error || r.statusText)
    onTorrentAdded(info)
  } catch (e) { setStatus('Error: ' + e.message) }
  els.fileInput.value = ''
})

function onTorrentAdded(info) {
  current = info
  autoSampled = false
  els.files.innerHTML = ''
  info.files.forEach((f, i) => {
    const opt = document.createElement('option')
    opt.value = i
    opt.textContent = `${f.name} (${fmtBytes(f.length)})`
    els.files.appendChild(opt)
  })
  const largest = info.files.reduce((a,b)=> b.length>a.length?b:a, info.files[0])
  if (largest) els.files.value = info.files.indexOf(largest)
  startPolling()
  playSelected()
  setStatus(`Added: ${info.name}\nFiles: ${info.files.length}`)
}

function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (!current) return
    try {
      const info = await api('/api/torrent/' + current.id)
      current = info
      const pct = Math.round((info.progress||0)*100)
      els.progress.style.width = pct + '%'
      setStatus(`name: ${info.name||'(loading metadata…)'}\nprogress: ${pct}%  peers: ${info.peers}\ndownloaded: ${fmtBytes(info.downloaded)} / ${fmtBytes(info.length)}`)
    } catch {}
  }, 1500)
}

function streamUrl() {
  if (!current) return null
  return `/api/torrent/${current.id}/file/${els.files.value}`
}
function playSelected() {
  const u = streamUrl()
  if (!u) return
  els.video.src = u
  els.video.load()
}

els.files.addEventListener('change', playSelected)

els.clearBtn.addEventListener('click', async () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  if (current) { try { await fetch('/api/torrent/'+current.id, {method:'DELETE', headers: { 'X-Torview-Token': getToken() } }) } catch {} }
  current = null
  autoSampled = false
  els.video.removeAttribute('src'); els.video.load()
  els.thumbs.innerHTML = ''; els.clips.innerHTML = ''
  els.progress.style.width = '0%'
  setStatus('Cleared.')
})

// ---- Frame capture helpers ----
function waitForSeeked(video, timeoutMs=6000) {
  return new Promise(resolve => {
    let done = false
    const onSeeked = () => { if (done) return; done=true; cleanup(); resolve(true) }
    const timer = setTimeout(() => { if (done) return; done=true; cleanup(); resolve(false) }, timeoutMs)
    function cleanup(){ clearTimeout(timer); video.removeEventListener('seeked', onSeeked) }
    video.addEventListener('seeked', onSeeked)
  })
}
async function seekTo(video, t) {
  if (Math.abs(video.currentTime - t) < 0.05) return true
  video.currentTime = t
  return waitForSeeked(video)
}

async function captureFrame(video, canvas) {
  const ctx = canvas.getContext('2d')
  const w = video.videoWidth || 640, h = video.videoHeight || 360
  canvas.width = w; canvas.height = h
  ctx.drawImage(video, 0, 0, w, h)
  return canvas.toDataURL('image/jpeg', 0.8)
}

// Auto-sample: 5 clips of ~2s from 5 parts of the file (no full stream needed)
async function sampleAll() {
  if (!current) { setStatus('Add a torrent first'); return }
  const v = els.video
  if (!Number.isFinite(v.duration) || v.duration <= 0) { setStatus('Video metadata not loaded yet'); return }
  const n = 5
  const dur = v.duration
  // stratified random sample points: one clip from each of 5 parts of the file
  const points = []
  for (let i = 0; i < n; i++) {
    const segStart = (dur / n) * i
    const segEnd = (dur / n) * (i + 1)
    const t = Math.min(segStart + Math.random() * (segEnd - segStart), Math.max(1, dur - 3))
    points.push(Math.max(1, t))
  }
  els.thumbs.innerHTML = ''
  els.clips.innerHTML = ''
  setStatus('Sampling 5 clips (~2s each) from 5 parts…')
  v.pause()
  for (const t of points) {
    await seekTo(v, t)
    await new Promise(r=>setTimeout(r, 200))
    const c = document.createElement('canvas')
    const furl = await captureFrame(v, c)
    const img = document.createElement('img')
    img.src = furl
    img.title = fmtTime(t)
    els.thumbs.appendChild(img)
    const blob = await captureClip(v, 2)
    const curl = URL.createObjectURL(blob)
    const vid = document.createElement('video')
    vid.src = curl
    vid.controls = true
    vid.muted = true
    vid.title = fmtTime(t)
    const wrap = document.createElement('div')
    wrap.className = 'clip'
    const label = document.createElement('div')
    label.textContent = fmtTime(t)
    wrap.appendChild(label)
    wrap.appendChild(vid)
    els.clips.appendChild(wrap)
  }
  setStatus(`Sampled ${n} clips`)
}
els.previewBtn.addEventListener('click', sampleAll)
els.clipBtn.addEventListener('click', sampleAll)

async function captureClip(video, seconds) {
  const canvas = document.createElement('canvas')
  const w = video.videoWidth || 640, h = video.videoHeight || 360
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  const stream = canvas.captureStream(15)
  // add audio? skip (muted). Video only.
  const rec = new MediaRecorder(stream, { mimeType: pickMime() })
  const chunks = []
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data) }
  const done = new Promise(resolve => { rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType })) })
  rec.start()
  video.play()
  const start = performance.now()
  const draw = () => {
    if (performance.now() - start < seconds*1000) {
      ctx.drawImage(video, 0, 0, w, h)
      requestAnimationFrame(draw)
    } else {
      video.pause()
      rec.stop()
    }
  }
  requestAnimationFrame(draw)
  return done
}
function pickMime() {
  const types = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm']
  for (const t of types) if (MediaRecorder.isTypeSupported(t)) return t
  return ''
}

// Scrubber
els.scrubber.addEventListener('input', async () => {
  const v = els.video
  if (!Number.isFinite(v.duration)) return
  const t = (els.scrubber.value/1000)*v.duration
  await seekTo(v, t)
  await new Promise(r=>setTimeout(r,80))
  const c = document.createElement('canvas')
  const url = await captureFrame(v, c)
  els.scrubThumb.src = url
  els.scrubThumb.title = fmtTime(t)
})
// populate scrubber range
els.video.addEventListener('loadedmetadata', () => {
  els.scrubber.max = 1000
  if (current && !autoSampled) {
    autoSampled = true
    setTimeout(() => { sampleAll().catch(e => setStatus('Sample error: ' + e.message)) }, 400)
  }
})

els.tokenInput.value = getToken()
els.tokenBtn.addEventListener('click', () => { setToken(els.tokenInput.value.trim() || DEFAULT_TOKEN); setStatus('Token saved.') })
loadProviders()
setStatus('Ready. Search or paste a magnet link.')
