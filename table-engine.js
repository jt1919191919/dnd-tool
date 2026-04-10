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

const MONSTER_COLUMNS = [
  { key: 'Name',        label: 'Name',        minWidth: '120px' },
  { key: 'CR',          label: 'CR',          minWidth: '40px', sortKey: '_crNum' },
  { key: 'Type',        label: 'Type',        minWidth: '80px'  },
  { key: 'Size',        label: 'Size',        minWidth: '60px'  },
  { key: 'AC',          label: 'AC',          minWidth: '40px'  },
  { key: 'HP',          label: 'HP',          minWidth: '60px'  },
  { key: 'Speed',       label: 'Speed',       minWidth: '80px'  },
  { key: 'Alignment',   label: 'Alignment',   minWidth: '80px'  },
  { key: 'Source',      label: 'Src',         minWidth: '40px'  },
  { key: 'Page',        label: 'Pg',          minWidth: '30px'  },
  { key: 'Strength',    label: 'STR',         minWidth: '36px'  },
  { key: 'Dexterity',   label: 'DEX',         minWidth: '36px'  },
  { key: 'Constitution',label: 'CON',         minWidth: '36px'  },
  { key: 'Intelligence',label: 'INT',         minWidth: '36px'  },
  { key: 'Wisdom',      label: 'WIS',         minWidth: '36px'  },
  { key: 'Charisma',    label: 'CHA',         minWidth: '36px'  },
  { key: 'Saving Throws',   label: 'Proficient Saves',   minWidth: '100px' },
  { key: 'Skills',          label: 'Proficient Skills',  minWidth: '100px' },
  { key: 'Damage Vulnerabilities', label: 'Vuln', minWidth: '80px' },
  { key: 'Damage Resistances',     label: 'Res',  minWidth: '80px' },
  { key: 'Damage Immunities',      label: 'Imm',  minWidth: '80px' },
  { key: 'Condition Immunities',   label: 'Condition Immunities', minWidth: '120px' },
  { key: 'Senses',      label: 'Senses',      minWidth: '100px' },
  { key: 'Languages',   label: 'Languages',   minWidth: '100px' },
  { key: 'Traits',      label: 'Traits',      minWidth: '200px' },
  { key: 'Actions',     label: 'Actions',     minWidth: '200px' },
  { key: 'Bonus Actions',   label: 'Bonus',   minWidth: '120px' },
  { key: 'Reactions',       label: 'Reactions', minWidth: '120px' },
  { key: 'Legendary Actions', label: 'Legendary', minWidth: '120px' },
  { key: 'Mythic Actions',    label: 'Mythic',    minWidth: '120px' },
  { key: 'Lair Actions',      label: 'Lair',      minWidth: '120px' },
  { key: 'Regional Effects',  label: 'Regional',  minWidth: '120px' },
  { key: 'Environment', label: 'Environment', minWidth: '100px' },
  { key: 'Treasure',    label: 'Treasure',    minWidth: '100px' },
];

const DEFAULT_MONSTER_VISIBLE = ['Name','CR','Type','Size','AC','HP','Speed'];
const DEFAULT_MONSTER_POPUP_HIDDEN = ['Source','Page','Alignment','Legendary Actions','Mythic Actions','Lair Actions','Regional Effects','Environment','Treasure'];

// ─── tableType detection helper ─────────────────────────────────────────────────────────────

function getTableColumns(tableType) {
  return tableType === 'monster' ? MONSTER_COLUMNS : SPELL_COLUMNS;
}
function getDefaultVisible(tableType) {
  return tableType === 'monster' ? DEFAULT_MONSTER_VISIBLE : DEFAULT_VISIBLE;
}
function getDefaultPopupHidden(tableType) {
  return tableType === 'monster' ? DEFAULT_MONSTER_POPUP_HIDDEN : DEFAULT_POPUP_HIDDEN;
}

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

  const popupHiddenCols = config.popupHiddenCols || DEFAULT_POPUP_HIDDEN;
  const tableType = tableData.tableType || 'spell';
  const rows = tableType === 'monster' ? tableData.rows : tableData.rows.map(processSpellRow);
  const tblConfig = tableData.config || {};
  const visibleCols = tblConfig.visibleCols || getDefaultVisible(tableType);
  const defaultSort = tblConfig.defaultSort || 'Name';
  const defaultSortDir = tblConfig.defaultSortDir || 'asc';

  renderTable(container, tableId, rows, visibleCols, defaultSort, defaultSortDir, isDM, tblConfig, tableType);
}

