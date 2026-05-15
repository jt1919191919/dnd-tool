// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Set your GitHub username and repo name here
const GITHUB_USER = 'jt1919191919';
const GITHUB_REPO = 'dnd-tool';
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/data`;
const GITHUB_API = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data`;
const GITHUB_API_ROOT = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents`;

function getPAT() { return localStorage.getItem('dnd_pat') || ''; }
// ─── CACHE ────────────────────────────────────────────────────────────────────
const CACHE_KEY = 'dnd_cache_v1';
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cache = JSON.parse(raw);
    if (!cache || !cache.config || !cache.pages || !cache.cachedAt) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    if (Date.now() - cache.cachedAt > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    return cache;
  } catch {
    localStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function saveCache(configData, pagesData) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      config: configData,
      pages: pagesData,
      cachedAt: Date.now()
    }));
  } catch(e) {
    // localStorage full or unavailable — just skip caching
    console.warn('Cache save failed:', e);
  }
}

function bustCache() {
  localStorage.removeItem(CACHE_KEY);
}

async function refreshCacheInBackground() {
  try {
    const freshConfig = await fetchJSON('config.json');
    if (!freshConfig) return;
    const freshPages = {};
    const pageIndex = await fetchJSON('pages/index.json');
    if (pageIndex) {
      for (const id of pageIndex) {
        const p = await fetchJSON(`pages/${id}.json`);
        if (p) freshPages[id] = p;
      }
    }
    saveCache(freshConfig, freshPages);
  } catch(e) {
    console.warn('Background cache refresh failed:', e);
  }
}

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
  try {
  const token = getTokenFromURL();
  if (!token) { showAccessDenied(); return; }

  localStorage.setItem('dnd_token', token);

  const cache = loadCache();

  if (cache && !currentPlayer?.isDM) {
    // ── Cache hit: boot instantly ──────────────────────────────────
    config = cache.config;
    pages = cache.pages;

    if (config.dmToken && token === config.dmToken) {
      currentPlayer = { token, name: 'DM', canSee: '__ALL__', isDM: true };
      // DM always gets fresh data — fall through to network load
    } else {
      if (token && config.players[token]) {
        currentPlayer = { token, ...config.players[token], isDM: false };
      } else {
        currentPlayer = { token: '__PUBLIC__', name: '', canSee: [], isDM: false };
      }
      initApp();
      document.getElementById('loading-screen').style.display = 'none';

      // Refresh in background — update cache silently, no UI changes
      refreshCacheInBackground();
      return;
    }
  }

  // ── No cache (or DM): full network load ───────────────────────────
  config = await fetchJSON('config.json');
  if (!config) { showAccessDenied(); return; }

  if (config.dmToken && token === config.dmToken) {
    currentPlayer = { token, name: 'DM', canSee: '__ALL__', isDM: true };
  } else if (token && config.players[token]) {
    currentPlayer = { token, ...config.players[token], isDM: false };
  } else {
    currentPlayer = { token: '__PUBLIC__', name: '', canSee: [], isDM: false };
  }

  const pageIndex = await fetchJSON('pages/index.json');
  if (pageIndex) {
    for (const id of pageIndex) {
      const p = await fetchJSON(`pages/${id}.json`);
      if (p) pages[id] = p;
    }
  }

  // Save to cache (players only — DM skips)
  if (!currentPlayer.isDM) {
    saveCache(config, pages);
  }

  initApp();
    document.getElementById('loading-screen').style.display = 'none';
    // Push an initial state so popstate always has something to fire against
    history.pushState({ dnd: 'home' }, '');
  } catch(e) {
    console.error('Boot error:', e);
    bustCache();
    document.getElementById('loading-screen').style.display = 'none';
    showAccessDenied();
  }
});

window.addEventListener('load', () => {
  // Debug helper - type debugPages() in console to check what loaded
  window.debugPages = async () => {
    const pat = getPAT();
    const headers = pat ? { Authorization: `token ${pat}` } : {};
    console.log('=== PAGE DEBUG ===');
    console.log('Pages in memory:', Object.keys(pages));
    const idxRes = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/pages/index.json?_=${Date.now()}`, { headers });
    if (!idxRes.ok) { console.error('index.json fetch failed:', idxRes.status); return; }
    const idxJson = await idxRes.json();
    const idx = JSON.parse(decodeURIComponent(escape(atob(idxJson.content))));
    console.log('index.json on GitHub:', idx);
    const missing = idx.filter(id => !pages[id]);
    const extra = Object.keys(pages).filter(id => !idx.includes(id));
    if (missing.length) console.warn('In index but NOT loaded:', missing);
    if (extra.length) console.warn('Loaded but NOT in index:', extra);
    if (!missing.length && !extra.length) console.log('All pages match index ✓');
    for (const id of missing) {
      const r = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/pages/${id}.json?_=${Date.now()}`, { headers });
      console.log(`File exists for "${id}":`, r.ok, r.status);
    }
  };
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

function updateSiteTitle() {
  const titleEl = document.getElementById('site-title');
  if (!titleEl) return;
  const onHome = document.getElementById('view-home') && !document.getElementById('view-home').classList.contains('hidden');
  if (onHome) {
    titleEl.textContent = 'CAMPAIGN WIKI';
    titleEl.onclick = () => showView('home');
  } else {
    titleEl.textContent = '← Home';
    titleEl.onclick = () => { showView('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  }
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

window.addEventListener('scroll', () => {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  btn.style.display = window.scrollY > 300 ? 'flex' : 'none';
});
window.addEventListener('popstate', (e) => {
  // Ignore hash-only changes (e.g. href="#" nav links)
  if (window.location.hash && !e.state) return;
  history.pushState({ dnd: 'home' }, '');
  showView('home');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

async function initApp() {
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
  if (pageId && pages[pageId]) {
    const page = pages[pageId];
    const isPublic = page.visibleTo?.includes('__ALL__');
    const headingHash = window.location.hash?.replace('#', '') || null;
    if (isPublic) {
      navigateTo(pageId, null, null, headingHash);
    } else if (canSee(pageId)) {
      navigateTo(pageId, null, null, headingHash);
    } else {
      // Wrong player or not signed in — block
      showAccessDenied();
    }
  } else {
    showView('home');
  }
  // Build spell search index from all table blocks in visible pages
  await buildSpellIndex();
  buildContentIndex();
}

// ─── SEARCH INDEX ─────────────────────────────────────────────────────────────
let spellIndex = []; // [{ name, pageId, pageTitle, tableId, nearestHeading }]
let contentIndex = []; // [{ pageId, pageTitle, headingText, bodyText }]
let contentIndexReady = false;
let lastSearchQuery = '';
let searchDebounceTimer = null;

function buildContentIndex() {
  contentIndex = [];
  for (const [pageId, page] of Object.entries(pages)) {
    if (!canSee(pageId)) continue;
    const div = document.createElement('div');
    div.innerHTML = page.content || '';
    div.querySelectorAll('.h-badge, .dnd-table-block').forEach(b => b.remove());

    // Index each heading + the text under it as a chunk
    const headings = Array.from(div.querySelectorAll('h1,h2,h3,h4'));
    let lastHeading = null;
    let buffer = [];

    const flushBuffer = () => {
      if (buffer.length) {
        contentIndex.push({
          pageId,
          pageTitle: page.title,
          headingText: lastHeading,
          headingLevel: lastHeadingLevel,
          bodyText: buffer.join(' ').toLowerCase()
        });
        buffer = [];
      }
    };

    let lastHeadingLevel = 1;
    const walk = (node) => {
      if (node.nodeType === 1 && /^H[1-4]$/.test(node.tagName)) {
        flushBuffer();
        lastHeading = node.textContent.replace('🔗','').trim();
        lastHeadingLevel = parseInt(node.tagName[1]);
        return;
      }
      if (node.nodeType === 3 && node.textContent.trim()) {
        buffer.push(node.textContent.trim());
        return;
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(div);
    flushBuffer();

    // Also index tagged content
    const tagDiv = document.createElement('div');
    tagDiv.innerHTML = page.content || '';
    tagDiv.querySelectorAll('.search-tag[data-tags]').forEach(span => {
      contentIndex.push({
        pageId,
        pageTitle: page.title,
        headingText: null,
        bodyText: span.dataset.tags.toLowerCase() + ' ' + span.textContent.toLowerCase(),
        isTag: true,
        tagText: span.textContent.trim(),
        tagValue: span.dataset.tags
      });
    });
  }
  contentIndexReady = true;
}

async function buildSpellIndex() {
  spellIndex = [];
  for (const [pageId, page] of Object.entries(pages)) {
    if (!canSee(pageId)) continue;
    // Find all table block IDs embedded in this page's content
    const div = document.createElement('div');
    div.innerHTML = page.content || '';
    const tableBlocks = div.querySelectorAll('.dnd-table-block[data-table-id]');
    for (const block of tableBlocks) {
      const tableId = block.dataset.tableId;
      // Find nearest heading above this block in the page content
      let nearestHeading = null;
      let prev = block.previousElementSibling;
      while (prev) {
        if (/^H[1-4]$/.test(prev.tagName)) {
          nearestHeading = prev.textContent.replace('🔗','').trim();
          break;
        }
        prev = prev.previousElementSibling;
      }
      // Load table data
      const tableData = await loadTableData(tableId);
      if (!tableData || !tableData.rows) continue;
      for (const row of tableData.rows) {
        if (row['Name']) {
          // Store each cell separately for snippet finding
        const cells = {};
        for (const [k, v] of Object.entries(row)) { if (v && v.toString().trim()) cells[k] = v.toString().trim(); }
          spellIndex.push({
            name: row['Name'],
            pageId,
            pageTitle: page.title,
            tableId,
            tableType: tableData.tableType || 'spell',
            nearestHeading,
            page: row['Page'] || null,
            cells,
            allText: Object.values(row).join(' ').toLowerCase()
          });
        }
      }
    }
  }
}

// ─── NAV ──────────────────────────────────────────────────────────────────────
function buildNav() {
  const ul = document.getElementById('nav-links');
  ul.innerHTML = '<li><a href="#" onclick="showView(\'home\')"><span class="nav-icon">⌂</span> Home</a></li>';
}

function enterReorderMode() {
  document.getElementById('side-menu').classList.add('hidden');
  showView('home');
  document.getElementById('reorder-bar').classList.remove('hidden');
  renderCards(true);
}

function exitReorderMode() {
  document.getElementById('reorder-bar').classList.add('hidden');
  renderCards(false);
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
  document.getElementById('view-dm-tables').classList.add('hidden');
  document.getElementById('view-dm-images').classList.add('hidden');
  document.getElementById('side-menu').classList.add('hidden');
  document.getElementById('search-results').classList.add('hidden');
  document.getElementById('search-input').value = '';
  document.getElementById('cards-grid').classList.remove('hidden');
  // Update URL back to just token when going home
  if (view === 'home') {
    window.history.pushState({}, '', buildURL(currentPlayer.token));
  }
  
  if (view === 'home') {
    document.getElementById('view-home').classList.remove('hidden');
    renderCards();
  }
  updateSiteTitle();
  if (view === 'dm-editor') {
    document.getElementById('view-dm-editor').classList.remove('hidden');
    resetEditor();
  } else if (view === 'dm-config') {
    document.getElementById('view-dm-config').classList.remove('hidden');
    renderConfig();
  } else if (view === 'dm-tables') {
    document.getElementById('view-dm-tables').classList.remove('hidden');
    renderManageTables();
  } else if (view === 'dm-images') {
    document.getElementById('view-dm-images').classList.remove('hidden');
    renderLargeImages();
  }
}

function navigateTo(pageId, targetHeadingText, targetPageId, targetHeadingId) {
  if (!canSee(pageId)) return;
  currentPageId = pageId;
  const page = pages[pageId];
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-dm-editor').classList.add('hidden');
  document.getElementById('view-dm-config').classList.add('hidden');
  document.getElementById('side-menu').classList.add('hidden');
  document.getElementById('view-page').classList.remove('hidden');

  const newURL = buildURL(currentPlayer.token, pageId);
  window.history.pushState({}, '', newURL);

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = page.content || '';
  tempDiv.querySelectorAll('.h-badge').forEach(b => b.remove());

  const pageHeader = page.description
    ? `<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08)"><h1 style="font-family:'Times New Roman',serif;color:#ffffff;font-size:28px;margin-bottom:6px">${page.title}</h1><p style="color:#888;font-size:0.85rem;margin:0">${page.description}</p></div>`
    : `<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08)"><h1 style="font-family:'Times New Roman',serif;color:#ffffff;font-size:28px;margin:0">${page.title}</h1></div>`;

  // Prev/next for group pages
  const group = page.group;
  let prevNextHtml = '';
  if (group) {
    const groupIds = getGroupPages(group).filter(id => canSee(id) || currentPlayer.isDM);
    const idx = groupIds.indexOf(pageId);
    const prev = idx > 0 ? groupIds[idx - 1] : null;
    const next = idx < groupIds.length - 1 ? groupIds[idx + 1] : null;
    const partNum = idx + 1;
    const totalParts = groupIds.length;
    prevNextHtml = `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;margin:8px 0;border-top:1px solid rgba(255,255,255,0.08);border-bottom:1px solid rgba(255,255,255,0.08);font-size:0.85rem">
      <div style="flex-shrink:0">${prev ? `<button onclick="navigateTo('${prev}')" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#e0e0e0;border-radius:6px;padding:6px 14px;cursor:pointer;font-family:Roboto,sans-serif;font-size:1rem">←</button>` : '<span style="display:inline-block;width:40px"></span>'}</div>
      <div style="color:#888;text-align:center;flex:1;padding:0 8px;white-space:nowrap">Part ${partNum} of ${totalParts}</div>
      <div style="flex-shrink:0">${next ? `<button onclick="navigateTo('${next}')" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#e0e0e0;border-radius:6px;padding:6px 14px;cursor:pointer;font-family:Roboto,sans-serif;font-size:1rem">→</button>` : '<span style="display:inline-block;width:40px"></span>'}</div>
    </div>`;
  }

  // Make all links open in new tab
  tempDiv.querySelectorAll('a').forEach(a => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  document.getElementById('page-content').innerHTML = pageHeader + prevNextHtml + tempDiv.innerHTML + prevNextHtml;
  // Fix legacy scroll-box inline overflow styles that block sticky
  document.querySelectorAll('#page-content .scroll-box').forEach(box => {
    box.style.overflow = '';
    box.style.overflowX = '';
    box.style.overflowY = '';
  });
  // Wrap sticky-header tables in a scroll container and wire up sorting
  document.querySelectorAll('#page-content table.sticky-header').forEach(table => {
    // Only wrap if not already inside a sticky-header-wrap
    if (!table.parentElement.classList.contains('sticky-header-wrap')) {
      const wrap = document.createElement('div');
      wrap.className = 'sticky-header-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
    table.querySelectorAll('thead th').forEach(th => {
      th.style.cursor = 'pointer';
      th.title = 'Click to sort';
      th.addEventListener('click', () => sortHtmlTable(th));
    });
  });
  window.scrollTo(0, 0);
  renderAllTableBlocks(currentPlayer.isDM).then(() => initScrollHints());
  buildOutline(group);
  // Inject anchor link buttons into all headings
  document.querySelectorAll('#page-content h1, #page-content h2, #page-content h3, #page-content h4').forEach((h, i) => {
    if (h.querySelector('.heading-anchor-btn')) return; // already added
    const btn = document.createElement('button');
    btn.className = 'heading-anchor-btn';
    btn.title = 'Copy link to this section';
    btn.innerHTML = '🔗';
    btn.style.cssText = 'background:none;border:none;cursor:pointer;transition:opacity 0.15s';
    btn.onclick = (e) => {
      e.stopPropagation();
      const headingId = h.id || `heading-${i}`;
      let url = `${getBaseURL()}?page=${currentPageId}#${headingId}`;
      navigator.clipboard.writeText(url);
      window.history.pushState({}, '', url);
      h.scrollIntoView({ behavior: 'smooth' });
      btn.innerHTML = '✓';
      setTimeout(() => btn.innerHTML = '🔗', 1500);
    };
    h.insertBefore(btn, h.firstChild);
  });

  if (currentPlayer.isDM) {
    document.getElementById('dm-page-controls').classList.remove('hidden');
    buildVisibilityCheckboxes(page);
  }
  updateSiteTitle();

  // If we need to scroll to a heading after render
  if (targetHeadingId) {
    const tryScrollById = (attempts) => {
      const el = document.getElementById(targetHeadingId);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      else if (attempts > 0) setTimeout(() => tryScrollById(attempts - 1), 100);
    };
    setTimeout(() => tryScrollById(15), 150);
  } else if (targetHeadingText) {
    const tryScroll = (attempts) => {
      const allH = document.querySelectorAll('#page-content h1,#page-content h2,#page-content h3,#page-content h4');
      const match = Array.from(allH).find(h => h.textContent.replace('🔗','').trim() === targetHeadingText);
      if (match) match.scrollIntoView({ behavior: 'smooth' });
      else if (attempts > 0) setTimeout(() => tryScroll(attempts - 1), 100);
    };
    setTimeout(() => tryScroll(15), 150);
  }
}

