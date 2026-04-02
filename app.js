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
  if (config.players[token]) {
    currentPlayer = { token, ...config.players[token], isDM: false };
  } else if (config.dmToken && token === config.dmToken) {
    currentPlayer = { token, name: 'DM', canSee: '__ALL__', isDM: true };
  } else {
    showAccessDenied(); return;
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
  // Check hash first, then localStorage fallback
  const hash = window.location.hash.replace('#', '').trim();
  if (hash) return hash;
  return localStorage.getItem('dnd_token') || null;
}

function showAccessDenied() {
  document.getElementById('access-denied').classList.remove('hidden');
}

function initApp() {
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('player-name-display').textContent = currentPlayer.name;
  if (currentPlayer.isDM) {
    document.getElementById('dm-nav').classList.remove('hidden');
  }
  buildNav();
  showView('home');
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

  // Content
  document.getElementById('page-content').innerHTML = page.content || '';

  // Outline from headings
  buildOutline();

  // DM controls
  if (currentPlayer.isDM) {
    document.getElementById('dm-page-controls').classList.remove('hidden');
    buildVisibilityCheckboxes(page);
  }
}

function buildOutline() {
  const content = document.getElementById('page-content');
  const headings = content.querySelectorAll('h1,h2,h3');
  const outline = document.getElementById('page-outline');
  outline.innerHTML = '';
  headings.forEach((h, i) => {
    const id = `heading-${i}`;
    h.id = id;
    const li = document.createElement('li');
    li.style.marginLeft = h.tagName === 'H3' ? '12px' : h.tagName === 'H2' ? '6px' : '0';
    li.innerHTML = `<a href="#${id}" onclick="scrollToHeading('${id}')">${h.textContent}</a>`;
    outline.appendChild(li);
  });
  const wrap = document.getElementById('page-outline-wrap');
  wrap.style.display = headings.length ? '' : 'none';
}

function scrollToHeading(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

// ─── CARDS ────────────────────────────────────────────────────────────────────
function renderCards() {
  const grid = document.getElementById('cards-grid');
  grid.innerHTML = '';
  for (const [id, page] of Object.entries(pages)) {
    if (!canSee(id)) continue;
    const card = document.createElement('div');
    card.className = 'card';
    card.onclick = () => navigateTo(id);
    const imgHtml = page.thumbnail
      ? `<img src="${page.thumbnail}" alt="${page.title}" loading="lazy"/>`
      : `<div class="card-no-img">📜</div>`;
    card.innerHTML = `
      ${imgHtml}
      <div class="card-body">
        <div class="card-title">${page.title}</div>
        <div class="card-desc">${page.description || ''}</div>
      </div>`;
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
    const idx = Object.keys(pages);
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
      <button onclick="removePlayer('${token}')" style="margin-left:8px;padding:2px 8px;border:1px solid #c44;background:transparent;color:#c44;border-radius:4px;cursor:pointer">Remove</button>`;
    list.appendChild(div);
  }
}

async function removePlayer(token) {
  if (!confirm(`Remove player "${config.players[token]?.name}"?`)) return;
  delete config.players[token];
  const ok = await githubSave('../config.json', config, `Remove player: ${token}`);
  if (ok) { renderConfig(); alert('Player removed!'); }
}

async function saveConfig() {
  const ok = await githubSave('../config.json', config, 'Update config');
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
  const ok = await githubSave('../config.json', config, `Add player: ${name}`);
  if (ok) { renderConfig(); alert(`${name} added!`); }
}

// ─── FETCH HELPERS ────────────────────────────────────────────────────────────
async function fetchJSON(path) {
  try {
    const res = await fetch(`${RAW_BASE}/${path}`);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}
