const API = ''
const DEFAULT_TOKEN = 'torview-dev'
function getToken() { return localStorage.getItem('torview-token') || DEFAULT_TOKEN }

const els = {
  landing: document.getElementById('landing'),
  landingForm: document.getElementById('landingForm'),
  landingInput: document.getElementById('landingInput'),
  landingPlus: document.getElementById('landingPlus'),
  landingFile: null,
  results: document.getElementById('results'),
  homeBtn: document.getElementById('homeBtn'),
  searchForm: document.getElementById('searchForm'),
  searchInput: document.getElementById('searchInput'),
  plusBtn: document.getElementById('plusBtn'),
  pluginList: document.getElementById('pluginList'),
  toggleAllPlugins: document.getElementById('toggleAllPlugins'),
  tableHead: document.getElementById('tableHead'),
  tableBody: document.getElementById('tableBody'),
  resultsCount: document.getElementById('resultsCount'),
  emptyState: document.getElementById('emptyState'),
  modal: document.getElementById('modal'),
  modalTitle: document.getElementById('modalTitle'),
  modalClose: document.getElementById('modalClose'),
  modalVideo: document.getElementById('modalVideo'),
  modalProgress: document.getElementById('modalProgress'),
  modalStatus: document.getElementById('modalStatus'),
  fileInput: document.getElementById('fileInput'),
}

let current = null // { id, info }
let pollTimer = null
let allPlugins = []
let enabled = new Set()
let results = []
let sortState = { key: 'seeds', dir: 'desc' }

function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?'
  const u = ['B','KB','MB','GB','TB']; let i=0
  while (n>=1024 && i<u.length-1){n/=1024;i++}
  return `${n.toFixed(1)} ${u[i]}`
}
function fmtTime(s){ if(!Number.isFinite(s)) return '?'; const m=Math.floor(s/60); const sec=Math.floor(s%60); return `${m}:${String(sec).padStart(2,'0')}` }
function escapeHtml(s){ return String(s).replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c])) }
function parseSize(s) {
  if (typeof s === 'number') return s
  if (!s) return NaN
  const m = String(s).match(/([\d.]+)\s*(KB|MB|GB|TB|B)?/i)
  if (!m) return NaN
  const v = parseFloat(m[1]); const u = (m[2]||'B').toUpperCase()
  const mul = {B:1,KB:1024,MB:1024**2,GB:1024**3,TB:1024**4}[u] || 1
  return v*mul
}
function isMagnet(q){ return /magnet:\?/i.test(q) || /^magnet:/i.test(q.trim()) }

async function api(path, opts) {
  opts = opts || {}
  opts.headers = Object.assign({ 'X-Torview-Token': getToken() }, opts.headers || {})
  const r = await fetch(API + path, opts)
  if (!r.ok) { const j = await r.json().catch(()=>({error:r.statusText})); throw new Error(j.error || r.statusText) }
  return r.json()
}

// ---- views ----
function showLanding() {
  els.landing.classList.remove('hidden')
  els.results.classList.add('hidden')
}
function showResults() {
  els.landing.classList.add('hidden')
  els.results.classList.remove('hidden')
}

// ---- plugins ----
function loadPluginState() {
  try { const v = JSON.parse(localStorage.getItem('torview-plugins') || 'null'); if (Array.isArray(v)) enabled = new Set(v) } catch {}
}
function savePluginState() { localStorage.setItem('torview-plugins', JSON.stringify([...enabled])) }
async function loadPlugins() {
  loadPluginState()
  try {
    const p = await api('/api/search/providers')
    allPlugins = p.map(x => x.name)
    if (enabled.size === 0) enabled = new Set(allPlugins)
    else enabled = new Set(allPlugins.filter(n => enabled.has(n))) // drop removed
    if (enabled.size === 0) enabled = new Set(allPlugins)
    renderPlugins()
  } catch (e) { els.pluginList.textContent = 'Backend not reachable' }
}
function renderPlugins() {
  els.pluginList.innerHTML = ''
  for (const name of allPlugins) {
    const btn = document.createElement('button')
    const on = enabled.has(name)
    btn.className = `px-3 py-1.5 rounded-full text-xs border transition ${on ? 'bg-accent/15 border-accent text-accent' : 'bg-surface border-border text-muted'}`
    btn.textContent = name.replace(/\.py$/, '')
    btn.onclick = () => {
      if (enabled.has(name)) enabled.delete(name); else enabled.add(name)
      savePluginState(); renderPlugins()
    }
    els.pluginList.appendChild(btn)
  }
}
els.toggleAllPlugins.addEventListener('click', () => {
  if (enabled.size === allPlugins.length) enabled = new Set()
  else enabled = new Set(allPlugins)
  savePluginState(); renderPlugins()
})