function buildOutline(group) {
  const content = document.getElementById('page-content');
  const outline = document.getElementById('page-outline');
  outline.innerHTML = '';

  // Collect headings: current page from DOM, other group pages from raw content
  let allHeadingGroups = []; // [{ pageId, pageTitle, isCurrent, headings: [{text, id}] }]

// Assign IDs to current page DOM headings
  const domHeadings = Array.from(content.querySelectorAll('h1,h2,h3,h4'));
  domHeadings.forEach((h, i) => { h.id = `heading-${i}`; });

  // Build heading groups in group page order (not current-page-first)
  if (group) {
    const groupIds = getGroupPages(group).filter(id => canSee(id) || currentPlayer.isDM);
    groupIds.forEach(id => {
      const isCurrent = id === currentPageId;
      if (isCurrent) {
        if (domHeadings.length) {
          allHeadingGroups.push({
            pageId: id,
            pageTitle: pages[id]?.title,
            isCurrent: true,
            headings: domHeadings.map((h, i) => ({
              text: h.textContent.replace('🔗','').trim(),
              id: `heading-${i}`,
              level: parseInt(h.tagName[1])
            }))
          });
        }
      } else {
        const p = pages[id];
        if (!p) return;
        const div = document.createElement('div');
        div.innerHTML = p.content || '';
        div.querySelectorAll('.h-badge').forEach(b => b.remove());
        const hs = Array.from(div.querySelectorAll('h1,h2,h3,h4'));
        if (hs.length) {
          allHeadingGroups.push({
            pageId: id,
            pageTitle: p.title,
            isCurrent: false,
            headings: hs.map((h, i) => ({
              text: h.textContent.replace('🔗','').trim(),
              id: `heading-${i}`,
              level: parseInt(h.tagName[1])
            }))
          });
        }
      }
    });
  } else {
    // Non-group page — just use DOM headings
    if (domHeadings.length) {
      allHeadingGroups.push({
        pageId: currentPageId,
        pageTitle: pages[currentPageId]?.title,
        isCurrent: true,
        headings: domHeadings.map((h, i) => ({
          text: h.textContent.replace('🔗','').trim(),
          id: `heading-${i}`,
          level: parseInt(h.tagName[1])
        }))
      });
    }
  }

  if (!allHeadingGroups.length) {
    document.getElementById('page-outline-wrap').style.display = 'none';
    return;
  }

  // Level filter
  const allLevels = [...new Set(allHeadingGroups.flatMap(g => g.headings.map(h => h.level)))].sort();
  const filterWrap = document.createElement('div');
  filterWrap.style.marginBottom = '8px';
  filterWrap.innerHTML = `<select id="toc-level-filter" style="background:rgba(255,255,255,0.06);color:#e0e0e0;border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:3px 8px;font-size:0.8rem">
    <option value="0">Show top level only</option>
    ${allLevels.map(l => `<option value="${l}">Expand through H${l}</option>`).join('')}
  </select>`;
  outline.appendChild(filterWrap);

  const treeContainer = document.createElement('div');
  treeContainer.id = 'toc-tree';

  allHeadingGroups.forEach(group => {
    // Group label if multiple parts
    if (allHeadingGroups.length > 1) {
      const label = document.createElement('div');
      label.style.cssText = 'font-size:0.75rem;color:#888;margin:8px 0 4px;text-transform:uppercase;letter-spacing:0.05em;';
      label.textContent = group.pageTitle;
      treeContainer.appendChild(label);
    }

    const tree = buildTocTree(group.headings.map((h, i) => ({
      ...h,
      isCurrent: group.isCurrent,
      pageId: group.pageId
    })));
    renderTocTree(treeContainer, tree, true, group.isCurrent, group.pageId);
  });

  outline.appendChild(treeContainer);

  document.getElementById('toc-level-filter').addEventListener('change', function() {
    applyTocFilter(parseInt(this.value));
  });

  // Apply saved default TOC level for this page
  const savedTocLevel = pages[currentPageId]?.defaultTocLevel ?? 0;
  document.getElementById('toc-level-filter').value = savedTocLevel;
  applyTocFilter(savedTocLevel);

  document.getElementById('page-outline-wrap').style.display = '';
}

function buildTocTree(headings) {
  const root = [];
  const stack = [];
  headings.forEach((h, i) => {
    const level = h.level || parseInt(h.tagName?.[1]) || 1;
    const node = { id: h.id || `heading-${i}`, text: h.text || h.textContent?.replace('🔗','').trim(), level, children: [], isCurrent: h.isCurrent, pageId: h.pageId };
    while (stack.length && stack[stack.length-1].level >= level) stack.pop();
    if (!stack.length) root.push(node);
    else stack[stack.length-1].children.push(node);
    stack.push(node);
  });
  return root;
}

function renderTocTree(container, nodes, isRoot) {
  nodes.forEach(node => {
    const wrap = document.createElement('div');
    wrap.dataset.tocLevel = node.level;
    wrap.dataset.tocId = node.id;
    wrap.style.marginLeft = isRoot ? '0' : '12px';
    wrap.style.marginBottom = '3px';

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:4px;';

    // Caret (only if has children)
    const caret = document.createElement('span');
    if (node.children.length) {
      caret.textContent = '▶';
      caret.style.cssText = 'cursor:pointer;font-size:0.65rem;color:#aaa;min-width:10px;flex-shrink:0';
    } else {
      caret.style.cssText = 'min-width:10px;flex-shrink:0;display:inline-block';
    }
    row.appendChild(caret);

    // Share btn
    if (currentPlayer.isDM) {
      const shareBtn = document.createElement('button');
      shareBtn.className = 'share-btn';
      shareBtn.textContent = '🔗';
      shareBtn.title = 'Share';
      shareBtn.onclick = (e) => { e.stopPropagation(); openSharePanel(currentPageId, node.id); };
      row.appendChild(shareBtn);
    }

    // Link
    const a = document.createElement('a');
    a.href = `#${node.id}`;
    a.textContent = node.text;
    a.style.cssText = `color:${node.isCurrent === false ? '#aaa' : '#e0e0e0'};text-decoration:none;font-size:0.85rem;`;
    a.onclick = (e) => {
      e.preventDefault();
      if (node.isCurrent === false && node.pageId) {
        navigateTo(node.pageId, node.text);
      } else {
        scrollToHeading(node.id);
      }
    };
    row.appendChild(a);

    wrap.appendChild(row);

    // Children container — collapsed by default
    if (node.children.length) {
      const childWrap = document.createElement('div');
      childWrap.style.display = 'none';
      childWrap.dataset.childWrap = 'true';
      renderTocTree(childWrap, node.children, false);
      wrap.appendChild(childWrap);

      caret.onclick = (e) => {
        e.stopPropagation();
        const collapsed = childWrap.style.display === 'none';
        childWrap.style.display = collapsed ? '' : 'none';
        caret.textContent = collapsed ? '▼' : '▶';
      };
    }

    container.appendChild(wrap);
  });
}

function applyTocFilter(maxLevel) {
  const tree = document.getElementById('toc-tree');
  if (!tree) return;
  // First collapse everything
  tree.querySelectorAll('[data-child-wrap]').forEach(el => {
    el.style.display = 'none';
    const caret = el.parentElement.querySelector('span');
    if (caret && caret.textContent === '▼') caret.textContent = '▶';
  });
  if (maxLevel === 0) return;
  // Expand up to maxLevel
  tree.querySelectorAll('[data-toc-level]').forEach(wrap => {
    const level = parseInt(wrap.dataset.tocLevel);
    if (level < maxLevel) {
      const childWrap = wrap.querySelector('[data-child-wrap]');
      if (childWrap) {
        childWrap.style.display = '';
        const caret = wrap.querySelector('span');
        if (caret) caret.textContent = '▼';
      }
    }
  });
}

function scrollToHeading(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  // Update URL with heading anchor, preserving token and page
  const newURL = buildURL(currentPlayer.token, currentPageId, id);
  window.history.pushState({}, '', newURL);
}

// ─── CARDS ────────────────────────────────────────────────────────────────────
function getPageOrder() {
  // Use saved order from index, filtered to only pages that exist and are visible
  const allIds = Object.keys(pages);
  return allIds;
}

