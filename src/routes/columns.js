const express = require('express');
const { getSensorColumns, getLatestRow } = require('../db/schema');
const { loadSettings } = require('../config/settingsStore');
const env = require('../config/env');

const router = express.Router();

// GET /api/columns - lista colunas disponiveis com ultimo valor/qualidade e estado (habilitada ou nao)
router.get('/', async (req, res) => {
  try {
    const [sensorColumns, latestRow, settings] = await Promise.all([
      getSensorColumns(),
      getLatestRow(),
      Promise.resolve(loadSettings())
    ]);

    const reliableValue = env.defaults.reliableQualityValue;

    const columns = sensorColumns.map(({ name, qualityColumn }) => {
      const lastValue = latestRow ? latestRow[name] : null;
      const lastQuality = latestRow ? latestRow[qualityColumn] : null;
      return {
        name,
        qualityColumn,
        lastValue,
        lastQuality,
        reliable: lastQuality === reliableValue,
        enabled: Boolean(settings.columns[name])
      };
    });

    res.json({
      timestampColumn: env.db.timestampColumn,
      lastTimestamp: latestRow ? latestRow[env.db.timestampColumn] : null,
      reliableQualityValue: reliableValue,
      columns
    });
  } catch (err) {
    console.error('[routes/columns] erro:', err.message);
    res.status(500).json({ error: 'Falha ao consultar colunas do banco de dados' });
  }
});

module.exports = router;