function renderTable(container, tableId, rows, visibleCols, sortCol, sortDir, isDM, config, tableType) {
  tableType = tableType || config?.tableType || 'spell';
  const COLS = getTableColumns(tableType);
  const sortedRows = sortRows(rows, sortCol, sortDir);
  const cols = COLS.filter(c => visibleCols.includes(c.key));

  const displayName = config?.displayName || tableId;
  let html = `<div class="spell-table-wrap" id="tbl-${tableId}">`;

  // Toolbar
  html += `<div class="spell-table-toolbar">
    <input type="text" class="spell-search" placeholder="Filter ${config?.tableType === 'monster' ? 'monsters' : 'spells'}..." oninput="filterTable('${tableId}', this.value)" style="flex:1;padding:6px 10px;background:#0f3460;border:1px solid #0f3460;border-radius:6px;color:#e0e0e0;font-size:0.85rem"/>
    <button class="tbl-btn" onclick="toggleColPanel('${tableId}')">Columns</button>
    ${isDM ? `<button class="tbl-btn" onclick="openTableConfig('${tableId}')">⚙️</button>` : ''}
  </div>`;

// Column toggle panel
  html += `<div id="col-panel-${tableId}" class="col-panel hidden">
    ${COLS.map(c => `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:0.8rem">
      <input type="checkbox" ${visibleCols.includes(c.key) ? 'checked' : ''} onchange="toggleCol('${tableId}','${c.key}',this.checked)" onclick="event.stopPropagation()"/> ${c.label}
    </label>`).join('')}
  </div>`;

  // Table
  html += `<div class="spell-table-scroll" style="overflow:auto;max-height:600px"><table class="spell-table" id="spell-table-${tableId}">
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
  container.querySelector(`#tbl-${tableId}`).__config = { visibleCols, sortCol, sortDir, tableId, tableType, popupHiddenCols: config?.popupHiddenCols || getDefaultPopupHidden(tableType) };
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
  renderTable(container, tableId, wrap.__rows, cfg.visibleCols, col, newDir, typeof currentPlayer !== 'undefined' && currentPlayer.isDM, cfg, cfg.tableType);
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
  renderTable(container, tableId, wrap.__rows, cfg.visibleCols, cfg.sortCol, cfg.sortDir, typeof currentPlayer !== 'undefined' && currentPlayer.isDM, cfg, cfg.tableType);
  document.getElementById(`col-panel-${tableId}`)?.classList.remove('hidden');
}

