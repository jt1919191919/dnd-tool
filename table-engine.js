// Default visible columns (first 7 = no horizontal scroll)
const DEFAULT_VISIBLE = ['Name','Level','Casting Time','School','_concentration','_ritual','Range'];

// Popup fields hidden by default
const DEFAULT_POPUP_HIDDEN = ['Classes', 'Optional/Variant Classes', 'Subclasses'];

// Column definitions - order matters for default display
const SPELL_COLUMNS = [
  { key: 'Name',        label: 'Name',   minWidth: '120px', alwaysShow: false },
  { key: 'Level',       label: 'Lvl',    minWidth: '36px',  sortKey: '_levelNum' },
  { key: 'Casting Time',label: 'Time',   minWidth: '60px'  },
  { key: 'School',      label: 'School', minWidth: '80px'  },
  { key: '_concentration', label: 'C',   minWidth: '24px'  },
  { key: '_ritual',     label: 'R',      minWidth: '24px'  },
  { key: 'Range',       label: 'Range',  minWidth: '70px'  },
  { key: 'Source',      label: 'Src',    minWidth: '40px'  },
  { key: '_durationClean', label: 'Duration', minWidth: '80px' },
  { key: 'Components',  label: 'Comp',   minWidth: '80px'  },
  { key: 'Classes',     label: 'Classes', minWidth: '120px' },
  { key: 'Optional/Variant Classes', label: 'Variants', minWidth: '120px' },
  { key: 'Subclasses',  label: 'Subclasses', minWidth: '120px' },
  { key: 'Text',        label: 'Text',   minWidth: '200px' },
  { key: 'At Higher Levels', label: 'Higher', minWidth: '120px' },
];

// ─── TABLE ENGINE ─────────────────────────────────────────────────────────────

function getTableAPI() { return `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/tables`; }

// Parse CSV string into array of objects
function parseCSV(text) {
  const lines = [];
  let current = '';
  let inQuotes = false;
  const chars = text.split('');
  const rows = [];
  let fields = [];

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === '"') {
      if (inQuotes && chars[i+1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      fields.push(current); current = '';
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && chars[i+1] === '\n') i++;
      fields.push(current); current = '';
      if (fields.some(f => f.trim())) rows.push(fields);
      fields = [];
    } else {
      current += c;
    }
  }
  if (current || fields.length) { fields.push(current); if (fields.some(f=>f.trim())) rows.push(fields); }

  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (row[i] || '').trim(); });
    return obj;
  });
}

// Process raw spell row into display-ready object
function processSpellRow(row) {
  const duration = row['Duration'] || '';
  const school = row['School'] || '';
  const isConcentration = duration.toLowerCase().includes('concentration');
  const isRitual = school.toLowerCase().includes('ritual');
  const level = row['Level'] || '';
  const levelNum = level.toLowerCase() === 'cantrip' ? 0 : parseInt(level) || 0;

  return {
    ...row,
    _concentration: isConcentration ? '✓' : '',
    _ritual: isRitual ? '✓' : '',
    _levelNum: levelNum,
    _durationClean: duration.replace(/concentration,?\s*/i, '').replace(/^up to /i, '').trim(),
    'School': school.replace(/\s*\(ritual\)/i, '').trim(),
  };
}

async function loadTableData(tableId) {
  const pat = typeof getPAT === 'function' ? getPAT() : '';
  const headers = pat ? { Authorization: `token ${pat}` } : {};
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/tables/${tableId}.json?_=${Date.now()}`, { headers });
    if (!res.ok) return null;
    const json = await res.json();
    return JSON.parse(decodeURIComponent(escape(atob(json.content))));
  } catch { return null; }
}

async function saveTableData(tableId, data) {
  const pat = typeof getPAT === 'function' ? getPAT() : '';
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
  const headers = { Authorization: `token ${pat}`, 'Content-Type': 'application/json' };
  try {
    const existing = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/tables/${tableId}.json`, { headers });
    const sha = existing.ok ? (await existing.json()).sha : undefined;
    const res = await fetch(`https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}/contents/data/tables/${tableId}.json`, {
      method: 'PUT', headers,
      body: JSON.stringify({ message: `Save table: ${tableId}`, content: encoded, ...(sha && { sha }) })
    });
    return res.ok;
  } catch { return false; }
}

// Render a table block from its data-table-id
async function renderTableBlock(container, tableId, isDM) {
  container.innerHTML = '<div style="color:#aaa;padding:16px">Loading table...</div>';
  const tableData = await loadTableData(tableId);
  if (!tableData) { container.innerHTML = '<div style="color:#c44;padding:16px">Table not found: ' + tableId + '</div>'; return; }

  const rows = tableData.rows.map(processSpellRow);
  const config = tableData.config || {};
  const visibleCols = config.visibleCols || DEFAULT_VISIBLE;
  const popupHiddenCols = config.popupHiddenCols || DEFAULT_POPUP_HIDDEN;
  const defaultSort = config.defaultSort || 'Name';
  const defaultSortDir = config.defaultSortDir || 'asc';

  renderTable(container, tableId, rows, visibleCols, defaultSort, defaultSortDir, isDM, config);
}

