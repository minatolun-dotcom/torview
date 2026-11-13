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
  reopenBtn: document.getElementById('reopenBtn'),
  historyList: document.getElementById('historyList'),
  historyEmpty: document.getElementById('historyEmpty'),
  fileInput: document.getElementById('fileInput'),
}

let current = null // { id, info }
let pollTimer = null
let allPlugins = []
let disabled = new Set()
let results = []
let sortState = { key: 'seeds', dir: 'desc' }
const addedCache = new Map()
let history = []

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
// storage holds the *disabled* plugins so newly installed plugins are on by default
function loadPluginState() {
  try {
    const off = JSON.parse(localStorage.getItem('torview-plugins-off') || 'null')
    if (Array.isArray(off)) disabled = new Set(off)
  } catch {}
  // migrate old enabled-list format
  try {
    const legacy = JSON.parse(localStorage.getItem('torview-plugins') || 'null')
    if (Array.isArray(legacy) && legacy.length) disabled = new Set(allPluginsCache.filter(n => !legacy.includes(n)))
  } catch {}
}
function savePluginState() { localStorage.setItem('torview-plugins-off', JSON.stringify([...disabled])) }
let allPluginsCache = []
async function loadPlugins() {
  try {
    const p = await api('/api/search/providers')
    allPlugins = p.map(x => x.name)
    allPluginsCache = [...allPlugins]
    loadPluginState()
    renderPlugins()
  } catch (e) { els.pluginList.textContent = 'Backend not reachable' }
}
function pluginEnabled(name) { return !disabled.has(name) }
function renderPlugins() {
  els.pluginList.innerHTML = ''
  for (const name of allPlugins) {
    const btn = document.createElement('button')
    const on = pluginEnabled(name)
    btn.className = `px-3 py-1.5 rounded-full text-xs border transition ${on ? 'bg-accent/15 border-accent text-accent' : 'bg-surface border-border text-muted'}`
    btn.textContent = name.replace(/\.py$/, '')
    btn.onclick = () => {
      if (pluginEnabled(name)) disabled.add(name); else disabled.delete(name)
      savePluginState(); renderPlugins()
    }
    els.pluginList.appendChild(btn)
  }
}
els.toggleAllPlugins.addEventListener('click', () => {
  const allOn = allPlugins.every(pluginEnabled)
  disabled = allOn ? new Set(allPlugins) : new Set()
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
  const active = allPlugins.filter(pluginEnabled)
  if (!active.length) {
    els.tableBody.innerHTML = ''
    els.emptyState.textContent = 'No search plugins enabled. Turn some on below.'
    els.emptyState.classList.remove('hidden')
    return
  }
  try {
    const pluginsParam = active.join(',')
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
  if (addedCache.has(magnet)) { openPreview(addedCache.get(magnet)); return }
  // show player immediately while metadata loads
  current = null
  els.modalTitle.textContent = 'Loading…'
  els.modalVideo.removeAttribute('src'); els.modalVideo.load()
  els.modal.classList.remove('hidden')
  els.modalStatus.textContent = 'Adding torrent / fetching metadata…'
  els.modalProgress.style.width = '0%'
  try {
    const info = await addTorrentFromMagnet(magnet)
    info._magnet = magnet
    addedCache.set(magnet, info)
    openPreview(info)
  } catch (e) { els.modalStatus.textContent = 'Error: ' + e.message }
}
async function previewMagnet(magnet) {
  if (!magnet) { alert('No magnet link for this result'); return }
  if (addedCache.has(magnet)) { openPreview(addedCache.get(magnet)); return }
  current = null
  els.modalTitle.textContent = 'Loading…'
  els.modalVideo.removeAttribute('src'); els.modalVideo.load()
  els.modal.classList.remove('hidden')
  els.modalStatus.textContent = 'Adding torrent / fetching metadata…'
  els.modalProgress.style.width = '0%'
  try {
    const info = await addTorrentFromMagnet(magnet)
    info._magnet = magnet
    addedCache.set(magnet, info)
    openPreview(info)
  } catch (e) { els.modalStatus.textContent = 'Error: ' + e.message }
}

function streamUrl(id, fileIndex) { return `/api/torrent/${id}/preview/${fileIndex}` }
function fullFileUrl(id, fileIndex) { return `/api/torrent/${id}/file/${fileIndex}` }

function mainFileIndex(info) {
  const files = info.files || []
  if (!files.length) return 0
  const largest = files.reduce((a,b)=> (b.length||0)>(a.length||0)?b:a, files[0])
  return files.indexOf(largest)
}

function openPreview(info) {
  current = info
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  els.reopenBtn.classList.add('hidden')
  els.modalTitle.textContent = info.name || 'Preview'
  const idx = mainFileIndex(info)
  const url = streamUrl(info.id, idx)
  if (els.modalVideo.getAttribute('src') !== url) {
    els.modalStatus.textContent = 'Generating preview clip…'
    els.modalVideo.src = url
    els.modalVideo.load()
  }
  els.modal.classList.remove('hidden')
  if (!els.modalStatus.textContent.startsWith('Generating')) els.modalStatus.textContent = 'Loading…'
  els.modalProgress.style.width = '0%'
  startPolling()
  pushHistory(info)
}
// click outside → minimize (keep the torrent + playback position)
function minimizePreview() {
  if (els.modal.classList.contains('hidden')) return
  els.modal.classList.add('hidden')
  els.modalVideo.pause()
  if (current) {
    els.reopenBtn.textContent = '▶ ' + (current.name || 'Player')
    els.reopenBtn.classList.remove('hidden')
  }
}
// Close button → close entirely
function closePreview() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
  els.modal.classList.add('hidden')
  els.modalVideo.pause()
  els.modalVideo.removeAttribute('src'); els.modalVideo.load()
  els.reopenBtn.classList.add('hidden')
  if (current) {
    const id = current.id
    current = null
    for (const [m, cached] of addedCache) if (cached.id === id) addedCache.delete(m)
    api('/api/torrent/' + id, { method: 'DELETE' }).catch(()=>{})
  }
}
function reopenPreview() {
  if (!current) return
  els.reopenBtn.classList.add('hidden')
  els.modal.classList.remove('hidden')
  if (!els.modalVideo.getAttribute('src')) {
    els.modalVideo.src = streamUrl(current.id, mainFileIndex(current))
    els.modalVideo.load()
  }
  startPolling()
}
els.modalClose.addEventListener('click', closePreview)
els.modal.addEventListener('click', e => { if (e.target === els.modal) minimizePreview() })
els.modalVideo.addEventListener('error', () => {
  if (!current) return
  const idx = mainFileIndex(current)
  const full = fullFileUrl(current.id, idx)
  if (els.modalVideo.getAttribute('src') !== full) {
    els.modalStatus.textContent = 'Clip failed; streaming full file…'
    els.modalVideo.src = full
    els.modalVideo.load()
  }
})
els.reopenBtn.addEventListener('click', reopenPreview)

// ---- history ----
function magnetLabel(magnet) {
  const m = /[?&]dn=([^&]+)/.exec(magnet || '')
  return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : 'Torrent'
}
function loadHistory() {
  try { history = JSON.parse(localStorage.getItem('torview-history') || '[]') } catch { history = [] }
  renderHistory()
}
function saveHistory() {
  try { localStorage.setItem('torview-history', JSON.stringify(history.slice(0, 30))) } catch {}
}
function pushHistory(info) {
  const magnet = info._magnet
  if (!magnet) return
  history = history.filter(h => h.magnet !== magnet)
  history.unshift({ magnet, title: info.name || magnetLabel(magnet), at: Date.now() })
  saveHistory(); renderHistory()
}
function renderHistory() {
  if (!els.historyList) return
  els.historyList.innerHTML = ''
  els.historyEmpty.classList.toggle('hidden', history.length > 0)
  for (const h of history) {
    const row = document.createElement('div')
    row.className = 'flex items-start gap-2'
    const btn = document.createElement('button')
    btn.className = 'flex-1 text-left text-xs text-muted hover:text-accent transition truncate'
    btn.textContent = h.title
    btn.title = h.title
    btn.onclick = () => previewMagnet(h.magnet)
    const del = document.createElement('button')
    del.className = 'text-xs text-dim hover:text-accent transition'
    del.textContent = '✕'
    del.title = 'Remove from history'
    del.onclick = () => { history = history.filter(x => x !== h); saveHistory(); renderHistory() }
    row.append(btn, del)
    els.historyList.appendChild(row)
  }
}

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
loadHistory()
showLanding()
