const express = require('express');
const { getSensorColumns, getLatestRow } = require('../db/schema');
const { loadSettings, displayNameFor, setpointsFor } = require('../config/settingsStore');
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
      const setpoints = setpointsFor(settings, name);
      return {
        name,
        qualityColumn,
        displayName: displayNameFor(settings, name),
        lastValue,
        lastQuality,
        reliable: lastQuality === reliableValue,
        enabled: Boolean(settings.columns[name]),
        alarmSetpoint: setpoints.alarm,
        evacuationSetpoint: setpoints.evacuation
      };
    });

    res.json({
      timestampColumn: env.db.timestampColumn,
      lastTimestamp: latestRow ? latestRow[env.db.timestampColumn] : null,
      reliableQualityValue: reliableValue,
      maxSensorValue: env.defaults.maxSensorValue,
      columns
    });
  } catch (err) {
    console.error('[routes/columns] erro:', err.message);
    res.status(500).json({ error: 'Falha ao consultar colunas do banco de dados' });
  }
});

module.exports = router;
