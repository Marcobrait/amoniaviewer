const tableList = document.getElementById('tableList');
const addTableForm = document.getElementById('addTableForm');
const addTableBtn = document.getElementById('addTableBtn');
const addTableStatus = document.getElementById('addTableStatus');
const newSchema = document.getElementById('newSchema');
const newTable = document.getElementById('newTable');
const newTimestampColumn = document.getElementById('newTimestampColumn');
const newDisplayName = document.getElementById('newDisplayName');

function setAddStatus(text, kind) {
  addTableStatus.textContent = text;
  addTableStatus.className = kind || '';
}

function buildTableCard(table) {
  const card = document.createElement('div');
  card.className = 'table-card';

  const header = document.createElement('div');
  header.className = 'table-card-header';

  const titleWrap = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'table-card-title';
  title.textContent = table.displayName || table.table; // nomes vem da API: textContent, nunca innerHTML
  const subtitle = document.createElement('p');
  subtitle.className = 'table-card-subtitle';
  subtitle.textContent = `${table.schema}.${table.table}`;
  titleWrap.appendChild(title);
  titleWrap.appendChild(subtitle);
  header.appendChild(titleWrap);
  card.appendChild(header);

  const actions = document.createElement('div');
  actions.className = 'table-card-actions';

  const dashboardLink = document.createElement('a');
  dashboardLink.className = 'btn primary';
  dashboardLink.href = `dashboard.html?table=${encodeURIComponent(table.key)}`;
  dashboardLink.textContent = 'Ver painel';
  actions.appendChild(dashboardLink);

  const configLink = document.createElement('a');
  configLink.className = 'btn secondary';
  configLink.href = `table-config.html?table=${encodeURIComponent(table.key)}`;
  configLink.textContent = 'Configurar sensores';
  actions.appendChild(configLink);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn secondary';
  deleteBtn.textContent = 'Remover';
  deleteBtn.addEventListener('click', () => removeTable(table.key, table.displayName || table.table));
  actions.appendChild(deleteBtn);

  card.appendChild(actions);
  return card;
}

async function loadTables() {
  tableList.innerHTML = '<p class="empty-state">Carregando...</p>';
  const res = await fetch('/api/tables');
  const data = await res.json();
  const tables = data.tables || [];

  if (tables.length === 0) {
    tableList.innerHTML = '<p class="empty-state">Nenhuma tabela cadastrada ainda. Use o formulario acima para adicionar a primeira.</p>';
    return;
  }

  tableList.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'table-list';
  tables.forEach((table) => grid.appendChild(buildTableCard(table)));
  tableList.appendChild(grid);
}

async function removeTable(key, label) {
  if (!confirm(`Remover a tabela "${label}" da lista monitorada?`)) return;
  try {
    const res = await fetch(`/api/tables/${encodeURIComponent(key)}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    await loadTables();
  } catch (err) {
    alert('Erro ao remover tabela: ' + err.message);
  }
}

addTableForm.addEventListener('submit', async (evt) => {
  evt.preventDefault();
  addTableBtn.disabled = true;
  setAddStatus('Validando e cadastrando...');
  try {
    const payload = {
      schema: newSchema.value,
      table: newTable.value,
      timestampColumn: newTimestampColumn.value,
      displayName: newDisplayName.value
    };
    const res = await fetch('/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));

    setAddStatus('Tabela adicionada com sucesso.', 'success');
    addTableForm.reset();
    await loadTables();
  } catch (err) {
    setAddStatus('Erro ao adicionar: ' + err.message, 'error');
  } finally {
    addTableBtn.disabled = false;
  }
});

loadTables().catch((err) => {
  tableList.innerHTML = '';
  setAddStatus('Erro ao carregar tabelas: ' + err.message, 'error');
});
