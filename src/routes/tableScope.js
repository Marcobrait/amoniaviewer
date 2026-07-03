const tableRegistry = require('../config/tableRegistry');
const tableManager = require('../services/tableManager');

/**
 * Middleware usado pelos roteadores montados em /api/tables/:tableKey/...
 * Resolve o :tableKey da URL para a entrada do registro + a instancia do
 * scheduler correspondente, anexando ambos em req para os roteadores usarem.
 */
function resolveTable(req, res, next) {
  const tableConfig = tableRegistry.getTable(req.params.tableKey);
  if (!tableConfig) {
    return res.status(404).json({ error: `Tabela '${req.params.tableKey}' nao encontrada` });
  }
  const scheduler = tableManager.get(tableConfig.key);
  if (!scheduler) {
    return res.status(503).json({ error: `Tabela '${tableConfig.key}' ainda nao esta pronta` });
  }
  req.tableConfig = tableConfig;
  req.scheduler = scheduler;
  next();
}

module.exports = { resolveTable };