function renderCards(reorderMode) {
  const grid = document.getElementById('cards-grid');
  grid.innerHTML = '';
  const ids = getPageOrder().filter(id => {
    if (!canSee(id)) return false;
    // Players only see first page of a group
    if (!currentPlayer.isDM && pages[id]?.group && !isFirstInGroup(id)) return false;
    return true;
  });
  ids.forEach(id => {
    const page = pages[id];
    if (!page) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.pageId = id;
    if (reorderMode) card.draggable = true;
    // DM visibility shadow
    if (currentPlayer.isDM) {
      const vis = page.visibleTo || [];
      if (vis.length === 0) {
        card.style.boxShadow = '0 0 0 2px #c44, 0 4px 16px rgba(204,68,68,0.3)';
      } else if (vis.includes('__ALL__')) {
        card.style.boxShadow = '0 0 0 2px #5cb85c, 0 4px 16px rgba(92,184,92,0.3)';
      } else {
        // Get colors for each player that can see this
        const colors = vis.map(t => config.players[t] ? getPlayerColor(t) : null).filter(Boolean);
        if (colors.length === 1) {
          card.style.boxShadow = `0 0 0 2px ${colors[0]}, 0 4px 16px ${colors[0]}44`;
        } else if (colors.length > 1) {
          // Gradient border via outline workaround using a pseudo-approach with outline + gradient background
          const stops = colors.map((c, i) => `${c} ${Math.round(i * 100 / (colors.length - 1))}%`).join(', ');
          card.style.setProperty('--card-gradient', `linear-gradient(90deg, ${stops})`);
          card.style.boxShadow = colors.map(c => `0 0 8px ${c}55`).join(', ');
          card.style.outline = '2px solid transparent';
          card.style.backgroundImage = `linear-gradient(var(--bg-solid, #222323), var(--bg-solid, #222323)), linear-gradient(90deg, ${stops})`;
          card.style.backgroundOrigin = 'border-box';
          card.style.backgroundClip = 'padding-box, border-box';
          card.style.border = '2px solid transparent';
        }
      }
    }
    const imgHtml = page.thumbnail
      ? `<img src="${page.thumbnail}" alt="${page.title}" loading="lazy"/>`
      : `<div class="card-no-img">📜</div>`;
    card.innerHTML = `
      ${reorderMode ? '<div class="drag-handle" style="text-align:center;padding:4px;color:#e2b96f;font-size:1.2rem;cursor:grab">⠿</div>' : ''}
      ${imgHtml}
      <div class="card-body">
        <div class="card-title-row">
          <span class="card-title">${page.title}</span>
          ${currentPlayer.isDM && !reorderMode ? `<button class="share-btn" onclick="event.stopPropagation();openSharePanel('${id}',null)" title="Share">🔗</button>
          <button class="share-btn" onclick="event.stopPropagation();openVisibilityPopup('${id}',this)" title="Visibility">👁️</button>` : ''}
        </div>
        <div class="card-desc">${page.description || ''}</div>
      </div>`;
    if (!reorderMode) card.onclick = () => navigateTo(id);
    grid.appendChild(card);
  });

  if (reorderMode) initCardDrag(grid);
}

function initCardDrag(grid) {
  let dragSrc = null;

  grid.querySelectorAll('.card').forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragSrc = card;
      card.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.style.opacity = '';
      grid.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      grid.querySelectorAll('.card').forEach(c => c.classList.remove('drag-over'));
      card.classList.add('drag-over');
    });
    card.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragSrc === card) return;
      const allCards = Array.from(grid.querySelectorAll('.card'));
      const srcIdx = allCards.indexOf(dragSrc);
      const tgtIdx = allCards.indexOf(card);
      if (srcIdx < tgtIdx) grid.insertBefore(dragSrc, card.nextSibling);
      else grid.insertBefore(dragSrc, card);
      card.classList.remove('drag-over');
    });
  });
}

async function savePageOrder() {
  const grid = document.getElementById('cards-grid');
  const newOrder = Array.from(grid.querySelectorAll('.card')).map(c => c.dataset.pageId);
  // Reorder the pages object and save index
  const newPages = {};
  newOrder.forEach(id => { if (pages[id]) newPages[id] = pages[id]; });
  // Include any pages not in grid (shouldn't happen but safety net)
  Object.keys(pages).forEach(id => { if (!newPages[id]) newPages[id] = pages[id]; });
  pages = newPages;
  const ok = await githubSave('pages/index.json', newOrder, 'Reorder pages');
  if (ok) {
    alert('Order saved!');
    exitReorderMode();
  }
}

// ─── SEARCH ───────────────────────────────────────────────────────────────────
function handleSearch(query) {
  const resultsWrap = document.getElementById('search-results');
  const resultsList = document.getElementById('search-results-list');
  const cards = document.getElementById('cards-grid');

  if (!query.trim()) {
    lastSearchQuery = '';
    resultsWrap.classList.add('hidden');
    cards.classList.remove('hidden');
    if (currentPageId) {
      document.getElementById('view-home').classList.add('hidden');
      document.getElementById('view-page').classList.remove('hidden');
    }
    return;
  }

  // ── Debounce: wait 200ms after typing stops ───────────────────────
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => runSearch(query), 200);
}

