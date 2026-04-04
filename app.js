// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Set your GitHub username and repo name here
const GITHUB_USER = 'jt1919191919';
const GITHUB_REPO = 'dnd-tool';
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/data`;
const GITHUB_API = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data`;

function getPAT() { return localStorage.getItem('dnd_pat') || ''; }

async function githubSave(path, content, commitMsg) {
  const pat = getPAT();
  if (!pat) { alert('No GitHub token set. Open DM Settings to add it.'); return false; }
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2))));
  // Get current SHA (needed for updates)
  const existing = await fetch(`${GITHUB_API}/${path}`, {
    headers: { Authorization: `token ${pat}` }
  });
  const sha = existing.ok ? (await existing.json()).sha : undefined;
  const res = await fetch(`${GITHUB_API}/${path}`, {
    method: 'PUT',
    headers: { Authorization: `token ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: commitMsg, content: encoded, ...(sha && { sha }) })
  });
  if (!res.ok) { alert('Save failed. Check your token has repo write access.'); return false; }
  return true;
}

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentPlayer = null; // { token, name, canSee: [], isDM: false }
let config = null;        // full config.json
let pages = {};           // { pageId: pageData }
let currentPageId = null;

// ─── BOOT ─────────────────────────────────────────────────────────────────────
window.addEventListener('load', async () => {
  const token = getTokenFromURL();
  if (!token) { showAccessDenied(); return; }

  // Save token to localStorage so plain URL still works on same device
  localStorage.setItem('dnd_token', token);

  config = await fetchJSON('config.json');
  if (!config) { showAccessDenied(); return; }

  // Check token against players
  if (config.dmToken && token === config.dmToken) {
    currentPlayer = { token, name: 'DM', canSee: '__ALL__', isDM: true };
  } else if (token && config.players[token]) {
    currentPlayer = { token, ...config.players[token], isDM: false };
  } else {
    // Public visitor — sees only __ALL__ content
    currentPlayer = { token: '__PUBLIC__', name: '', canSee: [], isDM: false };
  }

  // Load all pages
  const pageIndex = await fetchJSON('pages/index.json');
  if (pageIndex) {
    for (const id of pageIndex) {
      const p = await fetchJSON(`pages/${id}.json`);
      if (p) pages[id] = p;
    }
  }

  initApp();
});

function getTokenFromURL() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) { localStorage.setItem('dnd_token', token); return token; }
  return localStorage.getItem('dnd_token') || '__PUBLIC__';
}

function applyToken() {
  const val = document.getElementById('token-input').value.trim();
  if (!val) return;
  localStorage.setItem('dnd_token', val);
  const newURL = buildURL(val, new URLSearchParams(window.location.search).get('page'));
  window.location.href = newURL;
}

function clearToken() {
  localStorage.removeItem('dnd_token');
  window.location.href = getBaseURL();
}

function updateTokenBar() {
  const tokenBar = document.getElementById('token-bar');
  if (currentPlayer.isDM) { tokenBar.style.display = 'none'; return; }
  if (currentPlayer.token && currentPlayer.token !== '__PUBLIC__') {
    tokenBar.style.display = 'none';
  }
}

function getBaseURL() {
  return `${window.location.origin}${window.location.pathname}`;
}

function buildURL(token, pageId, headingId) {
  let url = `${getBaseURL()}?token=${token}`;
  if (pageId) url += `&page=${pageId}`;
  if (headingId) url += `#${headingId}`;
  return url;
}

function showAccessDenied() {
  document.getElementById('access-denied').classList.remove('hidden');
}

function initApp() {
  initEditor();
  updateTokenBar();
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('player-name-display').textContent = currentPlayer.name;
  if (currentPlayer.isDM) {
    document.getElementById('dm-nav').classList.remove('hidden');
  }
  if (!currentPlayer.isDM && currentPlayer.token !== '__PUBLIC__') {
    document.getElementById('player-nav').classList.remove('hidden');
  }
  buildNav();
  // Check if URL specifies a page to load directly
  const params = new URLSearchParams(window.location.search);
  const pageId = params.get('page');
  if (pageId && pages[pageId] && canSee(pageId)) {
    navigateTo(pageId);
  } else {
    showView('home');
  }
}

// ─── NAV ──────────────────────────────────────────────────────────────────────
function buildNav() {
  const ul = document.getElementById('nav-links');
  ul.innerHTML = '<li><a href="#" onclick="showView(\'home\')">🏠 Home</a></li>';
  for (const [id, page] of Object.entries(pages)) {
    if (!canSee(id)) continue;
    const li = document.createElement('li');
    li.innerHTML = `<a href="#" onclick="navigateTo('${id}')">${page.title}</a>`;
    ul.appendChild(li);
  }
}

function toggleMenu() {
  document.getElementById('side-menu').classList.toggle('hidden');
}

// ─── VISIBILITY ───────────────────────────────────────────────────────────────
function canSee(pageId) {
  if (currentPlayer.isDM) return true;
  const page = pages[pageId];
  if (!page) return false;
  if (!page.visibleTo || page.visibleTo.length === 0) return false;
  if (page.visibleTo.includes('__ALL__')) return true;
  if (!currentPlayer.token || currentPlayer.token === '__PUBLIC__') return false;
  return page.visibleTo.includes(currentPlayer.token);
}

// ─── VIEWS ────────────────────────────────────────────────────────────────────
function showView(view) {
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-page').classList.add('hidden');
  document.getElementById('view-dm-editor').classList.add('hidden');
  document.getElementById('view-dm-config').classList.add('hidden');
  document.getElementById('side-menu').classList.add('hidden');
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('search-input').value = '';
  // Update URL back to just token when going home
  if (view === 'home') {
    window.history.pushState({}, '', buildURL(currentPlayer.token));
  }
  
  if (view === 'home') {
    document.getElementById('view-home').classList.remove('hidden');
    renderCards();
  } else if (view === 'dm-editor') {
    document.getElementById('view-dm-editor').classList.remove('hidden');
    resetEditor();
  } else if (view === 'dm-config') {
    document.getElementById('view-dm-config').classList.remove('hidden');
    renderConfig();
  }
}

function navigateTo(pageId) {
  if (!canSee(pageId)) return;
  currentPageId = pageId;
  const page = pages[pageId];
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-dm-editor').classList.add('hidden');
  document.getElementById('view-dm-config').classList.add('hidden');
  document.getElementById('side-menu').classList.add('hidden');
  document.getElementById('view-page').classList.remove('hidden');

  // Update URL to reflect current page without losing token
  const newURL = buildURL(currentPlayer.token, pageId);
  window.history.pushState({}, '', newURL);

  document.getElementById('page-content').innerHTML = page.content || '';
  buildOutline();

  if (currentPlayer.isDM) {
    document.getElementById('dm-page-controls').classList.remove('hidden');
    buildVisibilityCheckboxes(page);
  }
}

function buildOutline() {
  const content = document.getElementById('page-content');
  const headings = Array.from(content.querySelectorAll('h1,h2,h3,h4'));
  const outline = document.getElementById('page-outline');
  outline.innerHTML = '';

  if (currentPlayer.isDM) {
    // DM gets editable ToC builder
    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Entry';
    addBtn.style.cssText = 'font-size:0.75rem;padding:2px 8px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer;margin-bottom:8px';
    addBtn.onclick = () => addTocEntry();
    outline.appendChild(addBtn);
  }

  // Build from headings if no custom ToC saved
  const page = pages[currentPageId];
  const tocData = page.toc || buildTocFromHeadings(headings);

  renderToc(outline, tocData, 0);

  // Assign IDs to headings
  headings.forEach((h, i) => { h.id = `heading-${i}`; });

  document.getElementById('page-outline-wrap').style.display = headings.length || (page.toc?.length) ? '' : 'none';
}

function buildTocFromHeadings(headings) {
  return headings.map((h, i) => ({
    id: `heading-${i}`,
    text: h.textContent.replace('🔗','').trim(),
    level: parseInt(h.tagName[1]),
    children: []
  }));
}

function renderToc(container, items, depth) {
  const page = pages[currentPageId];
  const minLevel = Math.min(...items.map(i => i.level || 1));

  items.forEach((item, idx) => {
    const wrap = document.createElement('div');
    wrap.style.marginLeft = `${(( item.level || 1) - minLevel) * 12}px`;
    wrap.style.marginBottom = '3px';

    const hasChildren = item.children && item.children.length > 0;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;';

    // Collapse toggle
    if (hasChildren) {
      const toggle = document.createElement('span');
      toggle.textContent = '▶';
      toggle.style.cssText = 'cursor:pointer;font-size:0.65rem;color:#aaa;min-width:10px';
      const childWrap = document.createElement('div');
      childWrap.style.display = 'none';
      toggle.onclick = () => {
        const collapsed = childWrap.style.display === 'none';
        childWrap.style.display = collapsed ? '' : 'none';
        toggle.textContent = collapsed ? '▼' : '▶';
      };
      row.appendChild(toggle);
      wrap.appendChild(row);
      renderToc(childWrap, item.children, depth + 1);
      wrap.appendChild(childWrap);
    } else {
      const spacer = document.createElement('span');
      spacer.style.minWidth = '10px';
      row.appendChild(spacer);
    }

    // Share btn
    if (currentPlayer.isDM) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'share-btn';
      shareBtn.textContent = '🔗';
      shareBtn.title = 'Share';
      shareBtn.onclick = () => openSharePanel(currentPageId, item.id);
      row.appendChild(shareBtn);
    }

    // Link
    const a = document.createElement('a');
    a.href = `#${item.id}`;
    a.textContent = item.text;
    a.style.cssText = 'color:#e2b96f;text-decoration:none;font-size:0.85rem;';
    a.onclick = (e) => { e.preventDefault(); scrollToHeading(item.id); };
    row.appendChild(a);

    // DM edit controls
    if (currentPlayer.isDM) {
      const editBtn = document.createElement('button');
      editBtn.textContent = '✏️';
      editBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:0.65rem;opacity:0.4;padding:0 2px';
      editBtn.onclick = () => editTocEntry(item, idx, page.toc || buildTocFromHeadings([]));
      row.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.textContent = '✕';
      delBtn.style.cssText = 'background:none;border:none;cursor:pointer;font-size:0.65rem;opacity:0.4;color:#c44;padding:0 2px';
      delBtn.onclick = () => deleteTocEntry(item.id);
      row.appendChild(delBtn);
    }

    if (!hasChildren) wrap.appendChild(row);
    else wrap.insertBefore(row, wrap.children[1] || null);

    container.appendChild(wrap);
  });
}

function addTocEntry() {
  const text = prompt('Entry text:');
  if (!text) return;
  const id = prompt('Anchor ID (must match a heading id like heading-0, or any custom id):');
  if (!id) return;
  const level = parseInt(prompt('Heading level (1-4):') || '2');
  const page = pages[currentPageId];
  if (!page.toc) page.toc = buildTocFromHeadings(Array.from(document.querySelectorAll('#page-content h1,#page-content h2,#page-content h3,#page-content h4')));
  page.toc.push({ id, text, level, children: [] });
  buildOutline();
  saveToc();
}

function editTocEntry(item, idx, toc) {
  const text = prompt('Entry text:', item.text);
  if (text === null) return;
  const id = prompt('Anchor ID:', item.id);
  if (id === null) return;
  item.text = text;
  item.id = id;
  pages[currentPageId].toc = toc;
  buildOutline();
  saveToc();
}

function deleteTocEntry(id) {
  const page = pages[currentPageId];
  if (!page.toc) return;
  page.toc = page.toc.filter(i => i.id !== id);
  buildOutline();
  saveToc();
}

async function saveToc() {
  await githubSave(`pages/${currentPageId}.json`, pages[currentPageId], `Update ToC: ${currentPageId}`);
}

function scrollToHeading(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  // Update URL with heading anchor, preserving token and page
  const newURL = buildURL(currentPlayer.token, currentPageId, id);
  window.history.pushState({}, '', newURL);
}

// ─── CARDS ────────────────────────────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById('cards-grid');
  grid.innerHTML = '';
  for (const [id, page] of Object.entries(pages)) {
    if (!canSee(id)) continue;
    const card = document.createElement('div');
    card.className = 'card';
    const imgHtml = page.thumbnail
      ? `<img src="${page.thumbnail}" alt="${page.title}" loading="lazy"/>`
      : `<div class="card-no-img">📜</div>`;
    card.innerHTML = `
      ${imgHtml}
      <div class="card-body">
        <div class="card-title-row">
          <span class="card-title">${page.title}</span>
          ${currentPlayer.isDM ? `<button class="share-btn" onclick="event.stopPropagation();openSharePanel('${id}',null)" title="Share">🔗</button>` : ''}
        </div>
        <div class="card-desc">${page.description || ''}</div>
      </div>`;
    card.onclick = () => navigateTo(id);
    grid.appendChild(card);
  }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function handleSearch(query) {
  const resultsWrap = document.getElementById('search-results');
  const resultsList = document.getElementById('search-results-list');
  const cards = document.getElementById('cards-grid');

  if (!query.trim()) {
    resultsWrap.classList.add('hidden');
    cards.classList.remove('hidden');
    return;
  }

  cards.classList.add('hidden');
  resultsWrap.classList.remove('hidden');
  resultsList.innerHTML = '';

  const q = query.toLowerCase();
  let found = false;

  for (const [id, page] of Object.entries(pages)) {
    if (!canSee(id)) continue;
    const titleMatch = page.title?.toLowerCase().includes(q);
    const contentText = stripHTML(page.content || '');
    const contentMatch = contentText.toLowerCase().includes(q);
    const descMatch = page.description?.toLowerCase().includes(q);

    if (titleMatch || contentMatch || descMatch) {
      found = true;
      const snippet = getSnippet(contentText, q);
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.onclick = () => { document.getElementById('search-input').value = ''; handleSearch(''); navigateTo(id); };
      item.innerHTML = `<div class="search-result-title">${page.title}</div><div class="search-result-snippet">${snippet}</div>`;
      resultsList.appendChild(item);
    }
  }

  if (!found) resultsList.innerHTML = '<p style="color:#aaa;padding:10px">No results found.</p>';
}

function stripHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function getSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text.slice(0, 100) + '...';
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 60);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

