const express = require('express');
const { getSensorColumns } = require('../db/schema');
const { loadSettings, saveSettings, sanitizeSettings } = require('../config/settingsStore');
const scheduler = require('../services/scheduler');

const router = express.Router();

// GET /api/config - configuracao atualmente salva
router.get('/', (req, res) => {
  res.json(loadSettings());
});

// POST /api/config - salva colunas habilitadas + intervalos, e reinicia o scheduler
router.post('/', async (req, res) => {
  try {
    const sensorColumns = await getSensorColumns();
    const validNames = sensorColumns.map((c) => c.name);
    const settings = sanitizeSettings(req.body || {}, validNames);

    saveSettings(settings);
    await scheduler.restart(settings);

    res.json({ ok: true, settings });
  } catch (err) {
    console.error('[routes/config] erro:', err.message);
    res.status(500).json({ error: 'Falha ao salvar configuracao' });
  }
});

module.exports = router;