function openSpellPopup(e, tableId, idx) {
  const wrap = document.getElementById(`tbl-${tableId}`);
  if (!wrap) return;
  const row = wrap.__rows[idx];
  if (!row) return;
  const tableCfg = wrap.__config || {};
  const popupHidden = tableCfg.popupHiddenCols || DEFAULT_POPUP_HIDDEN;
  const showField = (key) => !popupHidden.includes(key);
  const tableType = tableCfg.tableType || 'spell';
  if (tableType === 'monster') { openMonsterPopup(row, showField); return; }

  document.querySelectorAll('.spell-popup-overlay').forEach(p => p.remove());

  const overlay = document.createElement('div');
  overlay.className = 'spell-popup-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const popup = document.createElement('div');
  popup.className = 'spell-popup';

  const level = row['Level'] || '';
  const school = row['School'] || '';
  const levelLabel = level.toLowerCase() === 'cantrip' ? 'Cantrip' : `${level} Level`;
  const ritual = row['_ritual'] ? ' • Ritual' : '';
  const durationDisplay = (row['_concentration']
    ? `<span style="color:#e2b96f;font-weight:bold">Concentration</span>, up to ${row['_durationClean']}`
    : row['_durationClean'] || '');

  popup.innerHTML = `
    <button class="spell-popup-close" onclick="this.closest('.spell-popup-overlay').remove()">✕</button>
    <h2 class="spell-popup-title">${row['Name'] || ''}</h2>
    <div class="spell-popup-meta">${levelLabel} ${school}${ritual}</div>
    <div class="spell-popup-grid">
      <div><strong>Casting Time</strong><span>${row['Casting Time'] || ''}</span></div>
      <div><strong>Range</strong><span>${row['Range'] || ''}</span></div>
      <div><strong>Duration</strong><span>${durationDisplay}</span></div>
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
  const wrap = document.getElementById(`tbl-${tableId}`);
  if (!wrap) return;
  const config = wrap.__config || {};

  const overlay = document.createElement('div');
  overlay.className = 'spell-popup-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const popup = document.createElement('div');
  popup.className = 'spell-popup table-config-overlay';
  popup.innerHTML = `
    <button class="spell-popup-close" onclick="this.closest('.spell-popup-overlay').remove()">✕</button>
    <h2 style="color:#e2b96f;margin-bottom:12px">${config.tableType === 'monster' ? '🐉' : '📊'} Table Settings</h2>
    <label style="display:block;margin-bottom:12px;font-size:0.85rem">Display name:
      <input id="cfg-name-${tableId}" type="text" value="${config.displayName || tableId}" style="margin-left:8px;background:#0f3460;color:#e0e0e0;border:1px solid #0f3460;border-radius:4px;padding:3px 8px;width:60%"/>
    </label>
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
      ${getTableColumns(config.tableType || 'spell').map(c => '<label style="display:flex;align-items:center;gap:4px;font-size:0.8rem"><input type="checkbox" id="cfg-col-' + tableId + '-' + c.key.replace(/[^a-z0-9]/gi,'_') + '" ' + ((config.visibleCols || getDefaultVisible(config.tableType || 'spell')).includes(c.key) ? 'checked' : '') + '/> ' + c.label + '</label>').join('')}
    </div>
    <h3 style="color:#e2b96f;margin:12px 0 8px;font-size:0.9rem">Popup visible fields:</h3>
    <p style="color:#aaa;font-size:0.75rem;margin-bottom:8px">Uncheck to hide fields in the spell detail popup.</p>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
      ${(() => {
        const tType = config.tableType || 'spell';
        const hiddenList = config.popupHiddenCols || getDefaultPopupHidden(tType);
        const excludeFromToggle = tType === 'monster' ? ['Name'] : ['Name','Level','School','_concentration','_ritual'];
        return getTableColumns(tType).filter(c => !excludeFromToggle.includes(c.key)).map(c => {
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
  const wrap = document.getElementById(`tbl-${tableId}`);
  if (!wrap) return;
  const tableData = { id: tableId, rows: wrap.__rows.map(r => { const clean = {...r}; delete clean._concentration; delete clean._ritual; delete clean._levelNum; delete clean._durationClean; return clean; }) };

  const sortCol = document.getElementById(`cfg-sort-${tableId}`)?.value;
  const sortDir = document.getElementById(`cfg-dir-${tableId}`)?.value;
  const tType = wrap.__config?.tableType || 'spell';
  const COLS = getTableColumns(tType);
  const excludeFromToggle = tType === 'monster' ? ['Name'] : ['Name','Level','School','_concentration','_ritual'];
  const visibleCols = COLS
    .filter(c => document.getElementById(`cfg-col-${tableId}-${c.key.replace(/[^a-z0-9]/gi,'_')}`)?.checked)
    .map(c => c.key);
  const popupHiddenCols = COLS
    .filter(c => !excludeFromToggle.includes(c.key))
    .filter(c => !document.getElementById(`cfg-popup-${tableId}-${c.key.replace(/[^a-z0-9]/gi,'_')}`)?.checked)
    .map(c => c.key);

  console.log('popupHiddenCols:', popupHiddenCols);
  console.log('Classes checkbox:', document.getElementById(`cfg-popup-${tableId}-Classes`)?.checked);
  
  const displayName = document.getElementById(`cfg-name-${tableId}`)?.value.trim() || tableId;
  tableData.config = { defaultSort: sortCol, defaultSortDir: sortDir, visibleCols, popupHiddenCols, tableType: tType, displayName };
  const ok = await saveTableData(tableId, tableData);
  if (ok) wrap.__config = tableData.config;
  if (ok) {
    alert('Table config saved!');
    document.querySelectorAll('.spell-popup-overlay').forEach(p => p.remove());
    // Re-render all instances of this table
    document.querySelectorAll(`[data-table-id="${tableId}"]`).forEach(el => {
      const rows = wrap.__rows;
      renderTable(el, tableId, rows, tableData.config.visibleCols, tableData.config.defaultSort, tableData.config.defaultSortDir, currentPlayer?.isDM, tableData.config);
      const newWrap = document.getElementById(`tbl-${tableId}`);
      if (newWrap) newWrap.__config = tableData.config;
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
async function insertTableFromCSV(tableType) {
  tableType = tableType || 'spell';
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
      tableType,
      rows,
      config: {
        visibleCols: getDefaultVisible(tableType),
        defaultSort: 'Name',
        defaultSortDir: 'asc',
        tableType
      }
    };

    const ok = await saveTableData(tableId, tableData);
    if (!ok) { alert('Failed to save table data.'); return; }

    const icon = tableType === 'monster' ? '🐉' : '📊';
    const label = tableType === 'monster' ? 'Monster Table' : 'Spell Table';
    const area = document.getElementById('editor-area');
    const placeholder = `<div class="dnd-table-block" data-table-id="${tableId}" data-table-type="${tableType}" contenteditable="false" style="background:#0f3460;border:1px solid #e2b96f;border-radius:6px;padding:12px;margin:10px 0;color:#e2b96f;font-size:0.85rem">${icon} ${label}: ${tableData.name} (${rows.length} rows) — ID: ${tableId}</div>`;
    document.execCommand('insertHTML', false, placeholder);
    alert(`${label} "${tableId}" saved!`);
  };
  input.click();
}

// Called from search results to highlight and open a spell by name
function navigateToSpellRow(tableId, spellName) {
  const wrap = document.getElementById(`tbl-${tableId}`);
  if (!wrap) {
    // Table not yet rendered - try again shortly
    setTimeout(() => navigateToSpellRow(tableId, spellName), 150);
    return;
  }
  const rows = wrap.__rows;
  if (!rows) return;
  const idx = rows.findIndex(r => (r['Name'] || '').toLowerCase() === spellName.toLowerCase());
  if (idx === -1) return;

  // Find the <tr> for this row
  const tbody = wrap.querySelector('tbody');
  const trs = tbody ? Array.from(tbody.querySelectorAll('tr[data-idx]')) : [];
  const targetTr = trs.find(tr => parseInt(tr.dataset.idx) === idx);
  if (targetTr) {
    targetTr.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Flash highlight
    targetTr.style.outline = '2px solid #e2b96f';
    setTimeout(() => { targetTr.style.outline = ''; }, 2000);
    // Open popup
    setTimeout(() => openSpellPopup(null, tableId, idx), 300);
  }
}

function openMonsterPopup(row, showField) {
  document.querySelectorAll('.spell-popup-overlay').forEach(p => p.remove());

  // ── Helpers ──────────────────────────────────────────────────────
  const abilityMod = (score) => Math.floor((parseInt(score) || 10) - 10) / 2 | 0;
  const fmtMod = (n) => (n >= 0 ? '+' : '') + n;

  // Parse PB from CR string e.g. "1/4 (XP 50; PB +2)"
  const crRaw = row['CR'] || '';
  const pbMatch = crRaw.match(/PB\s*([+-]\d+)/i);
  const pb = pbMatch ? parseInt(pbMatch[1]) : 2;
  const crDisplay = crRaw.split(' ')[0];

  // Parse proficient saves e.g. "Str +5, Dex +3"
  const savesRaw = (row['Saving Throws'] || '').toLowerCase();
  const profSaveMap = {};
  savesRaw.split(',').forEach(s => {
    const m = s.trim().match(/^(\w+)\s*([+-]\d+)/);
    if (m) profSaveMap[m[1].toLowerCase()] = parseInt(m[2]);
  });

  // Parse proficient skills e.g. "Perception +4, Stealth +6"
  const skillsRaw = (row['Skills'] || '').toLowerCase();
  const profSkillMap = {};
  skillsRaw.split(',').forEach(s => {
    const m = s.trim().match(/^([\w\s]+?)\s*([+-]\d+)$/);
    if (m) profSkillMap[m[1].trim()] = parseInt(m[2]);
  });

  // All 6 abilities
  const abilities = [
    { key: 'Strength',     short: 'STR', saveAbbr: 'str' },
    { key: 'Dexterity',    short: 'DEX', saveAbbr: 'dex' },
    { key: 'Constitution', short: 'CON', saveAbbr: 'con' },
    { key: 'Intelligence', short: 'INT', saveAbbr: 'int' },
    { key: 'Wisdom',       short: 'WIS', saveAbbr: 'wis' },
    { key: 'Charisma',     short: 'CHA', saveAbbr: 'cha' },
  ];

  // All 18 skills mapped to ability
  const ALL_SKILLS = [
    { name: 'Acrobatics',       ability: 'Dexterity' },
    { name: 'Animal Handling',  ability: 'Wisdom' },
    { name: 'Arcana',           ability: 'Intelligence' },
    { name: 'Athletics',        ability: 'Strength' },
    { name: 'Deception',        ability: 'Charisma' },
    { name: 'History',          ability: 'Intelligence' },
    { name: 'Insight',          ability: 'Wisdom' },
    { name: 'Intimidation',     ability: 'Charisma' },
    { name: 'Investigation',    ability: 'Intelligence' },
    { name: 'Medicine',         ability: 'Wisdom' },
    { name: 'Nature',           ability: 'Intelligence' },
    { name: 'Perception',       ability: 'Wisdom' },
    { name: 'Performance',      ability: 'Charisma' },
    { name: 'Persuasion',       ability: 'Charisma' },
    { name: 'Religion',         ability: 'Intelligence' },
    { name: 'Sleight of Hand',  ability: 'Dexterity' },
    { name: 'Stealth',          ability: 'Dexterity' },
    { name: 'Survival',         ability: 'Wisdom' },
  ];

  // Initiative from DEX
  const dexMod = abilityMod(row['Dexterity']);
  const initiative = fmtMod(dexMod);

  // Bold name in trait/action text (format: "Name. description" or "Name: description")
  const formatEntries = (text) => {
    if (!text) return '';
    return text.split('\n').filter(l => l.trim()).map(line => {
      const formatted = line.replace(/^([^.:\n]+[.:])\s*/, '<strong>$1</strong> ');
      return `<div style="padding:6px 0;border-bottom:1px solid #0f3460;font-size:0.82rem;line-height:1.6">${formatted}</div>`;
    }).join('');
  };

  const sectionBlock = (key, label) => {
    if (!showField(key) || !row[key]) return '';
    return `<div style="margin-bottom:12px">
      <div style="color:#e2b96f;font-weight:bold;font-size:0.85rem;margin-bottom:4px">${label}</div>
      ${formatEntries(row[key])}
    </div>`;
  };

  const inlineBlock = (key, label) => {
    if (!showField(key) || !row[key]) return '';
    return `<div class="spell-popup-full"><strong>${label}</strong><span>${row[key]}</span></div>`;
  };

  // Ability score + mod/save row
  const abilityBoxes = abilities.map(a => {
    const score = parseInt(row[a.key]) || 10;
    const mod = abilityMod(score);
    const isProfSave = a.saveAbbr in profSaveMap;
    const saveVal = isProfSave ? profSaveMap[a.saveAbbr] : mod;
    const saveStyle = isProfSave ? 'color:#e2b96f;font-weight:bold' : 'color:#e0e0e0';
    return `<div style="background:#0f3460;border-radius:6px;padding:6px 4px;text-align:center">
      <strong style="color:#e2b96f;font-size:0.65rem;display:block">${a.short}</strong>
      <span style="font-size:0.95rem;display:block">${score}</span>
      <span style="font-size:0.75rem;display:block;color:#aaa">${fmtMod(mod)}</span>
      <span style="font-size:0.72rem;display:block;${saveStyle}" title="Save">${fmtMod(saveVal)}</span>
    </div>`;
  }).join('');

  // Skills grid
  const skillBoxes = ALL_SKILLS.map(sk => {
    const mod = abilityMod(row[sk.ability]);
    const key = sk.name.toLowerCase();
    const isProfSkill = key in profSkillMap;
    const val = isProfSkill ? profSkillMap[key] : mod;
    const style = isProfSkill ? 'color:#e2b96f;font-weight:bold' : 'color:#aaa';
    return `<div style="display:flex;justify-content:space-between;padding:2px 6px;font-size:0.75rem;border-bottom:1px solid rgba(15,52,96,0.5)">
      <span style="${style}">${sk.name}</span>
      <span style="${style}">${fmtMod(val)}</span>
    </div>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.className = 'spell-popup-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const popup = document.createElement('div');
  popup.className = 'spell-popup';

  popup.innerHTML = `
    <button class="spell-popup-close" onclick="this.closest('.spell-popup-overlay').remove()">✕</button>
    <h2 class="spell-popup-title">🐉 ${row['Name'] || ''}</h2>
    <div class="spell-popup-meta">${[row['Size'], row['Type'], showField('Alignment') ? row['Alignment'] : ''].filter(Boolean).join(' • ')}</div>

    <div class="spell-popup-grid" style="grid-template-columns:1fr 1fr 1fr;margin-bottom:10px">
      <div><strong>Armor Class</strong><span>${row['AC'] || '—'}</span></div>
      <div><strong>Hit Points</strong><span>${row['HP'] || '—'}</span></div>
      <div><strong>Speed</strong><span>${row['Speed'] || '—'}</span></div>
      <div><strong>Challenge</strong><span>${crDisplay}</span></div>
      <div><strong>Initiative</strong><span>${initiative}</span></div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:10px">
      ${abilityBoxes}
    </div>
    <div style="font-size:0.65rem;color:#aaa;text-align:center;margin-bottom:2px">Score / Mod / Save (gold = proficient)</div>

    <div style="background:#0f3460;border-radius:6px;padding:6px;margin-bottom:12px;columns:2;column-gap:8px">
      ${skillBoxes}
    </div>
    <div style="font-size:0.65rem;color:#aaa;margin-bottom:10px">Skills (gold = proficient)</div>

    <div class="spell-popup-grid">
      ${inlineBlock('Damage Vulnerabilities','Damage Vulnerabilities')}
      ${inlineBlock('Damage Resistances','Damage Resistances')}
      ${inlineBlock('Damage Immunities','Damage Immunities')}
      ${inlineBlock('Condition Immunities','Condition Immunities')}
      <div class="spell-popup-full"><strong>Senses</strong><span>${row['Senses'] || '—'}</span></div>
      <div class="spell-popup-full"><strong>Languages</strong><span>${row['Languages'] || '—'}</span></div>
    </div>

    ${sectionBlock('Traits','Traits')}
    ${sectionBlock('Actions','Actions')}
    ${sectionBlock('Bonus Actions','Bonus Actions')}
    ${sectionBlock('Reactions','Reactions')}
    ${sectionBlock('Legendary Actions','Legendary Actions')}
    ${sectionBlock('Mythic Actions','Mythic Actions')}
    ${sectionBlock('Lair Actions','Lair Actions')}
    ${sectionBlock('Regional Effects','Regional Effects')}
    ${showField('Environment') && row['Environment'] ? `<div style="color:#aaa;font-size:0.8rem;margin-top:6px">Environment: ${row['Environment']}</div>` : ''}
    ${showField('Treasure') && row['Treasure'] ? `<div style="color:#aaa;font-size:0.8rem">Treasure: ${row['Treasure']}</div>` : ''}
    ${showField('Source') ? `<div style="color:#555;font-size:0.75rem;margin-top:8px">${row['Source'] || ''}${row['Page'] ? ' p'+row['Page'] : ''}</div>` : ''}
  `;

  overlay.appendChild(popup);
  document.body.appendChild(overlay);
}