function runSearch(query) {
  if (query === lastSearchQuery) return;
  lastSearchQuery = query;

  const resultsWrap = document.getElementById('search-results');
  const resultsList = document.getElementById('search-results-list');
  const cards = document.getElementById('cards-grid');

  document.getElementById('view-page').classList.add('hidden');
  document.getElementById('view-dm-editor').classList.add('hidden');
  document.getElementById('view-dm-config').classList.add('hidden');
  document.getElementById('view-home').classList.remove('hidden');
  cards.classList.add('hidden');
  resultsWrap.classList.remove('hidden');
  resultsList.innerHTML = '';
  window.scrollTo(0, 0);

  const q = query.toLowerCase().trim();
  const qWords = q.split(/\s+/).filter(Boolean);
  const REGULAR_CAP = 30;

  // Multi-word match: all words present anywhere in text, any order
  const allWordsMatch = (text) => qWords.every(w => text.toLowerCase().includes(w));
  const isExact = (text) => text.toLowerCase().trim() === q;
  const isExactWord = (text) => {
    const t = text.toLowerCase().trim();
    return t === q || new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`).test(t);
  };

  // Priority buckets — rendered top to bottom, gold bordered
  // [0] page exact, [1] page partial, [2] spell/monster exact, [3] spell/monster partial,
  // [4] h1 exact, [5] h1 partial, [6] h2 exact, [7] h2 partial,
  // [8] h3 exact, [9] h3 partial, [10] h4 exact, [11] h4 partial
  const priorityBuckets = Array.from({length: 12}, () => []);

  // Regular grouped results (body content, capped)
  const groups = {};
  let regularCount = 0;
  let cappedCount = 0;
  const addResult = (pageId, pageTitle, itemHtml, onClickFn) => {
    if (regularCount >= REGULAR_CAP) { cappedCount++; return; }
    if (!groups[pageId]) groups[pageId] = { title: pageTitle, items: [] };
    groups[pageId].items.push({ itemHtml, onClickFn });
    regularCount++;
  };

  // ── Page name matches → priority ──────────────────────────────────
  for (const [id, page] of Object.entries(pages)) {
    if (!canSee(id)) continue;
    const titleLower = (page.title || '').toLowerCase();
    const descLower = (page.description || '').toLowerCase();
    const titleHit = allWordsMatch(titleLower);
    const descHit = allWordsMatch(descLower);
    if (!titleHit && !descHit) continue;

    const exact = isExact(page.title || '');
    const bucket = exact ? 0 : 1;
    priorityBuckets[bucket].push({
      itemHtml: `
        <div class="sr-label">Page</div>
        <div class="sr-title">${highlightMatch(page.title, query)}</div>
        ${page.description ? `<div class="sr-snippet">${highlightMatch(page.description, query)}</div>` : ''}`,
      onClickFn: () => { clearSearch(); navigateTo(id); }
    });
  }

  // ── Spell/Monster matches → priority ──────────────────────────────
  const spellMatches = spellIndex.filter(s => s.allText && allWordsMatch(s.allText));
  for (const spell of spellMatches) {
    const resultIcon = spell.tableType === 'monster' ? '🐉' : '🔮';
    const nameExact = isExact(spell.name);
    const nameHit = allWordsMatch(spell.name.toLowerCase());
    let snippet = '';
    if (spell.cells) {
      for (const [k, v] of Object.entries(spell.cells)) {
        if (k === 'Name') continue;
        if (allWordsMatch(v.toLowerCase())) {
          snippet = `${highlightMatch(getSnippet(v, q), query)}`;
          break;
        }
      }
    }
    const itemHtml = `
      <div class="sr-label">${spell.tableType === 'monster' ? 'Monster' : 'Spell'} · Page: ${highlightMatch(spell.pageTitle, query)}</div>
      <div class="sr-title">${resultIcon} ${highlightMatch(spell.name, query)}</div>
      ${spell.nearestHeading ? `<div class="sr-heading">Heading: ${highlightMatch(spell.nearestHeading, query)}</div>` : ''}
      ${snippet ? `<div class="sr-snippet">${snippet}</div>` : ''}`;
    const onClickFn = () => {
      clearSearch();
      navigateTo(spell.pageId);
      const waitForTable = (attempts) => {
        const wrap = document.getElementById(`tbl-${spell.tableId}`);
        if (wrap && wrap.__rows) navigateToSpellRow(spell.tableId, spell.name);
        else if (attempts > 0) setTimeout(() => waitForTable(attempts - 1), 200);
      };
      setTimeout(() => waitForTable(20), 300);
    };
    if (nameHit) {
      priorityBuckets[nameExact ? 2 : 3].push({ itemHtml, onClickFn });
    } else {
      addResult(spell.pageId, spell.pageTitle, itemHtml, onClickFn);
    }
  }

  // ── Content index: headings → priority, body → grouped ────────────
  if (contentIndexReady) {
    const seenHeadings = new Set();
    for (const chunk of contentIndex) {
      if (!canSee(chunk.pageId)) continue;

      if (chunk.isTag) {
        if (allWordsMatch(chunk.bodyText)) {
          const capturedTags = chunk.tagValue;
          const tagText = chunk.tagText;
          priorityBuckets[0].push({
            itemHtml: `
              <div class="sr-label">Page: ${highlightMatch(pages[chunk.pageId]?.title || '', query)}</div>
              <div class="sr-title">${highlightMatch(tagText, query)}<span class="sr-tag-hint">🏷</span></div>
              <div class="sr-snippet">${highlightMatch(getSnippet(tagText, q), query)}</div>`,
            onClickFn: () => {
              clearSearch();
              navigateTo(chunk.pageId);
              const tryScrollToTag = (attempts) => {
                const allTags = document.querySelectorAll('#page-content .search-tag');
                const match = Array.from(allTags).find(el =>
                  el.dataset.tags === capturedTags && el.textContent.trim() === tagText
                );
                if (match) match.scrollIntoView({ behavior: 'smooth', block: 'center' });
                else if (attempts > 0) setTimeout(() => tryScrollToTag(attempts - 1), 100);
              };
              setTimeout(() => tryScrollToTag(15), 150);
            }
          });
        }
        continue;
      }

      // Heading match → priority bucket by level
      if (chunk.headingText && allWordsMatch(chunk.headingText.toLowerCase())) {
        const hText = chunk.headingText;
        const id = chunk.pageId;
        const level = chunk.headingLevel || 1; // 1-4
        const exact = isExact(hText);
        const bucketBase = 4 + (level - 1) * 2; // h1=4/5, h2=6/7, h3=8/9, h4=10/11
        const bucket = exact ? bucketBase : bucketBase + 1;
        priorityBuckets[bucket].push({
          itemHtml: `
            <div class="sr-label">H${level} · Page: ${highlightMatch(pages[id]?.title || '', query)}</div>
            <div class="sr-title">${highlightMatch(hText, query)}</div>`,
          onClickFn: () => {
            clearSearch();
            navigateTo(id);
            const tryScroll = (attempts) => {
              const allH = document.querySelectorAll('#page-content h1,#page-content h2,#page-content h3,#page-content h4');
              const match = Array.from(allH).find(h => h.textContent.replace('🔗','').trim() === hText);
              if (match) match.scrollIntoView({ behavior: 'smooth' });
              else if (attempts > 0) setTimeout(() => tryScroll(attempts - 1), 100);
            };
            setTimeout(() => tryScroll(15), 150);
          }
        });
      }

      // Body text match → grouped
      if (chunk.bodyText && allWordsMatch(chunk.bodyText)) {
        const headingKey = `${chunk.pageId}__${chunk.headingText || '__top__'}`;
        if (!seenHeadings.has(headingKey)) {
          seenHeadings.add(headingKey);
          const snippet = getSnippet(chunk.bodyText, q);
          const capturedHeading = chunk.headingText;
          const id = chunk.pageId;
          addResult(id, pages[id]?.title || id, `
            <div class="sr-label">Page: ${highlightMatch(pages[id]?.title || '', query)}</div>
            ${capturedHeading ? `<div class="sr-heading">Heading: ${highlightMatch(capturedHeading, query)}</div>` : ''}
            <div class="sr-snippet">${highlightMatch(snippet, query)}</div>`,
            () => {
              clearSearch();
              navigateTo(id);
              if (capturedHeading) {
                const tryScroll = (attempts) => {
                  const allH = document.querySelectorAll('#page-content h1,#page-content h2,#page-content h3,#page-content h4');
                  const match = Array.from(allH).find(h => h.textContent.replace('🔗','').trim() === capturedHeading);
                  if (match) match.scrollIntoView({ behavior: 'smooth' });
                  else if (attempts > 0) setTimeout(() => tryScroll(attempts - 1), 100);
                };
                setTimeout(() => tryScroll(15), 150);
              }
            });
        }
      }
    }
  } else {
    // Fallback if index not ready
    for (const [id, page] of Object.entries(pages)) {
      if (!canSee(id)) continue;
      const contentText = stripHTML(page.content || '');
      if (!allWordsMatch(contentText.toLowerCase())) continue;
      addResult(id, page.title, `
        <div class="sr-label">Page: ${highlightMatch(page.title, query)}</div>
        <div class="sr-snippet">Content match</div>`,
        () => { clearSearch(); navigateTo(id); });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────
  const allPriority = priorityBuckets.flat();

  if (!allPriority.length && !Object.keys(groups).length) {
    resultsList.innerHTML = '<p style="color:#aaa;padding:10px">No results found.</p>';
    return;
  }

  // Priority section
  if (allPriority.length) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:12px;border-bottom:1px solid rgba(226,185,111,0.2);padding-bottom:10px;';
    allPriority.forEach(({ itemHtml, onClickFn }) => {
      const item = document.createElement('div');
      item.className = 'search-result-item search-result-priority';
      item.innerHTML = itemHtml;
      item.onclick = onClickFn;
      section.appendChild(item);
    });
    resultsList.appendChild(section);
  }

  // Grouped regular results — always collapsed
  for (const [pageId, group] of Object.entries(groups)) {
    const folder = document.createElement('div');
    folder.style.cssText = 'margin-bottom:8px;';

    if (group.items.length === 1) {
      const { itemHtml, onClickFn } = group.items[0];
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = itemHtml;
      item.onclick = onClickFn;
      folder.appendChild(item);
    } else {
      const header = document.createElement('div');
      header.style.cssText = 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);border-radius:6px;padding:8px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;';
      header.innerHTML = `<span style="display:flex;align-items:center;gap:8px;color:#e0e0e0;font-weight:bold"><span class="folder-caret" style="color:#888;font-size:0.85rem;min-width:12px">▸</span>${group.title}</span><span style="color:#888;font-size:0.8rem">${group.items.length} results</span>`;
      const children = document.createElement('div');
      children.style.cssText = 'display:none;padding-left:12px;margin-top:4px;';
      group.items.forEach(({ itemHtml, onClickFn }) => {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.innerHTML = itemHtml;
        item.onclick = onClickFn;
        children.appendChild(item);
      });
      header.onclick = () => {
        const open = children.style.display === '';
        children.style.display = open ? 'none' : '';
        header.querySelector('.folder-caret').textContent = open ? '▸' : '▾';
      };
      folder.appendChild(header);
      folder.appendChild(children);
    }
    resultsList.appendChild(folder);
  }

  // Cap notice
  if (cappedCount > 0) {
    const notice = document.createElement('p');
    notice.style.cssText = 'color:#888;font-size:0.8rem;padding:8px 4px;';
    notice.textContent = `${cappedCount} more result${cappedCount > 1 ? 's' : ''} — refine your search to see them.`;
    resultsList.appendChild(notice);
  }
}

function clearSearch() {
  clearTimeout(searchDebounceTimer);
  lastSearchQuery = '';
  document.getElementById('search-input').value = '';
  handleSearch('');
}
function stripHTML(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || '';
}

function highlightMatch(text, query) {
  if (!text || !query) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

function findNearestHeading(htmlContent, query) {
  const div = document.createElement('div');
  div.innerHTML = htmlContent;
  div.querySelectorAll('.h-badge').forEach(b => b.remove());

  const allHeadings = Array.from(div.querySelectorAll('h1,h2,h3,h4'));
  if (!allHeadings.length) return { headingText: null, headingId: null };

  const q = query.toLowerCase();
  let lastHeading = null;
  let lastHeadingIdx = null;

  // Walk the DOM in order
  const walk = (node, idx) => {
    if (node.nodeType === 1) {
      if (/^H[1-4]$/.test(node.tagName)) {
        lastHeading = node;
        lastHeadingIdx = allHeadings.indexOf(node);
      }
      if (node.textContent.toLowerCase().includes(q) && lastHeading && node.tagName !== 'H1' && node.tagName !== 'H2' && node.tagName !== 'H3' && node.tagName !== 'H4') {
        return true; // found match after a heading
      }
      for (const child of node.childNodes) {
        if (walk(child)) return true;
      }
    } else if (node.nodeType === 3) {
      if (node.textContent.toLowerCase().includes(q) && lastHeading) {
        return true;
      }
    }
    return false;
  };

  walk(div);

  if (!lastHeading) return { headingText: null, headingId: null };
  return {
    headingText: lastHeading.textContent.trim(),
    headingId: `heading-${lastHeadingIdx}`
  };
}

function getSnippet(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return text.slice(0, 100) + '...';
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 60);
  return (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '');
}

// ─── DM EDITOR ────────────────────────────────────────────────────────────────
function refreshHeadingBadges() {
  const area = document.getElementById('editor-area');
  if (!area) return;
  area.querySelectorAll('h1,h2,h3,h4').forEach(h => {
    h.querySelectorAll('.h-badge').forEach(b => b.remove());
    const badge = document.createElement('span');
    badge.className = 'h-badge';
    badge.contentEditable = 'false';
    badge.textContent = h.tagName;
    badge.style.cssText = 'font-size:0.6rem;background:#333;color:#aaa;border-radius:3px;padding:1px 4px;margin-right:5px;cursor:pointer;user-select:none;vertical-align:middle;font-family:monospace';
    badge.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openHeadingLevelPopup(badge, h);
    }, true);
    h.insertBefore(badge, h.firstChild);
  });
}

function openHeadingLevelPopup(badge, headingEl) {
  document.querySelectorAll('.heading-level-popup').forEach(p => p.remove());
  const popup = document.createElement('div');
  popup.className = 'heading-level-popup';
  popup.style.cssText = 'position:fixed;background:#16213e;border:1px solid #e2b96f;border-radius:8px;padding:10px;z-index:500;box-shadow:0 4px 16px rgba(0,0,0,0.5);font-size:0.85rem;';
  const rect = badge.getBoundingClientRect();
  popup.style.top = '50%';
  popup.style.left = '50%';
  popup.style.transform = 'translate(-50%, -50%)';

  ['H1','H2','H3','H4','P'].forEach(tag => {
    const opt = document.createElement('div');
    opt.textContent = tag === 'P' ? 'Paragraph' : tag;
    opt.style.cssText = 'padding:6px 12px;cursor:pointer;border-radius:4px;';
    opt.onmouseenter = () => opt.style.background = '#0f3460';
    opt.onmouseleave = () => opt.style.background = '';
    opt.onclick = () => {
      const newEl = document.createElement(tag.toLowerCase());
      // Move all children except the badge itself
      Array.from(headingEl.childNodes).forEach(n => {
        if (!n.classList?.contains('h-badge')) newEl.appendChild(n.cloneNode(true));
      });
      headingEl.replaceWith(newEl);
      popup.remove();
      setTimeout(refreshHeadingBadges, 50);
    };
    popup.appendChild(opt);
  });

  setTimeout(() => document.addEventListener('pointerup', (e) => {
    if (!popup.contains(e.target)) popup.remove();
  }, { once: true }), 300);
  document.body.appendChild(popup);
}

function resetEditor() {
  const existingIds = Object.keys(pages).filter(k => k.startsWith('page-'));
  const nums = existingIds.map(k => parseInt(k.replace('page-',''))).filter(n => !isNaN(n));
  const nextNum = nums.length ? Math.max(...nums) + 1 : 1;
  const newId = `page-${nextNum}`;
  const newTitle = `Page ${nextNum}`;

  document.getElementById('editor-title-label').textContent = 'New Page';
  document.getElementById('editor-page-id').value = newId;
  document.getElementById('editor-page-title').value = newTitle;
  document.getElementById('editor-thumb').value = 'https://raw.githubusercontent.com/jt1919191919/dnd-tool/refs/heads/main/data/images/d20-placeholder2.jpg';
  document.getElementById('editor-description').value = '';
  document.getElementById('editor-area').innerHTML = '';
  document.getElementById('editor-toc-level').value = 0;
  document.getElementById('editor-page-id').disabled = false;
  populateGroupDropdown(null);
  setTimeout(refreshHeadingBadges, 50);
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
  document.getElementById('editor-toc-level').value = page.defaultTocLevel ?? 0;
  const cleanDiv = document.createElement('div');
  cleanDiv.innerHTML = page.content || '';
  cleanDiv.querySelectorAll('.h-badge').forEach(b => b.remove());
  document.getElementById('editor-area').innerHTML = cleanDiv.innerHTML;
  populateGroupDropdown(page.group || '');
  setTimeout(refreshHeadingBadges, 50);
}

function cancelEdit() {
  document.getElementById('view-dm-editor').classList.add('hidden');
  if (currentPageId) {
    document.getElementById('view-page').classList.remove('hidden');
  } else {
    showView('home');
  }
}

async function savePage() {
  const id = document.getElementById('editor-page-id').value.trim();
  const title = document.getElementById('editor-page-title').value.trim();
  if (!id || !title) { alert('Page ID and Title required.'); return; }
  // Check content size before attempting save
  const contentEl = document.getElementById('editor-area');
  const contentSize = new Blob([contentEl.innerHTML]).size;
  console.log(`Page content size: ${(contentSize/1024).toFixed(1)}KB`);
  if (contentSize > 900000) {
    alert(`Content is too large (${(contentSize/1024).toFixed(0)}KB). GitHub's API limit is ~1MB. Try splitting this page into multiple smaller pages.`);
    return;
  }
  if (contentSize > 600000) {
    if (!confirm(`Content is large (${(contentSize/1024).toFixed(0)}KB). This may fail to load reliably. Continue anyway?`)) return;
  }
  const isNew = !pages[id];
  const groupVal = document.getElementById('editor-group')?.value.trim();
  const newGroupVal = document.getElementById('editor-group-new')?.value.trim();
  const finalGroup = groupVal === '__new__' ? newGroupVal : groupVal;
  const pageData = {
    id, title,
    thumbnail: document.getElementById('editor-thumb').value.trim(),
    description: document.getElementById('editor-description').value.trim(),
    content: (() => { const d = document.createElement('div'); d.innerHTML = document.getElementById('editor-area').innerHTML; d.querySelectorAll('.h-badge').forEach(b => b.remove()); return d.innerHTML; })(),
    visibleTo: pages[id]?.visibleTo || [],
    group: finalGroup || '',
    defaultTocLevel: parseInt(document.getElementById('editor-toc-level')?.value || '0')
  };
  pages[id] = pageData;
  // If this page is in a group, force all other group pages to re-read from memory on next ToC build
  if (finalGroup) {
    getGroupPages(finalGroup).forEach(gid => {
      if (gid !== id && pages[gid]) {
        // Touch the object so buildOutline re-parses headings fresh
        pages[gid] = { ...pages[gid] };
      }
    });
  }
  const ok = await githubSave(`pages/${id}.json`, pageData, `Update page: ${id}`);
  if (!ok) return;
  bustCache();
  if (isNew) {
    const idx = await fetchJSON('pages/index.json') || [];
    if (!idx.includes(id)) idx.push(id);
    await githubSave('pages/index.json', idx, `Add page to index: ${id}`);
  }
  buildNav();
  alert('Saved to GitHub!');
  if (currentPageId) {
    document.getElementById('view-dm-editor').classList.add('hidden');
    // Navigate to the page we were viewing (may differ from edited page in a group)
    const returnTo = currentPageId;
    navigateTo(returnTo);
  }
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

  const noneLabel = document.createElement('label');
  const noneCb = document.createElement('input');
  noneCb.type = 'checkbox';
  noneCb.value = '__NONE__';
  noneCb.checked = !page.visibleTo || page.visibleTo.length === 0;
  noneCb.onchange = () => {
    if (noneCb.checked) {
      wrap.querySelectorAll('input[type=checkbox]').forEach(cb => {
        if (cb !== noneCb) cb.checked = false;
      });
    }
  };
  noneLabel.appendChild(noneCb);
  noneLabel.append(' None');
  wrap.appendChild(noneLabel);

  const allLabel = document.createElement('label');
  const allCb = document.createElement('input');
  allCb.type = 'checkbox';
  allCb.value = '__ALL__';
  allCb.checked = page.visibleTo?.includes('__ALL__');
  allCb.onchange = () => { if (allCb.checked) noneCb.checked = false; };
  allLabel.appendChild(allCb);
  allLabel.append(' ALL');
  wrap.appendChild(allLabel);

  for (const [token, player] of Object.entries(config.players)) {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = token;
    cb.checked = page.visibleTo?.includes(token) || page.visibleTo?.includes('__ALL__');
    cb.onchange = () => { if (cb.checked) noneCb.checked = false; };
    label.appendChild(cb);
    label.append(` ${player.name}`);
    wrap.appendChild(label);
  }
}