// ---- search ----
async function doSearch(q) {
  q = (q || '').trim()
  if (!q) return
  if (isMagnet(q)) { await addAndPreviewMagnet(q); return }
  showResults()
  els.searchInput.value = q
  els.tableBody.innerHTML = '<tr><td colspan="6" class="p-6 text-center text-muted">Searching…</td></tr>'
  els.emptyState.classList.add('hidden')
  try {
    const pluginsParam = [...enabled].join(',')
    const data = await api('/api/search?q=' + encodeURIComponent(q) + (pluginsParam ? '&plugins=' + encodeURIComponent(pluginsParam) : ''))
    results = data.results || []
    renderTable()
  } catch (e) {
    els.tableBody.innerHTML = ''
    els.emptyState.textContent = 'Error: ' + e.message
    els.emptyState.classList.remove('hidden')
  }
}

function renderTable() {
  els.resultsCount.textContent = `${results.length} result${results.length===1?'':'s'}`
  if (!results.length) {
    els.tableBody.innerHTML = ''
    els.emptyState.classList.remove('hidden')
    return
  }
  els.emptyState.classList.add('hidden')
  const sorted = [...results].sort((a,b) => {
    const va = sortValue(a, sortState.key), vb = sortValue(b, sortState.key)
    if (va < vb) return sortState.dir === 'asc' ? -1 : 1
    if (va > vb) return sortState.dir === 'asc' ? 1 : -1
    return 0
  })
  els.tableBody.innerHTML = ''
  for (const r of sorted) {
    const tr = document.createElement('tr')
    tr.className = 'hover:bg-surface-2/40 transition'
    tr.innerHTML = `
      <td class="px-4 py-3 max-w-md"><div class="truncate" title="${escapeHtml(r.title||'')}">${escapeHtml(r.title||'')}</div><div class="text-xs text-muted mt-0.5">${escapeHtml(r.provider||'')}</div></td>
      <td class="px-4 py-3 whitespace-nowrap text-muted">${fmtBytes(parseSize(r.size))}</td>
      <td class="px-4 py-3 whitespace-nowrap">${r.seeds ?? 0}</td>
      <td class="px-4 py-3 whitespace-nowrap text-muted">${r.peers ?? 0}</td>
      <td class="px-4 py-3 whitespace-nowrap text-xs text-muted">${escapeHtml(r.provider||'')}</td>
      <td class="px-4 py-3 whitespace-nowrap text-right">
        <button class="previewBtn px-3 py-1.5 rounded-lg bg-accent text-bg text-xs font-semibold hover:brightness-110 transition" data-magnet="${escapeHtml(r.magnet||r.link||'')}">Preview</button>
      </td>
    `
    els.tableBody.appendChild(tr)
  }
  els.tableBody.querySelectorAll('.previewBtn').forEach(btn => {
    btn.addEventListener('click', () => previewMagnet(btn.dataset.magnet))
  })
}

function sortValue(r, key) {
  if (key === 'name') return (r.title||'').toLowerCase()
  if (key === 'size') return parseSize(r.size) || 0
  if (key === 'seeds') return Number(r.seeds)||0
  if (key === 'peers') return Number(r.peers)||0
  if (key === 'provider') return (r.provider||'').toLowerCase()
  return 0
}