// ─── DM EDITOR ────────────────────────────────────────────────────────────────
function initEditor() {
  const area = document.getElementById('editor-area');

  area.addEventListener('paste', (e) => {
    const strip = document.getElementById('strip-links-toggle').checked;
    if (!strip) return; // normal paste
    e.preventDefault();
    const html = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
    const div = document.createElement('div');
    div.innerHTML = html;
    // Remove all <a> tags but keep their text content
    div.querySelectorAll('a').forEach(a => {
      const text = document.createTextNode(a.textContent);
      a.replaceWith(text);
    });
    document.execCommand('insertHTML', false, div.innerHTML);
  });

  // Heading level changer
  document.getElementById('heading-level-select').addEventListener('change', function() {
    const newTag = this.value;
    if (!newTag) return;
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    let node = sel.anchorNode;
    while (node && node !== area) {
      if (node.nodeType === 1 && /^H[1-4]$/i.test(node.tagName)) {
        const newEl = document.createElement(newTag === 'P' ? 'p' : newTag);
        newEl.innerHTML = node.innerHTML;
        node.replaceWith(newEl);
        break;
      }
      node = node.parentNode;
    }
    this.value = '';
  });
}

function resetEditor() {
  document.getElementById('editor-title-label').textContent = 'New Page';
  document.getElementById('editor-page-id').value = '';
  document.getElementById('editor-page-title').value = '';
  document.getElementById('editor-thumb').value = '';
  document.getElementById('editor-description').value = '';
  document.getElementById('editor-area').innerHTML = '';
  document.getElementById('editor-page-id').disabled = false;
}

