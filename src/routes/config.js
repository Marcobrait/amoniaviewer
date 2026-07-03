const express = require('express');
const { getSensorColumns } = require('../db/schema');
const { loadSettings, saveSettings, sanitizeSettings } = require('../config/settingsStore');

const router = express.Router({ mergeParams: true });

// GET /api/tables/:tableKey/config - configuracao atualmente salva
router.get('/', (req, res) => {
  res.json(loadSettings(req.tableConfig.key));
});

// POST /api/tables/:tableKey/config - salva colunas habilitadas + intervalos, e reinicia o scheduler da tabela
router.post('/', async (req, res) => {
  const tableConfig = req.tableConfig;
  try {
    const sensorColumns = await getSensorColumns(tableConfig);
    const validNames = sensorColumns.map((c) => c.name);
    const settings = sanitizeSettings(tableConfig.key, req.body || {}, validNames);

    saveSettings(tableConfig.key, settings);
    await req.scheduler.restart(settings);

    res.json({ ok: true, settings });
  } catch (err) {
    console.error('[routes/config] erro:', err.message);
    res.status(500).json({ error: 'Falha ao salvar configuracao' });
  }
});

module.exports = router;
