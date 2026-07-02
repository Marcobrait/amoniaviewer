const express = require('express');
const scheduler = require('../services/scheduler');

const router = express.Router();

// GET /api/history - historico agrupado das colunas habilitadas (cache em memoria)
router.get('/', (req, res) => {
  res.json(scheduler.getHistoryJson());
});

module.exports = router;
