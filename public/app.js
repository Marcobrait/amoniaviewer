const columnsBody = document.getElementById('columnsBody');
const groupIntervalInput = document.getElementById('groupInterval');
const updateIntervalInput = document.getElementById('updateInterval');
const statusMsg = document.getElementById('statusMsg');
const saveBtn = document.getElementById('saveBtn');
const selectAllBtn = document.getElementById('selectAllBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const reloadBtn = document.getElementById('reloadBtn');

let columnsData = [];

function setStatus(text, kind) {
  statusMsg.textContent = text;
  statusMsg.className = kind || '';
}

function formatValue(value) {
  if (value === null || value === undefined) return '-';
  return typeof value === 'number' ? value.toFixed(2) : String(value);
}

function renderColumns(columns) {
  columnsData = columns;
  if (columns.length === 0) {
    columnsBody.innerHTML = '<tr><td colspan="4">Nenhuma coluna de sensor encontrada na tabela.</td></tr>';
    return;
  }

  columnsBody.innerHTML = columns
    .map((col, idx) => {
      const badgeClass = col.reliable ? 'ok' : 'bad';
      const badgeText = col.reliable ? 'Confiavel' : 'Nao confiavel';
      return `
        <tr>
          <td><input type="checkbox" data-idx="${idx}" ${col.enabled ? 'checked' : ''} /></td>
          <td>${col.name}</td>
          <td>${formatValue(col.lastValue)}</td>
          <td><span class="badge ${badgeClass}">${badgeText}</span> <span style="color:var(--muted)">(${formatValue(col.lastQuality)})</span></td>
        </tr>
      `;
    })
    .join('');
}

async function loadAll() {
  setStatus('Carregando...');
  const [columnsRes, configRes] = await Promise.all([
    fetch('/api/columns').then((r) => r.json()),
    fetch('/api/config').then((r) => r.json())
  ]);

  renderColumns(columnsRes.columns || []);
  groupIntervalInput.value = configRes.groupIntervalMinutes;
  updateIntervalInput.value = configRes.updateIntervalMinutes;
  setStatus('');
}

function getCheckedState() {
  const checkboxes = columnsBody.querySelectorAll('input[type="checkbox"]');
  const result = {};
  checkboxes.forEach((cb) => {
    const idx = Number(cb.dataset.idx);
    result[columnsData[idx].name] = cb.checked;
  });
  return result;
}

selectAllBtn.addEventListener('click', () => {
  columnsBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true));
});

clearAllBtn.addEventListener('click', () => {
  columnsBody.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
});

reloadBtn.addEventListener('click', () => {
  loadAll().catch((err) => setStatus('Erro ao carregar: ' + err.message, 'error'));
});

saveBtn.addEventListener('click', async () => {
  saveBtn.disabled = true;
  setStatus('Salvando...');
  try {
    const payload = {
      columns: getCheckedState(),
      groupIntervalMinutes: Number(groupIntervalInput.value),
      updateIntervalMinutes: Number(updateIntervalInput.value)
    };
    const res = await fetch('/api/config', {
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

loadAll().catch((err) => setStatus('Erro ao carregar: ' + err.message, 'error'));