function renderTableHead() {
  const cols = [
    { key: 'name', label: 'Name' },
    { key: 'size', label: 'Size' },
    { key: 'seeds', label: 'Seeders' },
    { key: 'peers', label: 'Leechers' },
    { key: 'provider', label: 'Provider' },
    { key: null, label: 'Action' },
  ]
  els.tableHead.innerHTML = ''
  for (const c of cols) {
    const th = document.createElement('th')
    th.className = 'px-4 py-3 text-left text-xs font-semibold text-muted uppercase tracking-wide whitespace-nowrap select-none ' + (c.key ? 'cursor-pointer hover:text-text' : '')
    let label = c.label
    if (c.key && sortState.key === c.key) label += sortState.dir === 'asc' ? ' ↑' : ' ↓'
    th.textContent = label
    if (c.key) th.addEventListener('click', () => {
      if (sortState.key === c.key) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc'
      else { sortState.key = c.key; sortState.dir = 'desc' }
      renderTableHead(); renderTable()
    })
    els.tableHead.appendChild(th)
  }
}
renderTableHead()

// ---- torrent add / preview ----
async function addTorrentFromMagnet(magnet) {
  if (!magnet) throw new Error('No magnet link')
  const info = await api('/api/torrent/add', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ magnet }) })
  return info
}
async function addTorrentFromFile(file) {
  const fd = new FormData(); fd.append('torrent', file)
  const r = await fetch('/api/torrent/add', { method:'POST', body: fd, headers: { 'X-Torview-Token': getToken() } })
  const info = await r.json()
  if (!r.ok) throw new Error(info.error || r.statusText)
  return info
}
async function addAndPreviewMagnet(magnet) {
  showResults()
  try {
    const info = await addTorrentFromMagnet(magnet)
    openPreview(info)
  } catch (e) { alert('Error: ' + e.message) }
}
async function previewMagnet(magnet) {
  if (!magnet) { alert('No magnet link for this result'); return }
  try {
    const info = await addTorrentFromMagnet(magnet)
    openPreview(info)
  } catch (e) { alert('Error: ' + e.message) }
}

function streamUrl(id, fileIndex) { return `/api/torrent/${id}/file/${fileIndex}` }

function openPreview(info) {
  current = info
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  els.modalTitle.textContent = info.name || 'Preview'
  const largest = (info.files||[]).reduce((a,b)=> (b.length||0)>(a.length||0)?b:a, info.files && info.files[0])
  const idx = largest ? info.files.indexOf(largest) : 0
  els.modalVideo.src = streamUrl(info.id, idx)
  els.modalVideo.load()
  els.modal.classList.remove('hidden')
  els.modalStatus.textContent = 'Loading…'
  els.modalProgress.style.width = '0%'
  startPolling()
}
function closePreview() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  els.modal.classList.add('hidden')
  els.modalVideo.pause()
  els.modalVideo.removeAttribute('src'); els.modalVideo.load()
  current = null
}
els.modalClose.addEventListener('click', closePreview)
els.modal.addEventListener('click', e => { if (e.target === els.modal) closePreview() })

function startPolling() {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (!current) return
    try {
      const info = await api('/api/torrent/' + current.id)
      current = info
      const pct = Math.round((info.progress||0)*100)
      els.modalProgress.style.width = pct + '%'
      els.modalStatus.textContent = `name: ${info.name||'(loading metadata…)'}\nprogress: ${pct}%  peers: ${info.peers}\ndownloaded: ${fmtBytes(info.downloaded)} / ${fmtBytes(info.length)}`
    } catch {}
  }, 1500)
}

// ---- file input handling ----
els.fileInput.addEventListener('change', async () => {
  const f = els.fileInput.files[0]
  if (!f) return
  showResults()
  try {
    const info = await addTorrentFromFile(f)
    openPreview(info)
  } catch (e) { alert('Error: ' + e.message) }
  els.fileInput.value = ''
})

// ---- wiring ----
els.landingForm.addEventListener('submit', e => { e.preventDefault(); doSearch(els.landingInput.value) })
els.landingPlus.addEventListener('click', () => els.fileInput.click())
els.searchForm.addEventListener('submit', e => { e.preventDefault(); doSearch(els.searchInput.value) })
els.plusBtn.addEventListener('click', () => els.fileInput.click())
els.homeBtn.addEventListener('click', showLanding)

loadPlugins()
showLanding()