function editCurrentPage() {
  if (!currentPageId) return;
  const page = pages[currentPageId];
  document.getElementById('view-page').classList.add('hidden');
  document.getElementById('view-dm-editor').classList.remove('hidden');
  document.getElementById('editor-title-label').textContent = 'Edit Page';
  document.getElementById('editor-page-id').value = currentPageId;
  document.getElementById('editor-page-id').disabled = true;
  document.getElementById('editor-page-title').value = page.title || '';
  document.getElementById('editor-thumb').value = page.thumbnail || '';
  document.getElementById('editor-description').value = page.description || '';
  document.getElementById('editor-area').innerHTML = page.content || '';
}

async function savePage() {
  const id = document.getElementById('editor-page-id').value.trim();
  const title = document.getElementById('editor-page-title').value.trim();
  if (!id || !title) { alert('Page ID and Title required.'); return; }
  const isNew = !pages[id];
  const pageData = {
    id, title,
    thumbnail: document.getElementById('editor-thumb').value.trim(),
    description: document.getElementById('editor-description').value.trim(),
    content: document.getElementById('editor-area').innerHTML,
    visibleTo: pages[id]?.visibleTo || []
  };
  pages[id] = pageData;
  const ok = await githubSave(`pages/${id}.json`, pageData, `Update page: ${id}`);
  if (!ok) return;
  if (isNew) {
    const idx = await fetchJSON('pages/index.json') || [];
    if (!idx.includes(id)) idx.push(id);
    await githubSave('pages/index.json', idx, `Add page to index: ${id}`);
  }
  buildNav();
  showView('home');
  alert('Saved to GitHub!');
}