function openVisibilityPopup(pageId, btn) {
  document.querySelectorAll('.visibility-popup').forEach(p => p.remove());
  const page = pages[pageId];
  const popup = document.createElement('div');
  popup.className = 'visibility-popup';
  popup.style.cssText = 'position:fixed;background:rgba(20,21,21,0.97);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.15);border-radius:8px;padding:12px;z-index:500;box-shadow:0 4px 24px rgba(0,0,0,0.7);font-size:0.85rem;min-width:160px;';

  popup.style.top = '50%';
  popup.style.left = '50%';
  popup.style.transform = 'translate(-50%, -50%)';

  const title = document.createElement('div');
  title.style.cssText = 'color:#888;font-size:0.75rem;margin-bottom:8px;letter-spacing:0.05em;text-transform:uppercase;';
  title.textContent = 'Visible to:';
  popup.appendChild(title);

  const checkboxes = [];

  // None
  const noneLabel = document.createElement('label');
  noneLabel.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;';
  const noneCb = document.createElement('input');
  noneCb.type = 'checkbox';
  noneCb.value = '__NONE__';
  noneCb.checked = !page.visibleTo || page.visibleTo.length === 0;
  noneCb.onchange = () => { if (noneCb.checked) checkboxes.forEach(cb => { if (cb !== noneCb) cb.checked = false; }); };
  noneLabel.appendChild(noneCb);
  noneLabel.append(' None');
  popup.appendChild(noneLabel);
  checkboxes.push(noneCb);

  // All
  const allLabel = document.createElement('label');
  allLabel.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;';
  const allCb = document.createElement('input');
  allCb.type = 'checkbox';
  allCb.value = '__ALL__';
  allCb.checked = page.visibleTo?.includes('__ALL__');
  allCb.onchange = () => { if (allCb.checked) noneCb.checked = false; };
  allLabel.appendChild(allCb);
  allLabel.append(' ALL');
  popup.appendChild(allLabel);
  checkboxes.push(allCb);

  for (const [token, player] of Object.entries(config.players)) {
    const color = getPlayerColor(token);
    const label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = token;
    cb.checked = page.visibleTo?.includes(token) || page.visibleTo?.includes('__ALL__');
    cb.onchange = () => { if (cb.checked) noneCb.checked = false; };
    const dot = document.createElement('span');
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0`;
    label.appendChild(cb);
    label.appendChild(dot);
    label.append(` ${player.name}`);
    popup.appendChild(label);
    checkboxes.push(cb);
  }

  const saveBtn = document.createElement('button');
  saveBtn.textContent = '✓ Save';
  saveBtn.style.cssText = 'margin-top:10px;width:100%;padding:6px;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.05);color:#e0e0e0;border-radius:4px;cursor:pointer;';
  saveBtn.onclick = async (e) => {
    e.stopPropagation();
    const selected = checkboxes.filter(cb => cb.checked && cb.value !== '__NONE__').map(cb => cb.value);
    pages[pageId].visibleTo = selected;
    const ok = await githubSave(`pages/${pageId}.json`, pages[pageId], `Update visibility: ${pageId}`);
    if (ok) { popup.remove(); alert('Visibility saved!'); }
  };
  popup.appendChild(saveBtn);

  setTimeout(() => document.addEventListener('click', (e) => {
    if (!popup.contains(e.target)) popup.remove();
  }, { once: true }), 50);

  document.body.appendChild(popup);
}

async function saveVisibility() {
  if (!currentPageId) return;
  const checkboxes = document.querySelectorAll('#visibility-checkboxes input[type=checkbox]');
  pages[currentPageId].visibleTo = Array.from(checkboxes)
    .filter(c => c.checked && c.value !== '__NONE__')
    .map(c => c.value);
  const ok = await githubSave(`pages/${currentPageId}.json`, pages[currentPageId], `Update visibility: ${currentPageId}`);
  if (ok) alert('Visibility saved!');
}

// ─── CONFIG VIEW ──────────────────────────────────────────────────────────────
const PLAYER_COLOR_PALETTE = [
  '#4e9af1','#e05c5c','#5cb85c','#f0a500','#9b59b6',
  '#1abc9c','#e67e22','#e91e8c','#00bcd4','#8bc34a'
];

function getPlayerColor(token) {
  if (config.players[token]?.color) return config.players[token].color;
  // Auto-assign from palette based on index
  const idx = Object.keys(config.players).indexOf(token) % PLAYER_COLOR_PALETTE.length;
  return PLAYER_COLOR_PALETTE[idx];
}

function renderConfig() {
  document.getElementById('pat-input').value = getPAT();
  const list = document.getElementById('config-player-list');
  list.innerHTML = '';
  for (const [token, player] of Object.entries(config.players)) {
    const color = getPlayerColor(token);
    // Ensure color is stored
    if (!config.players[token].color) config.players[token].color = color;
    const div = document.createElement('div');
    div.className = 'config-player-row';
    div.style.borderLeft = `4px solid ${color}`;
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="width:14px;height:14px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0"></span>
        <strong>${player.name}</strong>
        <span style="color:#aaa;font-size:0.8rem">token: <code>${token}</code></span>
        <label style="font-size:0.8rem;display:flex;align-items:center;gap:4px;margin-left:auto">
          Color: <input type="color" value="${color}" onchange="setPlayerColor('${token}',this.value)" style="width:32px;height:24px;border:none;background:none;cursor:pointer;padding:0"/>
        </label>
        <button onclick="previewAsPlayer('${token}','${player.name}')" style="padding:2px 8px;border:1px solid #7eb8f7;background:transparent;color:#7eb8f7;border-radius:4px;cursor:pointer;font-size:0.8rem">Preview</button>
        <button onclick="copyPlayerHomeLink('${token}','${player.name}')" style="padding:2px 8px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer;font-size:0.8rem">🔗 Copy Link</button>
        <button onclick="removePlayer('${token}')" style="padding:2px 8px;border:1px solid #c44;background:transparent;color:#c44;border-radius:4px;cursor:pointer;font-size:0.8rem">Remove</button>
      </div>`;
    list.appendChild(div);
  }
}

