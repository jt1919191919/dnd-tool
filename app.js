// ─── CONFIG ───────────────────────────────────────────────────────────────────
// Set your GitHub username and repo name here
const GITHUB_USER = 'jt1919191919';
const GITHUB_REPO = 'dnd-tool';
const RAW_BASE = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/main/data`;
const GITHUB_API = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data`;
const GITHUB_API_ROOT = `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents`;

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
  document.getElementById('loading-screen').style.display = 'none';
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

window.addEventListener('scroll', () => {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  btn.style.display = window.scrollY > 300 ? 'flex' : 'none';
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
  if (pageId && pages[pageId] && canSee(pageId)) {
    navigateTo(pageId);
  } else {
    showView('home');
  }
  // Build spell search index from all table blocks in visible pages
  await buildSpellIndex();
}

// ─── SPELL INDEX ──────────────────────────────────────────────────────────────
let spellIndex = []; // [{ name, pageId, pageTitle, tableId, nearestHeading }]

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
  } else if (view === 'dm-editor') {
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

  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = page.content || '';
  tempDiv.querySelectorAll('.h-badge').forEach(b => b.remove());
  const pageHeader = page.description
    ? `<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08)"><h1 style="font-family:'Times New Roman',serif;color:#ffffff;font-size:28px;margin-bottom:6px">${page.title}</h1><p style="color:#888;font-size:0.85rem;margin:0">${page.description}</p></div>`
    : `<div style="margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid rgba(255,255,255,0.08)"><h1 style="font-family:'Times New Roman',serif;color:#ffffff;font-size:28px;margin:0">${page.title}</h1></div>`;
  document.getElementById('page-content').innerHTML = pageHeader + tempDiv.innerHTML;
  window.scrollTo(0, 0);
  renderAllTableBlocks(currentPlayer.isDM);
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

  if (!headings.length) {
    document.getElementById('page-outline-wrap').style.display = 'none';
    return;
  }

  // Assign IDs
  headings.forEach((h, i) => { h.id = `heading-${i}`; });

  // Level filter dropdown
  const levels = [...new Set(headings.map(h => parseInt(h.tagName[1])))].sort();
  const filterWrap = document.createElement('div');
  filterWrap.style.marginBottom = '8px';
  filterWrap.innerHTML = `<select id="toc-level-filter" style="background:rgba(255,255,255,0.06);color:#e0e0e0;border:1px solid rgba(255,255,255,0.12);border-radius:4px;padding:3px 8px;font-size:0.8rem">
    <option value="0">Show top level only</option>
    ${levels.map(l => `<option value="${l}">Expand through H${l}</option>`).join('')}
  </select>`;
  outline.appendChild(filterWrap);

  // Build nested structure
  const tree = buildTocTree(headings);
  const listEl = document.createElement('div');
  listEl.id = 'toc-tree';
  renderTocTree(listEl, tree, true);
  outline.appendChild(listEl);

  // Filter change handler
  document.getElementById('toc-level-filter').addEventListener('change', function() {
    applyTocFilter(parseInt(this.value));
  });

  document.getElementById('page-outline-wrap').style.display = '';
}