async function deleteCurrentPage() {
  if (!currentPageId) return;
  if (!confirm(`Delete "${pages[currentPageId]?.title}"?`)) return;
  const pat = getPAT();
  const existing = await fetch(`${GITHUB_API}/pages/${currentPageId}.json`, {
    headers: { Authorization: `token ${pat}` }
  });
  if (existing.ok) {
    const { sha } = await existing.json();
    await fetch(`${GITHUB_API}/pages/${currentPageId}.json`, {
      method: 'DELETE',
      headers: { Authorization: `token ${pat}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `Delete page: ${currentPageId}`, sha })
    });
  }
  delete pages[currentPageId];
  const idx = Object.keys(pages);
  await githubSave('pages/index.json', idx, 'Update index after delete');
  currentPageId = null;
  buildNav();
  showView('home');
}

// ─── VISIBILITY ───────────────────────────────────────────────────────────────
function buildVisibilityCheckboxes(page) {
  const wrap = document.getElementById('visibility-checkboxes');
  wrap.innerHTML = '';
  if (!config?.players) return;

  // ALL option
  const allLabel = document.createElement('label');
  const allCb = document.createElement('input');
  allCb.type = 'checkbox';
  allCb.value = '__ALL__';
  allCb.checked = page.visibleTo?.includes('__ALL__');
  allLabel.appendChild(allCb);
  allLabel.append(' ALL');
  wrap.appendChild(allLabel);

  for (const [token, player] of Object.entries(config.players)) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = token;
    cb.checked = page.visibleTo?.includes(token) || page.visibleTo?.includes('__ALL__');
    label.appendChild(cb);
    label.append(` ${player.name}`);
    wrap.appendChild(label);
  }
}

async function saveVisibility() {
  if (!currentPageId) return;
  const checkboxes = document.querySelectorAll('#visibility-checkboxes input[type=checkbox]');
  pages[currentPageId].visibleTo = Array.from(checkboxes).filter(c=>c.checked).map(c=>c.value);
  const ok = await githubSave(`pages/${currentPageId}.json`, pages[currentPageId], `Update visibility: ${currentPageId}`);
  if (ok) alert('Visibility saved!');
}

// ─── CONFIG VIEW ──────────────────────────────────────────────────────────────
function renderConfig() {
  document.getElementById('pat-input').value = getPAT();
  const list = document.getElementById('config-player-list');
  list.innerHTML = '';
  for (const [token, player] of Object.entries(config.players)) {
    const div = document.createElement('div');
    div.className = 'config-player-row';
    div.innerHTML = `<strong>${player.name}</strong> — token: <code>${token}</code>
      <button onclick="previewAsPlayer('${token}','${player.name}')" style="margin-left:8px;padding:2px 8px;border:1px solid #7eb8f7;background:transparent;color:#7eb8f7;border-radius:4px;cursor:pointer">Preview</button>
      <button onclick="removePlayer('${token}')" style="margin-left:4px;padding:2px 8px;border:1px solid #c44;background:transparent;color:#c44;border-radius:4px;cursor:pointer">Remove</button>`;
    list.appendChild(div);
  }
}

async function removePlayer(token) {
  if (!confirm(`Remove player "${config.players[token]?.name}"?`)) return;
  delete config.players[token];
  const ok = await githubSave('config.json', config, `Remove player: ${token}`);
  if (ok) { renderConfig(); alert('Player removed!'); }
}

async function saveConfig() {
  const ok = await githubSave('config.json', config, 'Update config');
  if (ok) alert('Config saved to GitHub!');
}

function savePAT() {
  const val = document.getElementById('pat-input').value.trim();
  if (!val) return;
  localStorage.setItem('dnd_pat', val);
  alert('Token saved to browser!');
}

async function addPlayer() {
  const token = document.getElementById('new-player-token').value.trim();
  const name = document.getElementById('new-player-name').value.trim();
  if (!token || !name) { alert('Token and name required.'); return; }
  config.players[token] = { name };
  const ok = await githubSave('config.json', config, `Add player: ${name}`);
  if (ok) { renderConfig(); alert(`${name} added!`); }
}

function previewAsPlayer(token, name) {
  if (!confirm(`Preview site as ${name}? Opens in new tab.`)) return;
  window.open(buildURL(token), '_blank');
}

function clearDeviceMemory() {
  if (!confirm('Clear your player token from this device?')) return;
  const pat = localStorage.getItem('dnd_pat');
  localStorage.clear();
  if (pat) localStorage.setItem('dnd_pat', pat);
  window.location.href = getBaseURL();
}

// ─── FETCH HELPERS ────────────────────────────────────────────────────────────
async function fetchJSON(path) {
  const pat = getPAT();
  const headers = pat ? { Authorization: `token ${pat}` } : {};
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/${path}?_=${Date.now()}`, { headers });
    if (!res.ok) return null;
    const json = await res.json();
    // GitHub API returns content as base64
    const decoded = decodeURIComponent(escape(atob(json.content)));
    return JSON.parse(decoded);
  } catch { return null; }
}

// ─── Backups ────────────────────────────────────────────────────────────
async function downloadBackup() {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip();

  zip.file('index.html', await fetchRaw('index.html'));
  zip.file('app.js', await fetchRaw('app.js'));
  zip.file('style.css', await fetchRaw('style.css'));
  zip.file('data/config.json', JSON.stringify(config, null, 2));
  zip.file('data/pages/index.json', JSON.stringify(Object.keys(pages), null, 2));
  for (const [id, page] of Object.entries(pages)) {
    zip.file(`data/pages/${id}.json`, JSON.stringify(page, null, 2));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `dnd-wiki-backup-${new Date().toISOString().slice(0,10)}.zip`;
  a.click();
}

async function fetchRaw(filename) {
  const pat = getPAT();
  const headers = pat ? { Authorization: `token ${pat}` } : {};
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${filename}?_=${Date.now()}`, { headers });
    if (!res.ok) return '';
    const json = await res.json();
    return decodeURIComponent(escape(atob(json.content)));
  } catch { return ''; }
}

// ─── Sharelinks ────────────────────────────────────────────────────────────
function openSharePanel(pageId, headingId) {
  // Close any existing panel first
  document.querySelectorAll('.share-panel-popup').forEach(p => p.remove());

  const panel = document.createElement('div');
  panel.className = 'share-panel-popup';
  panel.innerHTML = `<div style="font-size:0.8rem;color:#aaa;margin-bottom:6px">Share link for:</div>`;

  // Public/all option
  const allDiv = document.createElement('div');
  allDiv.className = 'share-player-row';
  allDiv.textContent = '🌐 All Players (no token)';
  allDiv.onclick = () => { copyShareLink(null, null, pageId, headingId); panel.remove(); };
  panel.appendChild(allDiv);

  for (const [token, player] of Object.entries(config.players)) {
    const canView = pages[pageId]?.visibleTo?.includes(token) || pages[pageId]?.visibleTo?.includes('__ALL__');
    const div = document.createElement('div');
    div.className = 'share-player-row';
    div.innerHTML = `${canView ? '✅' : '⛔'} ${player.name}`;
    div.onclick = () => {
      if (!canView) { alert(`${player.name} can't see this page. Update visibility first.`); return; }
      copyShareLink(token, player.name, pageId, headingId);
      panel.remove();
    };
    panel.appendChild(div);
  }

  // Close on outside click
  setTimeout(() => document.addEventListener('click', () => panel.remove(), { once: true }), 50);
  document.body.appendChild(panel);

  // Position near mouse — handled by fixed + CSS
}

function copyShareLink(token, name, pageId, headingId) {
  const base = token ? buildURL(token, pageId) : `${getBaseURL()}?page=${pageId}`;
  const url = base + (headingId ? `#${headingId}` : '');
  navigator.clipboard.writeText(url);
  alert(`Copied${name ? ' for ' + name : ' public link'}!\n\n${url}`);
}

function generateShareLink(token, name, canView) {
  if (canView === false) {
    alert(`${name} doesn't have access to this page. Update visibility first.`);
    return;
  }
  const heading = window.location.hash || '';
  const url = buildURL(token, currentPageId) + heading;
  navigator.clipboard.writeText(url);
  document.getElementById('share-panel').classList.add('hidden');
  alert(`Copied link for ${name || 'All Players'}!\n\n${url}`);
}

// ─── Debug ────────────────────────────────────────────────────────────
function dmLog(label, ...args) {
  if (!currentPlayer?.isDM) return;
  console.log(`[DM DEBUG] ${label}`, ...args);
}