async function setPlayerColor(token, color) {
  config.players[token].color = color;
  await githubSave('config.json', config, `Set color for player: ${token}`);
  renderConfig();
  renderCards();
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

function copyPlayerHomeLink(token, name) {
  const url = buildURL(token);
  navigator.clipboard.writeText(url);
  alert(`Copied home link for ${name}!\n\n${url}`);
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
  const pat = typeof getPAT === 'function' ? getPAT() : '';
  try {
    // Use raw URL for players (no rate limit) — API only for DM who has a PAT
    if (pat) {
      const headers = { Authorization: `token ${pat}` };
      const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/${path}?_=${Date.now()}`, { headers });
      if (!res.ok) { console.warn(`fetchJSON failed for ${path}:`, res.status); return null; }
      const json = await res.json();
      const decoded = decodeURIComponent(escape(atob(json.content)));
      return JSON.parse(decoded);
    } else {
      const res = await fetch(`${RAW_BASE}/${path}?_=${Date.now()}`);
      if (!res.ok) { console.warn(`fetchJSON failed for ${path}:`, res.status); return null; }
      return await res.json();
    }
  } catch(e) { console.error(`fetchJSON error for ${path}:`, e); return null; }
}

// ─── Backups ────────────────────────────────────────────────────────────
async function downloadBackup() {
  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip();
  const pat = getPAT();
  const headers = pat ? { Authorization: `token ${pat}` } : {};

  // Recursively fetch all files from a GitHub directory path
  async function fetchDirRecursive(apiPath, zipPath) {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/${apiPath}?_=${Date.now()}`, { headers });
    if (!res.ok) return;
    const items = await res.json();
    for (const item of items) {
      if (item.type === 'file') {
        try {
          const fileRes = await fetch(item.download_url);
          if (!fileRes.ok) continue;
          const buf = await fileRes.arrayBuffer();
          zip.file(`${zipPath}/${item.name}`, buf);
        } catch {}
      } else if (item.type === 'dir') {
        await fetchDirRecursive(`${apiPath}/${item.name}`, `${zipPath}/${item.name}`);
      }
    }
  }

  // Root files
  zip.file('index.html', await fetchRaw('index.html'));
  zip.file('app.js', await fetchRaw('app.js'));
  zip.file('style.css', await fetchRaw('style.css'));
  zip.file('table-engine.js', await fetchRaw('table-engine.js'));

  // data/ directory recursively (pages, tables, images, config, etc.)
  await fetchDirRecursive('data', 'data');

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

  // Universal link option (same URL regardless of who it's for)
  const allDiv = document.createElement('div');
  allDiv.className = 'share-player-row';
  allDiv.textContent = '🔗 Copy Link (recipient must be signed in)';
  allDiv.onclick = () => { copyShareLink(null, null, pageId, headingId); panel.remove(); };
  panel.appendChild(allDiv);

  for (const [token, player] of Object.entries(config.players)) {
    const canView = pages[pageId]?.visibleTo?.includes(token) || pages[pageId]?.visibleTo?.includes('__ALL__');
    const div = document.createElement('div');
    div.className = 'share-player-row';
    div.innerHTML = `${canView ? '✅' : '⛔'} ${player.name}`;
    div.onclick = () => {
      if (!canView) { alert(`${player.name} can't see this page. Update visibility first.`); return; }
      copyShareLink(null, player.name, pageId, headingId);
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
  // Never put the player token in the share URL.
  // Just encode the page (and optional heading). Auth is the receiver's problem.
  let url = `${getBaseURL()}?page=${pageId}`;
  if (headingId) url += `#${headingId}`;
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

// ─── Manage Tables DM Config ────────────────────────────────────────────────────────────
async function renderManageTables() {
  const list = document.getElementById('tables-list');
  list.innerHTML = '<p style="color:#aaa">Loading...yeah it takes a minute</p>';

  // Get all table files from GitHub
  const pat = getPAT();
  const headers = pat ? { Authorization: `token ${pat}` } : {};
  const res = await fetch(`${GITHUB_API}/tables?_=${Date.now()}`, { headers });
  if (!res.ok) { list.innerHTML = '<p style="color:#c44">Could not load tables folder.</p>'; return; }
  const files = (await res.json()).filter(f => f.name.endsWith('.json') && f.name !== '.gitkeep');

  // Find all table IDs referenced in pages
  const referenced = new Set();
  for (const page of Object.values(pages)) {
    const div = document.createElement('div');
    div.innerHTML = page.content || '';
    div.querySelectorAll('.dnd-table-block[data-table-id]').forEach(b => referenced.add(b.dataset.tableId));
  }

  list.innerHTML = '';
  if (!files.length) { list.innerHTML = '<p style="color:#aaa">No tables found.</p>'; return; }

  for (const file of files) {
    const tableId = file.name.replace('.json', '');
    const isReferenced = referenced.has(tableId);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;background:#16213e;border:1px solid #0f3460;border-radius:6px;padding:10px;margin-bottom:8px;';
    row.innerHTML = `
      <span>${isReferenced ? '✅' : '⚠️'} <strong style="color:#e2b96f">${tableId}</strong> <span style="color:#aaa;font-size:0.75rem">${isReferenced ? 'In use' : 'Orphaned'}</span></span>
      ${!isReferenced ? `<button onclick="deleteOrphanTable('${tableId}', '${file.sha}', this)" style="padding:4px 10px;border:1px solid #c44;background:transparent;color:#c44;border-radius:4px;cursor:pointer;font-size:0.8rem">⤫ Delete</button>` : ''}
    `;
    list.appendChild(row);
  }
}

async function deleteOrphanTable(tableId, sha, btn) {
  if (!confirm(`Delete table "${tableId}"? This cannot be undone.`)) return;
  const pat = getPAT();
  const res = await fetch(`${GITHUB_API}/tables/${tableId}.json`, {
    method: 'DELETE',
    headers: { Authorization: `token ${pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `Delete orphan table: ${tableId}`, sha })
  });
  if (res.ok) {
    btn.closest('div').remove();
    alert(`${tableId} deleted.`);
  } else {
    alert('Delete failed. Check your token permissions.');
  }
}

// ─── WYSIWYG TOOLBAR ──────────────────────────────────────────────────────────

const PALETTE_COLORS = [
  '#ffffff','#e0e0e0','#aaaaaa','#666666','#1a1a2e',
  '#e2b96f','#f7c59f','#f4a261','#e76f51','#c44',
  '#7eb8f7','#0f3460','#16213e','#4ecdc4','#2d6a4f',
  '#a8dadc','#457b9d','#9b5de5','#f15bb5','#fee440'
];

const HIGHLIGHT_COLORS = [
  '#fff3cd','#ffeeba','#f8d7da','#d4edda','#d1ecf1',
  '#e2b96f44','#7eb8f744','#9b5de544','#4ecdc444','#f15bb544',
  'transparent'
];

let colorPickerMode = null; // 'text' or 'highlight'
let savedRange = null;

function saveSelection() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
}

function restoreSelection() {
  if (!savedRange) return;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(savedRange);
}

function toolbarExec(cmd) {
  document.getElementById('editor-area').focus();
  if (cmd === 'bold') {
    applyGoldBold();
    return;
  }
  document.execCommand(cmd, false, null);
}

function applyGoldBold() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return;
  const range = sel.getRangeAt(0);
  // Check if already wrapped in our gold-bold span
  let node = range.commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  if (node.classList && node.classList.contains('bold-gold')) {
    // Unwrap it
    const parent = node.parentNode;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
    return;
  }
  const span = document.createElement('span');
  span.className = 'bold-gold';
  try { range.surroundContents(span); }
  catch(e) {
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
}

function toolbarHeading(tag) {
  const area = document.getElementById('editor-area');
  area.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  let block = range.startContainer;
  while (block && block.parentNode !== area) block = block.parentNode;
  if (!block || block === area) {
    document.execCommand('formatBlock', false, tag === 'p' ? 'p' : tag);
    setTimeout(refreshHeadingBadges, 50);
    return;
  }
  const newEl = document.createElement(tag);
  Array.from(block.childNodes).forEach(n => {
    if (!n.classList?.contains('h-badge')) newEl.appendChild(n.cloneNode(true));
  });
  block.replaceWith(newEl);
  setTimeout(refreshHeadingBadges, 50);
}

function toolbarBlockquote() {
  const area = document.getElementById('editor-area');
  area.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.getRangeAt(0).startContainer;
  // Walk up to find any blockquote ancestor
  let bq = null;
  let cur = node;
  while (cur && cur !== area) {
    if (cur.tagName === 'BLOCKQUOTE') { bq = cur; break; }
    cur = cur.parentNode;
  }
  if (bq) {
    const p = document.createElement('p');
    Array.from(bq.childNodes).forEach(n => p.appendChild(n.cloneNode(true)));
    bq.replaceWith(p);
  } else {
    document.execCommand('formatBlock', false, 'blockquote');
  }
}

function toolbarLink() {
  saveSelection();
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
  const sel = window.getSelection();
  let existingUrl = '';
  if (sel && sel.rangeCount) {
    let node = sel.getRangeAt(0).commonAncestorContainer;
    while (node && node.tagName !== 'A') node = node.parentNode;
    if (node && node.tagName === 'A') existingUrl = node.href;
  }
  const popup = document.createElement('div');
  popup.className = 'toolbar-popup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#16213e;border:1px solid #e2b96f;border-radius:8px;padding:16px;z-index:200;min-width:300px;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
  popup.innerHTML = `
    <div style="font-size:0.85rem;color:#aaa;margin-bottom:8px">Insert / Edit Link</div>
    <input id="link-url-input" type="text" value="${existingUrl}" placeholder="https://..." style="width:100%;padding:7px;background:#0f3460;border:1px solid #0f3460;border-radius:4px;color:#e0e0e0;margin-bottom:8px;font-size:0.9rem"/>
    <div style="display:flex;gap:8px">
      <button onclick="applyLink()" style="flex:1;padding:6px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer">Apply</button>
      ${existingUrl ? `<button onclick="removeLink()" style="flex:1;padding:6px;border:1px solid #c44;background:transparent;color:#c44;border-radius:4px;cursor:pointer">Remove</button>` : ''}
      <button onclick="this.closest('.toolbar-popup').remove()" style="flex:1;padding:6px;border:1px solid #666;background:transparent;color:#aaa;border-radius:4px;cursor:pointer">Cancel</button>
    </div>`;
  document.body.appendChild(popup);
  setTimeout(() => document.getElementById('link-url-input')?.focus(), 50);
}

function applyLink() {
  const url = document.getElementById('link-url-input')?.value.trim();
  if (!url) return;
  restoreSelection();
  document.execCommand('createLink', false, url);
  // Set target="_blank" on all links in editor
  document.getElementById('editor-area')?.querySelectorAll('a').forEach(a => {
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  });
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
}

function removeLink() {
  restoreSelection();
  document.execCommand('unlink', false, null);
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
}

function toolbarTag() {
  saveSelection();
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());

  // Check if cursor is inside an existing tag span
  const sel = window.getSelection();
  let existingSpan = null;
  let existingTags = '';
  if (sel && sel.rangeCount) {
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    while (node && node !== document.getElementById('editor-area')) {
      if (node.classList && node.classList.contains('search-tag')) { existingSpan = node; break; }
      node = node.parentNode;
    }
    if (existingSpan) existingTags = existingSpan.dataset.tags || '';
  }

  const popup = document.createElement('div');
  popup.className = 'toolbar-popup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#16213e;border:1px solid #e2b96f;border-radius:8px;padding:16px;z-index:200;min-width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
  popup.innerHTML = `
    <div style="font-size:0.85rem;color:#aaa;margin-bottom:4px">Search Tags</div>
    <div style="font-size:0.75rem;color:#777;margin-bottom:8px">Separate multiple tags with commas. Multi-word tags are fine.</div>
    <input id="tag-input" type="text" value="${existingTags}" placeholder="e.g. fireball, magic missile" style="width:100%;padding:7px;background:#0f3460;border:1px solid #0f3460;border-radius:4px;color:#e0e0e0;margin-bottom:8px;font-size:0.9rem;box-sizing:border-box"/>
    <div style="display:flex;gap:8px">
      <button onclick="applyTag()" style="flex:1;padding:6px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer">Apply</button>
      ${existingSpan ? `<button onclick="removeTag()" style="flex:1;padding:6px;border:1px solid #c44;background:transparent;color:#c44;border-radius:4px;cursor:pointer">Remove</button>` : ''}
      <button onclick="this.closest('.toolbar-popup').remove()" style="flex:1;padding:6px;border:1px solid #666;background:transparent;color:#aaa;border-radius:4px;cursor:pointer">Cancel</button>
    </div>`;
  document.body.appendChild(popup);
  setTimeout(() => document.getElementById('tag-input')?.focus(), 50);
}

function applyTag() {
  const rawTags = document.getElementById('tag-input')?.value.trim();
  if (!rawTags) return;
  const tags = rawTags.split(',').map(t => t.trim()).filter(Boolean).join(',');
  restoreSelection();

  // If selection is collapsed (cursor only) check if we're inside existing span
  const sel = window.getSelection();
  let existingSpan = null;
  if (sel && sel.rangeCount) {
    let node = sel.getRangeAt(0).commonAncestorContainer;
    if (node.nodeType === 3) node = node.parentNode;
    while (node && node !== document.getElementById('editor-area')) {
      if (node.classList && node.classList.contains('search-tag')) { existingSpan = node; break; }
      node = node.parentNode;
    }
  }
  if (existingSpan) {
    existingSpan.dataset.tags = tags;
    document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
    return;
  }

  // Wrap selection in a search-tag span
  const range = sel.getRangeAt(0);
  const span = document.createElement('span');
  span.className = 'search-tag';
  span.dataset.tags = tags;
  try { range.surroundContents(span); }
  catch(e) {
    // Selection crosses element boundaries — extract and wrap
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
  }
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
}

function removeTag() {
  restoreSelection();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) { document.querySelectorAll('.toolbar-popup').forEach(p => p.remove()); return; }
  let node = sel.getRangeAt(0).commonAncestorContainer;
  if (node.nodeType === 3) node = node.parentNode;
  while (node && node !== document.getElementById('editor-area')) {
    if (node.classList && node.classList.contains('search-tag')) {
      const parent = node.parentNode;
      while (node.firstChild) parent.insertBefore(node.firstChild, node);
      parent.removeChild(node);
      break;
    }
    node = node.parentNode;
  }
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
}

function toolbarScrollBox() {
  const area = document.getElementById('editor-area');
  area.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const selected = range.extractContents();
  const isEmpty = !selected.textContent.trim() && !selected.querySelector('table,img');
  const box = document.createElement('div');
  box.className = 'scroll-box';
  box.style.cssText = 'max-width:100%;margin:10px 0;padding:2px 0;';
  if (isEmpty) {
    // Insert empty scroll box with placeholder table
    const table = document.createElement('table');
    table.className = 'editor-table';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.contentEditable = 'true';
    td.innerHTML = 'Paste or type wide content here';
    tr.appendChild(td);
    table.appendChild(tr);
    box.appendChild(table);
  } else {
    box.appendChild(selected);
  }
  range.insertNode(box);
  // Move cursor after box
  range.setStartAfter(box);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

function toolbarImage() {
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
  saveSelection();
  const popup = document.createElement('div');
  popup.className = 'toolbar-popup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#16213e;border:1px solid #e2b96f;border-radius:8px;padding:16px;z-index:200;min-width:320px;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
  popup.innerHTML = `
    <div style="font-size:0.85rem;color:#aaa;margin-bottom:10px">Insert Image</div>
    <div style="margin-bottom:10px">
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:4px">From URL:</div>
      <input id="img-url-input" type="text" placeholder="https://..." style="width:100%;padding:7px;background:#0f3460;border:1px solid #0f3460;border-radius:4px;color:#e0e0e0;font-size:0.9rem"/>
    </div>
    <div style="margin-bottom:10px">
      <div style="font-size:0.8rem;color:#aaa;margin-bottom:4px">Or upload from device:</div>
      <div id="img-drop-zone" style="border:2px dashed rgba(255,255,255,0.2);border-radius:6px;padding:18px 10px;text-align:center;color:#aaa;font-size:0.8rem;cursor:pointer;transition:border-color 0.15s,background 0.15s;margin-bottom:6px">
        Drop image here or <span style="color:#e2b96f;text-decoration:underline;cursor:pointer" onclick="document.getElementById('img-file-input').click()">browse</span>
        <div id="img-drop-filename" style="margin-top:6px;color:#e2b96f;font-size:0.75rem;min-height:14px"></div>
      </div>
      <input id="img-file-input" type="file" accept="image/*" style="display:none"/>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button onclick="applyImage()" style="flex:1;padding:6px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer">Insert</button>
      <button onclick="this.closest('.toolbar-popup').remove()" style="flex:1;padding:6px;border:1px solid #666;background:transparent;color:#aaa;border-radius:4px;cursor:pointer">Cancel</button>
    </div>`;

  // Wire up drag-and-drop after innerHTML is set
  const dropZone = popup.querySelector('#img-drop-zone');
  const fileInput = popup.querySelector('#img-file-input');
  const fileLabel = popup.querySelector('#img-drop-filename');

  const setFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    // Use DataTransfer to assign dropped file to the real file input
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileLabel.textContent = file.name;
    dropZone.style.borderColor = '#e2b96f';
    dropZone.style.background = 'rgba(226,185,111,0.06)';
  };

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '#e2b96f';
    dropZone.style.background = 'rgba(226,185,111,0.06)';
  });
  dropZone.addEventListener('dragleave', () => {
    if (!fileInput.files?.length) {
      dropZone.style.borderColor = 'rgba(255,255,255,0.2)';
      dropZone.style.background = '';
    }
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    setFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', (e) => {
    if (e.target.tagName !== 'SPAN') fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) setFile(fileInput.files[0]);
  });
  document.body.appendChild(popup);
}

async function applyImage() {
  const urlInput = document.getElementById('img-url-input')?.value.trim();
  const fileInput = document.getElementById('img-file-input');
  const file = fileInput?.files?.[0];

  if (urlInput) {
    restoreSelection();
    document.execCommand('insertHTML', false, `<img src="${urlInput}" style="max-width:100%;border-radius:6px;margin:10px 0"/>`);
    document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
    return;
  }

  if (file) {
    const originalSize = file.size;
    // Compress via canvas
    const compressed = await compressImage(file, 500 * 1024);
    console.log('file selected:', file.name, file.size);
    const filename = await promptImageName(file.name);
    console.log('filename returned:', filename);
    if (!filename) return;
    console.log('proceeding with upload...');
    const path = `data/images/${filename}`;
    const base64 = compressed.split(',')[1];
    const pat = getPAT();
    const headers = { Authorization: `token ${pat}`, 'Content-Type': 'application/json' };
    const existing = await fetch(`${GITHUB_API_ROOT}/${path}`, { headers });
    const sha = existing.ok ? (await existing.json()).sha : undefined;
    const res = await fetch(`${GITHUB_API_ROOT}/${path}`, {
      method: 'PUT', headers,
      body: JSON.stringify({ message: `Upload image: ${filename}`, content: base64, ...(sha && { sha }) })
    });
    console.log('Image upload status:', res.status, await res.text());
    if (!res.ok) { alert('Image upload failed.'); return; }
    const imgUrl = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/${path}`;
    const flagged = originalSize > 500 * 1024;
    // Store flagged image info
    if (flagged) {
      const flags = JSON.parse(localStorage.getItem('flagged_images') || '[]');
      flags.push({ filename, pageId: currentPageId, size: originalSize, url: imgUrl });
      localStorage.setItem('flagged_images', JSON.stringify(flags));
    }
    restoreSelection();
    document.execCommand('insertHTML', false, `<img src="${imgUrl}" data-filename="${filename}" data-size="${originalSize}" style="max-width:100%;border-radius:6px;margin:10px 0"${flagged ? ' data-flagged="true"' : ''}/>`);
    document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
  }
}

function compressImage(file, maxBytes) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        let quality = 0.85;
        const canvas = document.createElement('canvas');
        // Scale down if very large
        const maxDim = 1800;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        // Reduce quality until under maxBytes
        const tryCompress = (q) => {
          const data = canvas.toDataURL('image/jpeg', q);
          const size = Math.round((data.length - 22) * 3 / 4);
          if (size <= maxBytes || q <= 0.3) resolve(data);
          else tryCompress(Math.max(q - 0.1, 0.3));
        };
        tryCompress(quality);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function promptImageName(originalName) {
  return new Promise((resolve) => {
    document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
    const popup = document.createElement('div');
    popup.className = 'toolbar-popup';
    popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#16213e;border:1px solid #e2b96f;border-radius:8px;padding:16px;z-index:201;min-width:300px;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
    popup.innerHTML = `
      <div style="font-size:0.85rem;color:#aaa;margin-bottom:8px">Save image as:</div>
      <input id="img-name-input" type="text" value="${originalName}" style="width:100%;padding:7px;background:#0f3460;border:1px solid #0f3460;border-radius:4px;color:#e0e0e0;margin-bottom:8px;font-size:0.9rem"/>
      <div style="display:flex;gap:8px">
        <button id="img-name-confirm" style="flex:1;padding:6px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer">Upload</button>
        <button id="img-name-cancel" style="flex:1;padding:6px;border:1px solid #666;background:transparent;color:#aaa;border-radius:4px;cursor:pointer">Cancel</button>
      </div>`;
    document.body.appendChild(popup);
    setTimeout(() => {
      const inp = document.getElementById('img-name-input');
      if (inp) { inp.focus(); inp.select(); }
      document.getElementById('img-name-confirm').onclick = () => {
        const val = document.getElementById('img-name-input')?.value.trim();
        document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
        resolve(val);
      };
      document.getElementById('img-name-cancel').onclick = () => {
        document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
        resolve(null);
      };
    }, 50);
  });
}

// ── HTML Table sorting ────────────────────────────────────────────────────────
function sortHtmlTable(th) {
  // Only sort when viewing (not in editor contenteditable context actively)
  const table = th.closest('table');
  if (!table) return;
  const ths = Array.from(th.closest('tr').querySelectorAll('th'));
  const colIdx = ths.indexOf(th);
  const tbody = table.querySelector('tbody');
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const currentDir = th.dataset.sortDir || 'asc';
  const newDir = currentDir === 'asc' ? 'desc' : 'asc';
  // Reset all headers
  ths.forEach(h => { h.dataset.sortDir = ''; h.style.color = ''; });
  th.dataset.sortDir = newDir;
  th.style.color = '#e2b96f';
  rows.sort((a, b) => {
    const av = a.querySelectorAll('td')[colIdx]?.textContent.trim() || '';
    const bv = b.querySelectorAll('td')[colIdx]?.textContent.trim() || '';
    const an = parseFloat(av); const bn = parseFloat(bv);
    if (!isNaN(an) && !isNaN(bn)) return newDir === 'asc' ? an - bn : bn - an;
    return newDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
  rows.forEach(r => tbody.appendChild(r));
}

// ── Cell paste system ─────────────────────────────────────────────────────────
let activePasteCell = null;

function initScrollHints() {
  // Add right-edge gold fade to any horizontally scrollable container
  document.querySelectorAll('.scroll-box, .spell-table-scroll, .sticky-header-wrap').forEach(el => {
    // Only add if content actually overflows
    if (el.scrollWidth <= el.clientWidth) return;
    const hint = document.createElement('div');
    hint.className = 'scroll-hint-right';
    // Must be relative-positioned parent
    const pos = getComputedStyle(el).position;
    if (pos === 'static') el.style.position = 'relative';
    el.appendChild(hint);
    el.addEventListener('scroll', () => {
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      hint.style.opacity = atEnd ? '0' : '1';
    }, { passive: true });
  });
}

function initTableCellPaste() {
  // Attach click listeners to all editor-table cells
  const area = document.getElementById('editor-area');
  if (!area) return;
  area.addEventListener('click', (e) => {
    const cell = e.target.closest('td, th');
    if (!cell || !cell.closest('.editor-table')) {
      activePasteCell = null;
      return;
    }
    activePasteCell = cell;
  });
}

async function pasteIntoTable() {
  if (!activePasteCell) return;
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch {
    alert('Clipboard access denied. Try Ctrl/Cmd+V in a cell directly.');
    return;
  }
  if (!text.trim()) return;

  const table = activePasteCell.closest('table');
  if (!table) return;

  // Parse clipboard: rows split by newline, cells by tab
  const clipRows = text.trimEnd().split(/\r?\n/).map(r => r.split('\t'));

  // Find starting cell position
  const allRows = Array.from(table.querySelectorAll('tr'));
  const startRowIdx = allRows.indexOf(activePasteCell.closest('tr'));
  const startCells = Array.from(activePasteCell.closest('tr').querySelectorAll('td, th'));
  const startColIdx = startCells.indexOf(activePasteCell);

  clipRows.forEach((clipRow, ri) => {
    const targetRow = allRows[startRowIdx + ri];
    if (!targetRow) return;
    const targetCells = Array.from(targetRow.querySelectorAll('td, th'));
    clipRow.forEach((val, ci) => {
      const targetCell = targetCells[startColIdx + ci];
      if (!targetCell) return;
      targetCell.textContent = val;
    });
  });

  activePasteCell = null;
}

function toolbarClearFormat() {
  const area = document.getElementById('editor-area');
  area.focus();
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  document.execCommand('removeFormat', false, null);
  document.execCommand('unlink', false, null);
  // Only convert block if it's a heading — don't touch divs from pasted content
  const range = sel.getRangeAt(0);
  let block = range.startContainer;
  if (block.nodeType === 3) block = block.parentNode;
  // Walk up only through heading tags, stop at div or area boundary
  while (block && block !== area) {
    if (/^H[1-4]$/.test(block.tagName)) {
      const p = document.createElement('p');
      Array.from(block.childNodes).forEach(n => {
        if (!n.classList?.contains('h-badge')) p.appendChild(n.cloneNode(true));
      });
      block.replaceWith(p);
      return;
    }
    if (block.tagName === 'DIV' || block.tagName === 'SECTION') break;
    block = block.parentNode;
  }
}

function toolbarTable() {
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
  saveSelection();
  const popup = document.createElement('div');
  popup.className = 'toolbar-popup';
  popup.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#16213e;border:1px solid #e2b96f;border-radius:8px;padding:16px;z-index:200;min-width:260px;box-shadow:0 4px 16px rgba(0,0,0,0.5)';
  popup.innerHTML = `
    <div style="font-size:0.85rem;color:#aaa;margin-bottom:10px">Insert Table</div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">
      <input id="tbl-rows" type="number" value="3" min="1" max="20" style="width:60px;padding:6px;background:#0f3460;border:1px solid #0f3460;border-radius:4px;color:#e0e0e0"/> rows
      ×
      <input id="tbl-cols" type="number" value="3" min="1" max="10" style="width:60px;padding:6px;background:#0f3460;border:1px solid #0f3460;border-radius:4px;color:#e0e0e0"/> cols
    </div>
    <label style="font-size:0.8rem;display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <input type="checkbox" id="tbl-header" checked/> First row is header (sticky + sortable)
    </label>
    <label style="font-size:0.8rem;display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <input type="checkbox" id="tbl-sticky-col"/> First column sticky
    </label>
    <div style="display:flex;gap:8px">
      <button onclick="applyTable()" style="flex:1;padding:6px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer">Insert</button>
      <button onclick="this.closest('.toolbar-popup').remove()" style="flex:1;padding:6px;border:1px solid #666;background:transparent;color:#aaa;border-radius:4px;cursor:pointer">Cancel</button>
    </div>`;
  document.body.appendChild(popup);
}

function applyTable() {
  const rows = parseInt(document.getElementById('tbl-rows')?.value) || 3;
  const cols = parseInt(document.getElementById('tbl-cols')?.value) || 3;
  const hasHeader = document.getElementById('tbl-header')?.checked;
  const stickyCol = document.getElementById('tbl-sticky-col')?.checked;
  const classes = ['editor-table'].join(' ');
  const stickyAttrs = `${hasHeader ? 'data-sticky-header=""' : ''} ${stickyCol ? 'data-sticky-col=""' : ''}`.trim();
  let html = `<table class="${classes}" ${stickyAttrs}>`;
  if (hasHeader) {
    html += '<thead><tr>';
    for (let c = 0; c < cols; c++) {
      html += `<th contenteditable="true" onclick="sortHtmlTable(this)"><br/></th>`;
    }
    html += '</tr></thead>';
  }
  html += '<tbody>';
  for (let r = hasHeader ? 1 : 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      html += `<td contenteditable="true"><br/></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table><p><br/></p>';
  restoreSelection();
  document.execCommand('insertHTML', false, html);
  document.querySelectorAll('.toolbar-popup').forEach(p => p.remove());
}

function toggleColorPicker(mode) {
  const panel = document.getElementById('color-picker-panel');
  if (colorPickerMode === mode && !panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    colorPickerMode = null;
    return;
  }
  colorPickerMode = mode;
  saveSelection();
  const colors = PALETTE_COLORS;
  const label = 'Text Color';
  panel.innerHTML = `
    <div style="font-size:0.75rem;color:#aaa;margin-bottom:6px">${label}</div>
    <div class="color-swatches">
      ${colors.map(c => `<div class="color-swatch" style="background:${c};${c==='transparent'?'border:1px dashed #aaa':''}" onclick="applyColor('${c}')" title="${c}"></div>`).join('')}
    </div>
    <input type="color" id="free-color-picker" value="#ffffff" style="width:100%;height:28px;border:none;background:none;cursor:pointer;border-radius:4px" oninput="applyColor(this.value)"/>`;
  panel.classList.remove('hidden');
}

function applyColor(color) {
  restoreSelection();
  if (colorPickerMode === 'text') {
    document.execCommand('foreColor', false, color);
  } else {
    document.execCommand('hiliteColor', false, color === 'transparent' ? 'transparent' : color);
  }
}

// Show/hide toolbar when entering/leaving editor
function initEditor() {
  const area = document.getElementById('editor-area');
  if (!area) return;

  area.addEventListener('focus', () => {
    document.getElementById('editor-toolbar')?.classList.add('active');
  });
  area.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand(e.shiftKey ? 'outdent' : 'indent', false, null);
    }
    if (e.key === 'Escape') removeResizeHandle();
  });

  area.addEventListener('paste', (e) => {
    const strip = document.getElementById('strip-links-toggle').checked;
    if (!strip) return;
    e.preventDefault();
    const html = e.clipboardData.getData('text/html') || e.clipboardData.getData('text/plain');
    const div = document.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('a').forEach(a => {
      const text = document.createTextNode(a.textContent);
      a.replaceWith(text);
    });
    div.querySelectorAll('img').forEach(img => {
      let parent = img.parentElement;
      img.remove();
      while (parent && parent !== div) {
        const text = parent.textContent.replace(/\u00a0/g, '').trim();
        if (!text && !parent.querySelector('img,video,iframe,table')) {
          const next = parent.parentElement;
          parent.remove();
          parent = next;
        } else break;
      }
    });
    // Also remove any remaining empty block elements
    div.querySelectorAll('p,div,span').forEach(el => {
      const text = el.textContent.replace(/\u00a0/g, '').trim();
      if (!text && !el.querySelector('img,video,iframe,table,input')) el.remove();
    });
    document.execCommand('insertHTML', false, div.innerHTML);
  });

  area.addEventListener('input', refreshHeadingBadges);
  initTableCellPaste();
  area.addEventListener('paste', () => setTimeout(refreshHeadingBadges, 100));
  // Update heading dropdown on cursor move
  area.addEventListener('keyup', updateToolbarState);
  area.addEventListener('mouseup', updateToolbarState);
  // Image resize on click
  area.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG') initImageResize(e.target);
    if (e.target.classList.contains('dnd-table-block')) initTableBlockDrag(e.target);
    const cell = e.target.closest('td, th');
    if (cell) {
      showTableControls(cell);
      initTableColResize(cell.closest('table'));
    } else removeTableControls();
  });
}

function updateToolbarState() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let node = sel.getRangeAt(0).startContainer;
  while (node && node.id !== 'editor-area') {
    if (node.tagName && /^H[1-4]$/.test(node.tagName)) {
      document.getElementById('toolbar-heading').value = node.tagName.toLowerCase();
      return;
    }
    node = node.parentNode;
  }
  document.getElementById('toolbar-heading').value = 'p';
}

// ─── LARGE IMAGES VIEW ────────────────────────────────────────────────────────
function showView_dmImages() {
  document.getElementById('view-dm-images').classList.remove('hidden');
  renderLargeImages();
}

function renderLargeImages() {
  const list = document.getElementById('large-images-list');
  const flags = JSON.parse(localStorage.getItem('flagged_images') || '[]');
  if (!flags.length) { list.innerHTML = '<p style="color:#aaa">No flagged images.</p>'; return; }
  list.innerHTML = '';
  flags.forEach((img, i) => {
    const kb = Math.round(img.size / 1024);
    const row = document.createElement('div');
    row.style.cssText = 'background:#16213e;border:1px solid #c44;border-radius:6px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap';
    row.innerHTML = `
      <div>
        <div style="color:#e2b96f;font-size:0.85rem">${img.filename}</div>
        <div style="color:#aaa;font-size:0.75rem">${kb}KB · Page: ${pages[img.pageId]?.title || img.pageId}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button onclick="goToImageInEditor('${img.pageId}','${img.filename}')" style="padding:4px 10px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer;font-size:0.8rem">✏️ Edit</button>
        <button onclick="dismissFlaggedImage(${i})" style="padding:4px 10px;border:1px solid #666;background:transparent;color:#aaa;border-radius:4px;cursor:pointer;font-size:0.8rem">✕</button>
      </div>`;
    list.appendChild(row);
  });
}

function goToImageInEditor(pageId, filename) {
  showView('home');
  setTimeout(() => {
    editPageById(pageId);
    setTimeout(() => {
      const area = document.getElementById('editor-area');
      const img = area?.querySelector(`img[data-filename="${filename}"]`);
      if (img) img.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
  }, 100);
}

function editPageById(pageId) {
  if (!pages[pageId]) return;
  currentPageId = pageId;
  const page = pages[pageId];
  document.getElementById('view-home').classList.add('hidden');
  document.getElementById('view-page').classList.add('hidden');
  document.getElementById('view-dm-editor').classList.remove('hidden');
  document.getElementById('editor-title-label').textContent = 'Edit Page';
  document.getElementById('editor-page-id').value = pageId;
  document.getElementById('editor-page-id').disabled = true;
  document.getElementById('editor-page-title').value = page.title || '';
  document.getElementById('editor-thumb').value = page.thumbnail || '';
  document.getElementById('editor-description').value = page.description || '';
  document.getElementById('editor-toc-level').value = page.defaultTocLevel ?? 0;
  const cleanDiv = document.createElement('div');
  cleanDiv.innerHTML = page.content || '';
  cleanDiv.querySelectorAll('.h-badge').forEach(b => b.remove());
  document.getElementById('editor-area').innerHTML = cleanDiv.innerHTML;
  setTimeout(refreshHeadingBadges, 50);
}

function dismissFlaggedImage(index) {
  const flags = JSON.parse(localStorage.getItem('flagged_images') || '[]');
  flags.splice(index, 1);
  localStorage.setItem('flagged_images', JSON.stringify(flags));
  renderLargeImages();
}

// ─── IMAGE RESIZE ─────────────────────────────────────────────────────────────
function removeResizeHandle() {
  document.querySelectorAll('.img-resize-wrap').forEach(wrap => {
    const img = wrap.querySelector('img');
    if (img) wrap.replaceWith(img);
  });
}

function initImageResize(img) {
  // Don't double-wrap
  if (img.parentElement?.classList.contains('img-resize-wrap')) return;
  removeResizeHandle();

  const wrap = document.createElement('span');
  wrap.className = 'img-resize-wrap';
  wrap.style.cssText = 'display:inline-block;position:relative;line-height:0;';
  img.parentNode.insertBefore(wrap, img);
  wrap.appendChild(img);

  img.style.width = img.offsetWidth + 'px';
  img.style.height = 'auto';
  img.draggable = false;

  const handle = document.createElement('span');
  handle.className = 'img-resize-handle';
  handle.style.cssText = 'position:absolute;bottom:4px;right:4px;width:12px;height:12px;background:#e2b96f;border-radius:2px;cursor:se-resize;z-index:10;';
  wrap.appendChild(handle);

  let startX, startW;

  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    startX = e.clientX;
    startW = img.offsetWidth;

    const onMove = (e) => {
      const newW = Math.max(40, startW + (e.clientX - startX));
      img.style.width = newW + 'px';
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Touch support
  handle.addEventListener('touchstart', (e) => {
    e.preventDefault();
    startX = e.touches[0].clientX;
    startW = img.offsetWidth;

    const onMove = (e) => {
      const newW = Math.max(40, startW + (e.touches[0].clientX - startX));
      img.style.width = newW + 'px';
    };
    const onEnd = () => {
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
    };
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
  });

  // Click outside removes handle
  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!wrap.contains(e.target)) {
        removeResizeHandle();
        document.removeEventListener('click', handler);
      }
    });
  }, 50);
}

// ─── EDITOR TABLE CONTROLS ────────────────────────────────────────────────────
function removeTableControls() {
  document.querySelectorAll('.table-ctrl-bar').forEach(b => b.remove());
}

function showTableControls(cell) {
  removeTableControls();
  const table = cell.closest('table');
  if (!table || !table.closest('#editor-area')) return;

  const ctrl = document.createElement('div');
  ctrl.id = 'table-controls';
  ctrl.style.cssText = 'position:fixed;z-index:300;background:rgba(20,21,21,0.97);border:1px solid rgba(226,185,111,0.4);border-radius:8px;padding:8px;display:flex;flex-wrap:wrap;gap:6px;box-shadow:0 4px 16px rgba(0,0,0,0.6);max-width:calc(100vw - 24px);';

  const btn = (label, title, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'background:transparent;border:1px solid rgba(255,255,255,0.15);color:#e0e0e0;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:0.75rem;font-family:Roboto,sans-serif;white-space:nowrap;transition:border-color 0.15s,background 0.15s';
    b.onmouseenter = () => { b.style.borderColor = '#e2b96f'; b.style.background = 'rgba(226,185,111,0.1)'; };
    b.onmouseleave = () => { b.style.borderColor = 'rgba(255,255,255,0.15)'; b.style.background = 'transparent'; };
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  };

  const rows = table.querySelectorAll('tr');
  const rowIdx = Array.from(rows).indexOf(cell.closest('tr'));
  const cells = Array.from(cell.closest('tr').querySelectorAll('td,th'));
  const colIdx = cells.indexOf(cell);

  ctrl.appendChild(btn('+ Row Above', 'Insert row above', () => insertRow(table, rowIdx, 'before')));
  ctrl.appendChild(btn('+ Row Below', 'Insert row below', () => insertRow(table, rowIdx, 'after')));
  ctrl.appendChild(btn('− Row', 'Delete this row', () => deleteRow(table, rowIdx)));
  ctrl.appendChild(btn('+ Col Left', 'Insert column left', () => insertCol(table, colIdx, 'before')));
  ctrl.appendChild(btn('+ Col Right', 'Insert column right', () => insertCol(table, colIdx, 'after')));
  ctrl.appendChild(btn('− Col', 'Delete this column', () => deleteCol(table, colIdx)));
  const hasStickyHeader = table.hasAttribute('data-sticky-header');
  const hasStickyCol = table.hasAttribute('data-sticky-col');
  ctrl.appendChild(btn(`${hasStickyHeader ? '✓' : '○'} Sticky Header`, 'Toggle sticky first row', () => {
    if (hasStickyHeader) {
      table.removeAttribute('data-sticky-header');
    } else {
      table.setAttribute('data-sticky-header', '');
      // Promote first row to thead if missing
      const tbody = table.querySelector('tbody');
      if (tbody && !table.querySelector('thead')) {
        const firstRow = tbody.querySelector('tr');
        if (firstRow) {
          const thead = document.createElement('thead');
          thead.appendChild(firstRow);
          table.insertBefore(thead, tbody);
          thead.querySelectorAll('td').forEach(td => {
            const th = document.createElement('th');
            th.innerHTML = td.innerHTML;
            th.contentEditable = 'true';
            td.replaceWith(th);
          });
        }
      }
    }
    removeTableControls();
    showTableControls(cell);
  }));
  ctrl.appendChild(btn(`${hasStickyCol ? '✓' : '○'} Sticky Col`, 'Toggle sticky first column', () => {
    if (hasStickyCol) table.removeAttribute('data-sticky-col');
    else table.setAttribute('data-sticky-col', '');
    removeTableControls();
    showTableControls(cell);
  }));

  // Paste button — separate, gold tinted
  const pasteBtn = document.createElement('button');
  pasteBtn.textContent = '⎘ Paste here';
  pasteBtn.title = 'Paste clipboard content starting from this cell';
  pasteBtn.style.cssText = 'background:rgba(211,154,57,0.12);border:1px solid rgba(226,185,111,0.5);color:#e2b96f;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:0.75rem;font-family:Roboto,sans-serif;white-space:nowrap;transition:border-color 0.15s,background 0.15s';
  pasteBtn.onmouseenter = () => { pasteBtn.style.background = 'rgba(211,154,57,0.25)'; };
  pasteBtn.onmouseleave = () => { pasteBtn.style.background = 'rgba(211,154,57,0.12)'; };
  pasteBtn.onclick = (e) => { e.stopPropagation(); activePasteCell = cell; pasteIntoTable(); };
  ctrl.appendChild(pasteBtn);

  document.body.appendChild(ctrl);

  // Position: below cell, clamped to viewport
  const rect = cell.getBoundingClientRect();
  const ctrlH = 80; // estimated height before render
  let top = rect.bottom + 6;
  if (top + ctrlH > window.innerHeight - 8) top = rect.top - ctrlH - 6;
  top = Math.max(8, top);

  const ctrlW = 400; // estimated width
  let left = rect.left;
  if (left + ctrlW > window.innerWidth - 8) left = window.innerWidth - ctrlW - 8;
  left = Math.max(8, left);

  ctrl.style.top = top + 'px';
  ctrl.style.left = left + 'px';

  // Reposition after actual render
  requestAnimationFrame(() => {
    const actualW = ctrl.offsetWidth;
    const actualH = ctrl.offsetHeight;
    let t = rect.bottom + 6;
    if (t + actualH > window.innerHeight - 8) t = rect.top - actualH - 6;
    ctrl.style.top = Math.max(8, t) + 'px';
    let l = rect.left;
    if (l + actualW > window.innerWidth - 8) l = window.innerWidth - actualW - 8;
    ctrl.style.left = Math.max(8, l) + 'px';
  });
}

function removeTableControls() {
  document.getElementById('table-controls')?.remove();
}

function insertRow(table, rowIdx, position) {
  const rows = table.querySelectorAll('tr');
  const refRow = rows[rowIdx];
  if (!refRow) return;
  const colCount = refRow.querySelectorAll('td,th').length;
  const newRow = document.createElement('tr');
  for (let i = 0; i < colCount; i++) {
    const td = document.createElement('td');
    td.contentEditable = 'true';
    td.innerHTML = '<br/>';
    newRow.appendChild(td);
  }
  if (position === 'before') refRow.parentNode.insertBefore(newRow, refRow);
  else refRow.parentNode.insertBefore(newRow, refRow.nextSibling);
  removeTableControls();
}

function deleteRow(table, rowIdx) {
  const rows = table.querySelectorAll('tr');
  if (rows.length <= 1) return;
  rows[rowIdx]?.remove();
  removeTableControls();
}

function insertCol(table, colIdx, position) {
  table.querySelectorAll('tr').forEach(row => {
    const cells = row.querySelectorAll('td,th');
    const refCell = cells[colIdx];
    if (!refCell) return;
    const isHeader = refCell.tagName === 'TH';
    const newCell = document.createElement(isHeader ? 'th' : 'td');
    newCell.contentEditable = 'true';
    newCell.innerHTML = '<br/>';
    if (isHeader) newCell.onclick = () => sortHtmlTable(newCell);
    if (position === 'before') refCell.parentNode.insertBefore(newCell, refCell);
    else refCell.parentNode.insertBefore(newCell, refCell.nextSibling);
  });
  removeTableControls();
}

function deleteCol(table, colIdx) {
  let canDelete = true;
  table.querySelectorAll('tr').forEach(row => {
    if (row.querySelectorAll('td,th').length <= 1) canDelete = false;
  });
  if (!canDelete) return;
  table.querySelectorAll('tr').forEach(row => {
    row.querySelectorAll('td,th')[colIdx]?.remove();
  });
  removeTableControls();
}

// ─── TABLE COLUMN RESIZE ──────────────────────────────────────────────────────
function initTableColResize(table) {
  table.querySelectorAll('th, td').forEach(cell => {
    if (cell.querySelector('.col-resize-handle')) return;
    const handle = document.createElement('span');
    handle.className = 'col-resize-handle';
    handle.style.cssText = 'position:absolute;top:0;right:0;width:5px;height:100%;cursor:col-resize;background:transparent;z-index:5;';
    cell.style.position = 'relative';
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = cell.offsetWidth;
      const onMove = (e) => {
        const newW = Math.max(30, startW + (e.clientX - startX));
        cell.style.width = newW + 'px';
        cell.style.minWidth = newW + 'px';
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    cell.appendChild(handle);
  });
}

// ─── TABLE BLOCK DRAG IN EDITOR ───────────────────────────────────────────────
function initTableBlockDrag(block) {
  block.draggable = true;
  block.style.cursor = 'grab';

  block.addEventListener('dragstart', (e) => {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'table-block');
    block.style.opacity = '0.4';
    window._draggingTableBlock = block;
  }, { once: false });

  block.addEventListener('dragend', () => {
    block.style.opacity = '';
    block.style.cursor = 'grab';
    window._draggingTableBlock = null;
  });
}

document.addEventListener('dragover', (e) => {
  if (!window._draggingTableBlock) return;
  e.preventDefault();
});

document.addEventListener('drop', (e) => {
  const block = window._draggingTableBlock;
  if (!block) return;
  e.preventDefault();
  const area = document.getElementById('editor-area');
  if (!area) return;
  // Find nearest block-level element at drop point
  const range = document.caretRangeFromPoint?.(e.clientX, e.clientY);
  if (!range) return;
  let target = range.startContainer;
  if (target.nodeType === 3) target = target.parentNode;
  while (target && target.parentNode !== area) target = target.parentNode;
  if (!target || target === block) return;
  area.insertBefore(block, target.nextSibling);
  window._draggingTableBlock = null;
});

// ─── populateGroupDropdown ───────────────────────────────────────────────
function populateGroupDropdown(currentGroup) {
  const sel = document.getElementById('editor-group');
  if (!sel) return;
  // Collect all existing group names
  const groups = [...new Set(Object.values(pages).map(p => p.group).filter(Boolean))];
  sel.innerHTML = '<option value="">— No group —</option>';
  groups.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = g;
    if (g === currentGroup) opt.selected = true;
    sel.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ New group...';
  sel.appendChild(newOpt);
  if (currentGroup && !groups.includes(currentGroup)) {
    const opt = document.createElement('option');
    opt.value = currentGroup;
    opt.textContent = currentGroup;
    opt.selected = true;
    sel.insertBefore(opt, newOpt);
  }
  // Show/hide new group input
  sel.onchange = () => {
    const newInput = document.getElementById('editor-group-new-wrap');
    if (newInput) newInput.style.display = sel.value === '__new__' ? 'block' : 'none';
  };
}

// ─── GROUP HELPERS ────────────────────────────────────────────────────────────
function getGroupPages(group) {
  if (!group) return [];
  return Object.keys(pages)
    .filter(id => pages[id].group === group)
    .sort((a, b) => {
      const allIds = Object.keys(pages);
      return allIds.indexOf(a) - allIds.indexOf(b);
    });
}

function getGroupFirstPage(group) {
  return getGroupPages(group)[0] || null;
}

function isFirstInGroup(pageId) {
  const group = pages[pageId]?.group;
  if (!group) return false;
  return getGroupFirstPage(group) === pageId;
}
