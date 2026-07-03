const express = require('express');
const tableRegistry = require('../config/tableRegistry');
const tableManager = require('../services/tableManager');
const { getSensorColumns } = require('../db/schema');

const router = express.Router();

// GET /api/tables - lista as tabelas monitoradas
router.get('/', (req, res) => {
  res.json({ tables: tableRegistry.listTables() });
});

// POST /api/tables - cadastra uma nova tabela monitorada, validando contra o banco
router.post('/', async (req, res) => {
  const sanitized = tableRegistry.sanitizeTableInput(req.body || {});
  if (!sanitized.ok) {
    return res.status(400).json({ error: sanitized.errors.join('; ') });
  }

  try {
    const sensorColumns = await getSensorColumns(sanitized.value);
    if (sensorColumns.length === 0) {
      return res.status(400).json({
        error: `Tabela '${sanitized.value.schema}.${sanitized.value.table}' nao encontrada ou sem colunas pareadas com _Quality`
      });
    }
  } catch (err) {
    console.error('[routes/tables] erro ao validar tabela nova:', err.message);
    return res.status(400).json({ error: `Falha ao consultar a tabela informada: ${err.message}` });
  }

  const added = tableRegistry.addTable(req.body || {});
  if (!added.ok) {
    return res.status(400).json({ error: added.errors.join('; ') });
  }

  try {
    await tableManager.startTable(added.value);
  } catch (err) {
    console.error('[routes/tables] erro ao iniciar coleta da tabela nova:', err.message);
  }

  res.status(201).json({ ok: true, table: added.value });
});

// PATCH /api/tables/:key - renomeia o nome de exibicao da tabela
router.patch('/:key', (req, res) => {
  const updated = tableRegistry.updateTable(req.params.key, req.body || {});
  if (!updated) return res.status(404).json({ error: `Tabela '${req.params.key}' nao encontrada` });
  res.json({ ok: true, table: updated });
});

// DELETE /api/tables/:key - remove a tabela da lista monitorada e para a coleta
// (o arquivo de configuracao/sensores da tabela e mantido em disco de proposito:
// se a mesma tabela for cadastrada de novo, a configuracao anterior volta sozinha)
router.delete('/:key', (req, res) => {
  const exists = tableRegistry.getTable(req.params.key);
  if (!exists) return res.status(404).json({ error: `Tabela '${req.params.key}' nao encontrada` });

  tableManager.stopTable(req.params.key);
  tableRegistry.removeTable(req.params.key);
  res.json({ ok: true });
});

module.exports = router;
