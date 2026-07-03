const tableRegistry = require('../config/tableRegistry');
const settingsStore = require('../config/settingsStore');
const { createScheduler } = require('./scheduler');

const schedulers = new Map(); // tableKey -> scheduler instance

async function startTable(tableConfig) {
  const settings = settingsStore.loadSettings(tableConfig.key);
  const scheduler = createScheduler(tableConfig);
  await scheduler.start(settings);
  schedulers.set(tableConfig.key, scheduler);
  return scheduler;
}

function stopTable(key) {
  const scheduler = schedulers.get(key);
  if (scheduler) {
    scheduler.stop();
    schedulers.delete(key);
  }
}

function get(key) {
  return schedulers.get(key);
}

function has(key) {
  return schedulers.has(key);
}

/**
 * Inicia um scheduler para cada tabela cadastrada no registro. Chamado uma
 * vez no boot do servidor, depois da migracao legada (se houver).
 */
async function initAll() {
  for (const tableConfig of tableRegistry.listTables()) {
    await startTable(tableConfig);
  }
}

module.exports = { initAll, startTable, stopTable, get, has };