function renderTable(container, tableId, rows, visibleCols, sortCol, sortDir, isDM, config) {
  const sortedRows = sortRows(rows, sortCol, sortDir);
  const cols = SPELL_COLUMNS.filter(c => visibleCols.includes(c.key));
  const extraCols = SPELL_COLUMNS.filter(c => !visibleCols.includes(c.key));

  let html = `<div class="spell-table-wrap" id="tbl-${tableId}">`;

  // Toolbar
  html += `<div class="spell-table-toolbar">
    <input type="text" class="spell-search" placeholder="Filter spells..." oninput="filterTable('${tableId}', this.value)" style="flex:1;padding:6px 10px;background:#0f3460;border:1px solid #0f3460;border-radius:6px;color:#e0e0e0;font-size:0.85rem"/>
    <button class="tbl-btn" onclick="toggleColPanel('${tableId}')">Columns</button>
    ${isDM ? `<button class="tbl-btn" onclick="openTableConfig('${tableId}')">⚙️</button>` : ''}
  </div>`;

  // Column toggle panel
  html += `<div id="col-panel-${tableId}" class="col-panel hidden">
    ${SPELL_COLUMNS.map(c => `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:0.8rem">
      <input type="checkbox" ${visibleCols.includes(c.key) ? 'checked' : ''} onchange="toggleCol('${tableId}','${c.key}',this.checked)"/> ${c.label}
    </label>`).join('')}
  </div>`;

  // Table
  html += `<div class="spell-table-scroll"><table class="spell-table" id="spell-table-${tableId}">
    <thead><tr>`;
  cols.forEach(c => {
    const sortKey = c.sortKey || c.key;
    const arrow = sortCol === c.key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
    html += `<th onclick="sortTable('${tableId}','${c.key}')" style="min-width:${c.minWidth||'60px'}">${c.label}${arrow}</th>`;
  });
  html += `</tr></thead><tbody>`;

  sortedRows.forEach((row, i) => {
    html += `<tr class="spell-row" onclick="openSpellPopup(event,'${tableId}',${i})" data-idx="${i}">`;
    cols.forEach(c => {
      const val = row[c.key] || '';
      html += `<td title="${val.toString().replace(/"/g,"'")}">${val}</td>`;
    });
    html += `</tr>`;
  });

  html += `</tbody></table></div></div>`;
  container.innerHTML = html;

  // Store rows on element for filtering/sorting
  container.querySelector(`#tbl-${tableId}`).__rows = rows;
  container.querySelector(`#tbl-${tableId}`).__config = { visibleCols, sortCol, sortDir, tableId };
}

