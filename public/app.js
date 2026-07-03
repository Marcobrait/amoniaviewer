const columnsBody = document.getElementById('columnsBody');
const groupIntervalInput = document.getElementById('groupInterval');
const updateIntervalInput = document.getElementById('updateInterval');
const statusMsg = document.getElementById('statusMsg');
const saveBtn = document.getElementById('saveBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const selectReliableBtn = document.getElementById('selectReliableBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const reloadBtn = document.getElementById('reloadBtn');
const pageTitle = document.getElementById('pageTitle');
const dashboardLink = document.getElementById('dashboardLink');

const tableKey = new URLSearchParams(location.search).get('table');

let columnsData = [];
let rowRefs = []; // { name, reliable, checkbox, displayNameInput, alarmInput, evacuationInput }

function setStatus(text, kind) {
  statusMsg.textContent = text;
  statusMsg.className = kind || '';
}

if (!tableKey) {
  setStatus('Nenhuma tabela selecionada. Volte para a lista de tabelas.', 'error');
  columnsBody.innerHTML = '<tr><td colspan="7">Selecione uma tabela na tela inicial.</td></tr>';
  saveBtn.disabled = true;
  selectAllBtn.disabled = true;
  selectReliableBtn.disabled = true;
  clearAllBtn.disabled = true;
  reloadBtn.disabled = true;
} else {
  dashboardLink.href = `dashboard.html?table=${encodeURIComponent(tableKey)}`;
}

function formatValue(value) {
  if (value === null || value === undefined) return '-';
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}

function buildRow(col) {
  const tr = document.createElement('tr');

  const enableTd = document.createElement('td');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = Boolean(col.enabled);
  enableTd.appendChild(checkbox);
  tr.appendChild(enableTd);

  const nameTd = document.createElement('td');
  nameTd.textContent = col.name; // nome da coluna vem da API: textContent, nunca innerHTML
  tr.appendChild(nameTd);

  const displayNameTd = document.createElement('td');
  const displayNameInput = document.createElement('input');
  displayNameInput.type = 'text';
  displayNameInput.className = 'text-input';
  displayNameInput.placeholder = col.name;
  displayNameInput.value = col.displayName && col.displayName !== col.name ? col.displayName : '';
  displayNameTd.appendChild(displayNameInput);
  tr.appendChild(displayNameTd);

  const valueTd = document.createElement('td');
  valueTd.textContent = formatValue(col.lastValue);
  tr.appendChild(valueTd);

  const qualityTd = document.createElement('td');
  const badge = document.createElement('span');
  badge.className = 'badge ' + (col.reliable ? 'ok' : 'bad');
  badge.textContent = col.reliable ? 'Confiavel' : 'Nao confiavel';
  const qualityValue = document.createElement('span');
  qualityValue.style.color = 'var(--muted)';
  qualityValue.textContent = ' (' + formatValue(col.lastQuality) + ')';
  qualityTd.appendChild(badge);
  qualityTd.appendChild(qualityValue);
  tr.appendChild(qualityTd);

  const alarmTd = document.createElement('td');
  const alarmInput = document.createElement('input');
  alarmInput.type = 'number';
  alarmInput.className = 'number-input';
  alarmInput.step = 'any';
  alarmInput.value = col.alarmSetpoint;
  alarmTd.appendChild(alarmInput);
  tr.appendChild(alarmTd);

  const evacuationTd = document.createElement('td');
  const evacuationInput = document.createElement('input');
  evacuationInput.type = 'number';
  evacuationInput.className = 'number-input';
  evacuationInput.step = 'any';
  evacuationInput.value = col.evacuationSetpoint;
  evacuationTd.appendChild(evacuationInput);
  tr.appendChild(evacuationTd);

  rowRefs.push({
    name: col.name,
    reliable: col.reliable,
    checkbox,
    displayNameInput,
    alarmInput,
    evacuationInput
  });

  return tr;
}

function renderColumns(columns) {
  columnsData = columns;
  rowRefs = [];
  columnsBody.innerHTML = '';

  if (columns.length === 0) {
    columnsBody.innerHTML = '<tr><td colspan="7">Nenhuma coluna de sensor encontrada na tabela.</td></tr>';
    return;
  }

  const fragment = document.createDocumentFragment();
  columns.forEach((col) => fragment.appendChild(buildRow(col)));
  columnsBody.appendChild(fragment);
}

async function loadAll() {
  setStatus('Carregando...');
  const [columnsRes, configRes] = await Promise.all([
    fetch(`/api/tables/${encodeURIComponent(tableKey)}/columns`).then((r) => r.json()),
    fetch(`/api/tables/${encodeURIComponent(tableKey)}/config`).then((r) => r.json())
  ]);

  if (columnsRes.table) {
    pageTitle.textContent = `Configuracao - ${columnsRes.table.displayName}`;
    document.title = `Configuracao - ${columnsRes.table.displayName}`;
  }

  renderColumns(columnsRes.columns || []);
  groupIntervalInput.value = configRes.groupIntervalMinutes;
  updateIntervalInput.value = configRes.updateIntervalMinutes;
  setStatus('');
}

function buildPayload() {
  const columns = {};
  const displayNames = {};
  const setpoints = {};

  rowRefs.forEach((row) => {
    columns[row.name] = row.checkbox.checked;
    displayNames[row.name] = row.displayNameInput.value;
    setpoints[row.name] = {
      alarm: Number(row.alarmInput.value),
      evacuation: Number(row.evacuationInput.value)
    };
  });

  return { columns, displayNames, setpoints };
}

selectAllBtn.addEventListener('click', () => {
  rowRefs.forEach((row) => (row.checkbox.checked = true));
});

selectReliableBtn.addEventListener('click', () => {
  rowRefs.forEach((row) => {
    if (row.reliable) row.checkbox.checked = true;
  });
});

clearAllBtn.addEventListener('click', () => {
  rowRefs.forEach((row) => (row.checkbox.checked = false));
});

reloadBtn.addEventListener('click', () => {
  loadAll().catch((err) => setStatus('Erro ao carregar: ' + err.message, 'error'));
});

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  setStatus('Salvando...');
  try {
    const payload = {
      ...buildPayload(),
      groupIntervalMinutes: Number(groupIntervalInput.value),
      updateIntervalMinutes: Number(updateIntervalInput.value)
    };
    const res = await fetch(`/api/tables/${encodeURIComponent(tableKey)}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    setStatus('Configuracao salva com sucesso.', 'success');
  } catch (err) {
    setStatus('Erro ao salvar: ' + err.message, 'error');
  } finally {
    saveBtn.disabled = false;
  }
});

if (tableKey) {
  loadAll().catch((err) => setStatus('Erro ao carregar: ' + err.message, 'error'));
}
