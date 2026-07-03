const express = require('express');

const router = express.Router({ mergeParams: true });

// GET /api/tables/:tableKey/history - historico agrupado das colunas habilitadas (cache em memoria)
router.get('/', (req, res) => {
  res.json(req.scheduler.getHistoryJson());
});

module.exports = router;