function sortRows(rows, col, dir) {
  return [...rows].sort((a, b) => {
    const sortKey = SPELL_COLUMNS.find(c => c.key === col)?.sortKey || col;
    let av = a[sortKey] ?? a[col] ?? '';
    let bv = b[sortKey] ?? b[col] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return dir === 'asc' ? av - bv : bv - av;
    av = av.toString().toLowerCase();
    bv = bv.toString().toLowerCase();
    return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

function sortTable(tableId, col) {
  const wrap = document.getElementById(`tbl-${tableId}`);
  if (!wrap) return;
  const cfg = wrap.__config;
  const newDir = cfg.sortCol === col && cfg.sortDir === 'asc' ? 'desc' : 'asc';
  cfg.sortCol = col; cfg.sortDir = newDir;
  const container = wrap.parentElement;
  renderTable(container, tableId, wrap.__rows, cfg.visibleCols, col, newDir, typeof currentPlayer !== 'undefined' && currentPlayer.isDM, cfg);
}

function filterTable(tableId, query) {
  const wrap = document.getElementById(`tbl-${tableId}`);
  if (!wrap) return;
  const q = query.toLowerCase();
  const rows = wrap.querySelector('tbody').querySelectorAll('tr');
  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(q) ? '' : 'none';
  });
}

function toggleColPanel(tableId) {
  document.getElementById(`col-panel-${tableId}`)?.classList.toggle('hidden');
}

function toggleCol(tableId, colKey, show) {
  const wrap = document.getElementById(`tbl-${tableId}`);
  if (!wrap) return;
  const cfg = wrap.__config;
  if (show && !cfg.visibleCols.includes(colKey)) cfg.visibleCols.push(colKey);
  else if (!show) cfg.visibleCols = cfg.visibleCols.filter(k => k !== colKey);
  const container = wrap.parentElement;
  renderTable(container, tableId, wrap.__rows, cfg.visibleCols, cfg.sortCol, cfg.sortDir, typeof currentPlayer !== 'undefined' && currentPlayer.isDM, cfg);
}

function openSpellPopup(e, tableId, idx) {
  const wrap = document.getElementById(`tbl-${tableId}`);
  if (!wrap) return;
  const row = wrap.__rows[idx];
  if (!row) return;
  const tableCfg = wrap.__config || {};
  const popupHidden = tableCfg.popupHiddenCols || DEFAULT_POPUP_HIDDEN;
  const showField = (key) => !popupHidden.includes(key);

  document.querySelectorAll('.spell-popup-overlay').forEach(p => p.remove());

  const overlay = document.createElement('div');
  overlay.className = 'spell-popup-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const popup = document.createElement('div');
  popup.className = 'spell-popup';

  const level = row['Level'] || '';
  const school = row['School'] || '';
  const concentration = row['_concentration'] ? ' • Concentration' : '';
  const ritual = row['_ritual'] ? ' • Ritual' : '';

  popup.innerHTML = `
    <button class="spell-popup-close" onclick="this.closest('.spell-popup-overlay').remove()">✕</button>
    <h2 class="spell-popup-title">${row['Name'] || ''}</h2>
    <div class="spell-popup-meta">${level} ${school}${concentration}${ritual}</div>
    <div class="spell-popup-grid">
      <div><strong>Casting Time</strong><span>${row['Casting Time'] || ''}</span></div>
      <div><strong>Range</strong><span>${row['Range'] || ''}</span></div>
      <div><strong>Duration</strong><span>${row['_durationClean'] || ''}</span></div>
      <div><strong>Components</strong><span>${row['Components'] || ''}</span></div>
      ${(showField('Classes') && row['Classes']) ? `<div class="spell-popup-full"><strong>Classes</strong><span>${row['Classes']}</span></div>` : ''}
      ${(showField('Optional/Variant Classes') && row['Optional/Variant Classes']) ? `<div class="spell-popup-full"><strong>Variant Classes</strong><span>${row['Optional/Variant Classes']}</span></div>` : ''}
      ${(showField('Subclasses') && row['Subclasses']) ? `<div class="spell-popup-full"><strong>Subclasses</strong><span>${row['Subclasses']}</span></div>` : ''}
    </div>
    ${showField('Text') ? `<div class="spell-popup-text">${(row['Text'] || '').replace(/\n/g, '<br/>')}</div>` : ''}
    ${(showField('At Higher Levels') && row['At Higher Levels']) ? `<div class="spell-popup-higher"><strong>At Higher Levels:</strong> ${row['At Higher Levels']}</div>` : ''}
  `;

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

// DM config panel for table defaults
async function openTableConfig(tableId) {
  document.querySelectorAll('.table-config-overlay').forEach(p => p.remove());
  const tableData = await loadTableData(tableId);
  if (!tableData) return;
  const config = tableData.config || {};

  const overlay = document.createElement('div');
  overlay.className = 'spell-popup-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const popup = document.createElement('div');
  popup.className = 'spell-popup table-config-overlay';
  popup.innerHTML = `
    <button class="spell-popup-close" onclick="this.closest('.spell-popup-overlay').remove()">✕</button>
    <h2 style="color:#e2b96f;margin-bottom:12px">Table Settings: ${tableId}</h2>
    <label style="display:block;margin-bottom:8px;font-size:0.85rem">Default sort column:
      <select id="cfg-sort-${tableId}" style="margin-left:8px;background:#0f3460;color:#e0e0e0;border:1px solid #0f3460;border-radius:4px;padding:3px 8px">
        ${SPELL_COLUMNS.map(c => `<option value="${c.key}" ${config.defaultSort === c.key ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
    </label>
    <label style="display:block;margin-bottom:8px;font-size:0.85rem">Default sort direction:
      <select id="cfg-dir-${tableId}" style="margin-left:8px;background:#0f3460;color:#e0e0e0;border:1px solid #0f3460;border-radius:4px;padding:3px 8px">
        <option value="asc" ${config.defaultSortDir !== 'desc' ? 'selected' : ''}>Ascending</option>
        <option value="desc" ${config.defaultSortDir === 'desc' ? 'selected' : ''}>Descending</option>
      </select>
    </label>
    <h3 style="color:#e2b96f;margin:12px 0 8px;font-size:0.9rem">Default visible columns:</h3>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      ${SPELL_COLUMNS.map(c => `<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem">
        <input type="checkbox" id="cfg-col-${tableId}-${c.key.replace(/[^a-z0-9]/gi,'_')}" ${(config.visibleCols || DEFAULT_VISIBLE).includes(c.key) ? 'checked' : ''}/> ${c.label}
      </label>`).join('')}
    </div>
    <h3 style="color:#e2b96f;margin:12px 0 8px;font-size:0.9rem">Popup visible fields:</h3>
    <p style="color:#aaa;font-size:0.75rem;margin-bottom:8px">Uncheck to hide fields in the spell detail popup.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      ${(() => {
        const hiddenList = config.popupHiddenCols || DEFAULT_POPUP_HIDDEN;
        return SPELL_COLUMNS.filter(c => !['Name','Level','School','_concentration','_ritual'].includes(c.key)).map(c => {
          const checked = !hiddenList.includes(c.key);
          const safeKey = c.key.replace(/[^a-z0-9]/gi,'_');
          return '<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem"><input type="checkbox" id="cfg-popup-' + tableId + '-' + safeKey + '" ' + (checked ? 'checked' : '') + '/> ' + c.label + '</label>';
        }).join('');
      })()}
    </div>
    <button onclick="saveTableConfig('${tableId}')" style="padding:8px 16px;border:1px solid #e2b96f;background:transparent;color:#e2b96f;border-radius:6px;cursor:pointer">💾 Save Defaults</button>
  `;

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}

async function saveTableConfig(tableId) {
  const tableData = await loadTableData(tableId);
  if (!tableData) return;

  const sortCol = document.getElementById(`cfg-sort-${tableId}`)?.value;
  const sortDir = document.getElementById(`cfg-dir-${tableId}`)?.value;
  const visibleCols = SPELL_COLUMNS
    .filter(c => document.getElementById(`cfg-col-${tableId}-${c.key.replace(/[^a-z0-9]/gi,'_')}`)?.checked)
    .map(c => c.key);

  const popupHiddenCols = SPELL_COLUMNS
    .filter(c => !['Name','Level','School','_concentration','_ritual'].includes(c.key))
    .filter(c => !document.getElementById(`cfg-popup-${tableId}-${c.key.replace(/[^a-z0-9]/gi,'_')}`)?.checked)
    .map(c => c.key);

  tableData.config = { defaultSort: sortCol, defaultSortDir: sortDir, visibleCols, popupHiddenCols };
  const ok = await saveTableData(tableId, tableData);
  if (ok) {
    alert('Table config saved!');
    document.querySelectorAll('.spell-popup-overlay').forEach(p => p.remove());
    // Re-render all instances of this table
    document.querySelectorAll(`[data-table-id="${tableId}"]`).forEach(el => {
      renderTableBlock(el, tableId, currentPlayer?.isDM);
    });
  }
}

// Called when rendering a page - finds all table blocks and renders them
async function renderAllTableBlocks(isDM) {
  const blocks = document.querySelectorAll('#page-content .dnd-table-block');
  for (const block of blocks) {
    const tableId = block.dataset.tableId;
    if (tableId) await renderTableBlock(block, tableId, isDM);
  }
}

// Get next available table ID
async function getNextTableId() {
  const pat = typeof getPAT === 'function' ? getPAT() : '';
  const headers = pat ? { Authorization: `token ${pat}` } : {};
  try {
    const res = await fetch(`${getTableAPI()}?_=${Date.now()}`, { headers });
    if (!res.ok) return 'table-1';
    const files = await res.json();
    const nums = files
      .map(f => f.name.replace('table-','').replace('.json',''))
      .map(n => parseInt(n))
      .filter(n => !isNaN(n));
    const next = nums.length ? Math.max(...nums) + 1 : 1;
    return `table-${next}`;
  } catch { return 'table-1'; }
}

// Insert table block into editor
async function insertTableFromCSV() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const rows = parseCSV(text);
    if (!rows.length) { alert('Could not parse CSV.'); return; }

    const tableId = await getNextTableId();
    const tableData = {
      id: tableId,
      name: file.name.replace('.csv',''),
      rows,
      config: {
        visibleCols: DEFAULT_VISIBLE,
        defaultSort: 'Name',
        defaultSortDir: 'asc'
      }
    };

    const ok = await saveTableData(tableId, tableData);
    if (!ok) { alert('Failed to save table data.'); return; }

    // Insert placeholder into editor
    const area = document.getElementById('editor-area');
    const placeholder = `<div class="dnd-table-block" data-table-id="${tableId}" contenteditable="false" style="background:#0f3460;border:1px solid #e2b96f;border-radius:6px;padding:12px;margin:10px 0;color:#e2b96f;font-size:0.85rem">📊 Table: ${tableData.name} (${rows.length} rows) — ID: ${tableId}</div>`;
    document.execCommand('insertHTML', false, placeholder);
    alert(`Table "${tableId}" saved! It will render fully when you view the page.`);
  };
  input.click();
}