function buildTocTree(headings) {
  const root = [];
  const stack = [];
  headings.forEach((h, i) => {
    const level = parseInt(h.tagName[1]);
    const node = { id: `heading-${i}`, text: h.textContent.replace('🔗','').trim(), level, children: [] };
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
    a.style.cssText = 'color:#e2b96f;text-decoration:none;font-size:0.85rem;';
    a.onclick = (e) => { e.preventDefault(); scrollToHeading(node.id); };
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
  const ids = getPageOrder().filter(id => canSee(id));
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
    resultsWrap.classList.add('hidden');
    cards.classList.remove('hidden');
    if (currentPageId) {
      document.getElementById('view-home').classList.add('hidden');
      document.getElementById('view-page').classList.remove('hidden');
    }
    return;
  }

  document.getElementById('view-page').classList.add('hidden');
  document.getElementById('view-dm-editor').classList.add('hidden');
  document.getElementById('view-dm-config').classList.add('hidden');
  document.getElementById('view-home').classList.remove('hidden');
  cards.classList.add('hidden');
  resultsWrap.classList.remove('hidden');
  resultsList.innerHTML = '';

  const q = query.toLowerCase();
  // Group results by pageId
  const groups = {}; // { pageId: { title, items: [] } }

  const addResult = (pageId, pageTitle, itemHtml, onClickFn) => {
    if (!groups[pageId]) groups[pageId] = { title: pageTitle, items: [] };
    groups[pageId].items.push({ itemHtml, onClickFn });
  };

  // ── Page content search ──────────────────────────────────────────
  for (const [id, page] of Object.entries(pages)) {
    if (!canSee(id)) continue;
    const titleMatch = page.title?.toLowerCase().includes(q);
    const contentText = stripHTML(page.content || '');
    const descMatch = page.description?.toLowerCase().includes(q);

    if (titleMatch || descMatch) {
      addResult(id, page.title, `
        <div class="search-result-title">${highlightMatch(page.title, query)}</div>
        <div class="search-result-snippet">${highlightMatch(page.description || '', query)}</div>`,
        () => { clearSearch(); navigateTo(id); });
    }

    // Find ALL content matches, not just first
    if (contentText.toLowerCase().includes(q)) {
      const div = document.createElement('div');
      div.innerHTML = page.content || '';
      div.querySelectorAll('.h-badge').forEach(b => b.remove());

      // Walk through all text nodes finding matches
      const allHeadings = Array.from(div.querySelectorAll('h1,h2,h3,h4'));
      let lastHeading = null;
      const seenHeadings = new Set();

      const walkNode = (node) => {
        if (node.nodeType === 1 && /^H[1-4]$/.test(node.tagName)) {
          lastHeading = node;
        }
        if (node.nodeType === 3 && node.textContent.toLowerCase().includes(q)) {
          const headingText = lastHeading ? lastHeading.textContent.replace('🔗','').trim() : null;
          const headingKey = headingText || '__top__';
          if (!seenHeadings.has(headingKey)) {
            seenHeadings.add(headingKey);
            const snippet = getSnippet(node.textContent, query);
            const headingIdx = lastHeading ? allHeadings.indexOf(lastHeading) : -1;
            const capturedHeading = lastHeading;
            addResult(id, page.title, `
              <div class="search-result-title">${highlightMatch(page.title, query)}</div>
              ${headingText ? `<div class="search-result-heading">Under: ${headingText}</div>` : ''}
              <div class="search-result-snippet">${highlightMatch(snippet, query)}</div>`,
              () => {
                clearSearch();
                navigateTo(id);
                if (capturedHeading) {
                  const hText = capturedHeading.textContent.replace('🔗','').trim();
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
        }
        for (const child of node.childNodes) walkNode(child);
      };
      walkNode(div);
    }
  }

  // ── Spell/Monster table search ───────────────────────────────────
  const spellMatches = spellIndex.filter(s => s.allText && s.allText.includes(q));
  for (const spell of spellMatches) {
    const resultIcon = spell.tableType === 'monster' ? '🐉' : '🔮';
    let snippet = '';
    if (spell.cells) {
      for (const [k, v] of Object.entries(spell.cells)) {
        if (k === 'Name') continue;
        if (v.toLowerCase().includes(q)) {
          snippet = `<em>${k}:</em> ${highlightMatch(getSnippet(v, query), query)}`;
          break;
        }
      }
    }
    addResult(spell.pageId, spell.pageTitle, `
      <div class="search-result-title">${resultIcon} ${highlightMatch(spell.name, query)}</div>
      ${spell.nearestHeading ? `<div class="search-result-heading">${spell.nearestHeading}</div>` : ''}
      ${snippet ? `<div class="search-result-snippet">${snippet}</div>` : ''}`,
      () => {
        clearSearch();
        navigateTo(spell.pageId);
      const waitForTable = (attempts) => {
        const wrap = document.getElementById(`tbl-${spell.tableId}`);
        if (wrap && wrap.__rows) {
          navigateToSpellRow(spell.tableId, spell.name);
        } else if (attempts > 0) {
          setTimeout(() => waitForTable(attempts - 1), 200);
        }
      };
      setTimeout(() => waitForTable(20), 300);
      });
  }

  // ── Render grouped results ───────────────────────────────────────
  if (!Object.keys(groups).length) {
    resultsList.innerHTML = '<p style="color:#aaa;padding:10px">No results found.</p>';
    return;
  }

  for (const [pageId, group] of Object.entries(groups)) {
    const isMulti = group.items.length > 1;
    const folder = document.createElement('div');
    folder.style.cssText = 'margin-bottom:8px;';

    if (isMulti) {
      // Folder header
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
      let open = group.items.length <= 3;
      children.style.display = open ? '' : 'none';
      header.querySelector('.folder-caret').textContent = open ? '▾' : '▸';
      header.onclick = () => {
        open = !open;
        children.style.display = open ? '' : 'none';
        header.querySelector('.folder-caret').textContent = open ? '▾' : '▸';
      };
      folder.appendChild(header);
      folder.appendChild(children);
    } else {
      // Single result — show directly
      const { itemHtml, onClickFn } = group.items[0];
      const item = document.createElement('div');
      item.className = 'search-result-item';
      item.innerHTML = itemHtml;
      item.onclick = onClickFn;
      folder.appendChild(item);
    }

    resultsList.appendChild(folder);
  }
}

function clearSearch() {
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
  document.getElementById('editor-page-id').disabled = false;
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
  const cleanDiv = document.createElement('div');
  cleanDiv.innerHTML = page.content || '';
  cleanDiv.querySelectorAll('.h-badge').forEach(b => b.remove());
  document.getElementById('editor-area').innerHTML = cleanDiv.innerHTML;
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
  const isNew = !pages[id];
  const pageData = {
    id, title,
    thumbnail: document.getElementById('editor-thumb').value.trim(),
    description: document.getElementById('editor-description').value.trim(),
    content: (() => { const d = document.createElement('div'); d.innerHTML = document.getElementById('editor-area').innerHTML; d.querySelectorAll('.h-badge').forEach(b => b.remove()); return d.innerHTML; })(),
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
  alert('Saved to GitHub!');
  if (currentPageId) {
    document.getElementById('view-dm-editor').classList.add('hidden');
    navigateTo(currentPageId);
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
  pages[currentPageId].visibleTo = Array.from(checkboxes).filter(c=>c.checked).map(c=>c.value);
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
  const headers = {
    ...(pat ? { Authorization: `token ${pat}` } : {}),
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  };
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/${path}?_=${Date.now()}`, { headers });
    if (!res.ok) return null;
    const json = await res.json();
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

// ─── Manage Tables DM Config ────────────────────────────────────────────────────────────
async function renderManageTables() {
  const list = document.getElementById('tables-list');
  list.innerHTML = '<p style="color:#aaa">Loading...</p>';

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
  document.execCommand(cmd, false, null);
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
      <input id="img-file-input" type="file" accept="image/*" style="font-size:0.8rem;color:#aaa"/>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button onclick="applyImage()" style="flex:1;padding:6px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:4px;cursor:pointer">Insert</button>
      <button onclick="this.closest('.toolbar-popup').remove()" style="flex:1;padding:6px;border:1px solid #666;background:transparent;color:#aaa;border-radius:4px;cursor:pointer">Cancel</button>
    </div>`;
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
    <label style="font-size:0.8rem;display:flex;align-items:center;gap:6px;margin-bottom:10px">
      <input type="checkbox" id="tbl-header" checked/> First row is header
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
  let html = '<table class="editor-table"><tbody>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) {
      const tag = (r === 0 && hasHeader) ? 'th' : 'td';
      html += `<${tag} contenteditable="true"><br/></${tag}>`;
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
      // Walk up removing empty ancestors
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
  if (!table) return;

  const bar = document.createElement('div');
  bar.className = 'table-ctrl-bar';
  bar.style.cssText = 'position:fixed;background:#16213e;border:1px solid #e2b96f;border-radius:6px;padding:4px 8px;display:flex;gap:6px;z-index:200;box-shadow:0 2px 8px rgba(0,0,0,0.5);font-size:0.8rem;';

  const rect = cell.getBoundingClientRect();
  bar.style.top = `${rect.top - 40}px`;
  bar.style.left = `${rect.left}px`;

  const btn = (label, title, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'background:transparent;border:1px solid #0f3460;color:#e0e0e0;border-radius:4px;padding:2px 7px;cursor:pointer;font-size:0.8rem;white-space:nowrap;';
    b.onmouseenter = () => b.style.borderColor = '#e2b96f';
    b.onmouseleave = () => b.style.borderColor = '#0f3460';
    b.onclick = (e) => { e.stopPropagation(); fn(table, cell); };
    return b;
  };

  bar.appendChild(btn('+Row↓', 'Add row below', (t, c) => {
    const row = c.closest('tr');
    const newRow = document.createElement('tr');
    const cols = row.querySelectorAll('td,th').length;
    for (let i = 0; i < cols; i++) {
      const td = document.createElement('td');
      td.style.cssText = 'border:1px solid #4a5568;padding:6px 10px;min-width:60px';
      td.contentEditable = 'true';
      td.innerHTML = '<br/>';
      newRow.appendChild(td);
    }
    row.parentNode.insertBefore(newRow, row.nextSibling);
    removeTableControls();
  }));

  bar.appendChild(btn('+Col→', 'Add column right', (t, c) => {
    const row = c.closest('tr');
    const colIdx = Array.from(row.querySelectorAll('td,th')).indexOf(c);
    Array.from(t.querySelectorAll('tr')).forEach((r, ri) => {
      const cells = r.querySelectorAll('td,th');
      const tag = ri === 0 && cells[0]?.tagName === 'TH' ? 'th' : 'td';
      const newCell = document.createElement(tag);
      newCell.style.cssText = tag === 'th'
        ? 'border:1px solid #4a5568;padding:6px 10px;min-width:60px;background:#0f3460;color:#e2b96f'
        : 'border:1px solid #4a5568;padding:6px 10px;min-width:60px';
      newCell.contentEditable = 'true';
      newCell.innerHTML = '<br/>';
      const ref = cells[colIdx + 1];
      r.insertBefore(newCell, ref || null);
    });
    removeTableControls();
  }));

  bar.appendChild(btn('-Row', 'Delete this row', (t, c) => {
    const row = c.closest('tr');
    if (t.querySelectorAll('tr').length <= 1) { t.remove(); removeTableControls(); return; }
    row.remove();
    removeTableControls();
  }));

  bar.appendChild(btn('-Col', 'Delete this column', (t, c) => {
    const row = c.closest('tr');
    const colIdx = Array.from(row.querySelectorAll('td,th')).indexOf(c);
    const allRows = t.querySelectorAll('tr');
    if (allRows[0].querySelectorAll('td,th').length <= 1) { t.remove(); removeTableControls(); return; }
    allRows.forEach(r => {
      const cells = r.querySelectorAll('td,th');
      if (cells[colIdx]) cells[colIdx].remove();
    });
    removeTableControls();
  }));

  document.body.appendChild(bar);

  setTimeout(() => {
    document.addEventListener('click', function handler(e) {
      if (!bar.contains(e.target) && !e.target.closest('td,th')) {
        removeTableControls();
        document.removeEventListener('click', handler);
      }
    });
  }, 50);
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
