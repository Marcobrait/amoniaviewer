const env = require('../config/env');
const { getSensorColumns } = require('../db/schema');
const { queryGroupedHistory, queryMaxTimestamp } = require('../db/history');
const dbWriter = require('./dbWriter');

/**
 * Cache em memoria do historico agrupado. Mantido por bucket (inicio do
 * intervalo de agrupamento) -> { colName: valorMaximo }.
 */
class HistoryCache {
  constructor() {
    this.buckets = new Map(); // bucketIso -> { [colName]: number|null }
  }

  mergeRows(rows, columnNames) {
    for (const row of rows) {
      const bucketIso = new Date(row.Bucket).toISOString();
      let bucket = this.buckets.get(bucketIso);
      if (!bucket) {
        bucket = {};
        this.buckets.set(bucketIso, bucket);
      }
      for (const col of columnNames) {
        const value = row[col];
        if (value === null || value === undefined) continue;
        const numeric = Number(value);
        if (Number.isNaN(numeric)) continue;
        bucket[col] = bucket[col] === undefined ? numeric : Math.max(bucket[col], numeric);
      }
    }
  }

  evictOlderThan(cutoffDate) {
    const cutoffTime = cutoffDate.getTime();
    for (const bucketIso of this.buckets.keys()) {
      if (new Date(bucketIso).getTime() < cutoffTime) {
        this.buckets.delete(bucketIso);
      }
    }
  }

  toSeries(columnNames) {
    const sortedBuckets = [...this.buckets.entries()].sort(
      ([a], [b]) => new Date(a).getTime() - new Date(b).getTime()
    );
    const series = {};
    for (const col of columnNames) {
      series[col] = sortedBuckets
        .filter(([, values]) => values[col] !== undefined)
        .map(([bucketIso, values]) => ({ timestamp: bucketIso, value: values[col] }));
    }
    return series;
  }
}

function historySinceDate() {
  return new Date(Date.now() - env.defaults.historyHours * 60 * 60 * 1000);
}

/**
 * Cria uma instancia independente de scheduler (cache + polling incremental)
 * para uma tabela monitorada. Cada tabela recebe a sua propria instancia,
 * com estado (cache, timer, ultima leitura) isolado por closure - nenhum
 * estado e compartilhado entre tabelas diferentes.
 *
 * @param {{key: string, schema: string, table: string, timestampColumn: string}} tableConfig
 */
function createScheduler(tableConfig) {
  const logPrefix = `[scheduler:${tableConfig.key}]`;

  let cache = new HistoryCache();
  let currentSettings = null;
  let lastTimestamp = null;
  let timer = null;
  let enabledColumnsCache = [];

  async function resolveEnabledColumns(settings) {
    const allColumns = await getSensorColumns(tableConfig);
    return allColumns.filter((c) => settings.columns[c.name]);
  }

  // Sincroniza a tabela "_viewer" com o cache atual, se a funcionalidade
  // estiver habilitada. Erros aqui sao so logados - nunca devem derrubar o
  // polling principal, que precisa continuar servindo o cache normalmente.
  async function syncToDb() {
    if (!env.dbWriter.enabled) return;
    const columnNames = enabledColumnsCache.map((c) => c.name);
    try {
      await dbWriter.sync(tableConfig, columnNames, cache.buckets, env.dbWriter.historyMode);
    } catch (err) {
      console.error(`${logPrefix} erro ao sincronizar tabela _viewer:`, err.message);
    }
  }

  async function rebuildFull(settings) {
    currentSettings = settings;
    enabledColumnsCache = await resolveEnabledColumns(settings);
    cache = new HistoryCache();
    lastTimestamp = null;

    if (enabledColumnsCache.length === 0) {
      console.log(`${logPrefix} nenhuma coluna habilitada, cache vazio`);
      return;
    }

    const since = historySinceDate();
    const columnNames = enabledColumnsCache.map((c) => c.name);

    console.log(
      `${logPrefix} carregando historico completo (${env.defaults.historyHours}h) para ${columnNames.length} colunas`
    );

    const rows = await queryGroupedHistory(
      tableConfig,
      enabledColumnsCache,
      settings.groupIntervalMinutes,
      since,
      env.defaults.reliableQualityValue
    );
    cache.mergeRows(rows, columnNames);

    const maxTs = await queryMaxTimestamp(tableConfig, since);
    lastTimestamp = maxTs ? new Date(maxTs) : since;

    cache.evictOlderThan(since);
    console.log(`${logPrefix} historico inicial carregado: ${cache.buckets.size} baldes`);

    await syncToDb();
  }

  async function pollIncremental() {
    if (!currentSettings || enabledColumnsCache.length === 0) return;

    const since = lastTimestamp || historySinceDate();
    const columnNames = enabledColumnsCache.map((c) => c.name);

    try {
      const rows = await queryGroupedHistory(
        tableConfig,
        enabledColumnsCache,
        currentSettings.groupIntervalMinutes,
        since,
        env.defaults.reliableQualityValue
      );
      if (rows.length > 0) {
        cache.mergeRows(rows, columnNames);
      }

      const maxTs = await queryMaxTimestamp(tableConfig, since);
      if (maxTs) {
        lastTimestamp = new Date(maxTs);
      }

      cache.evictOlderThan(historySinceDate());
      console.log(`${logPrefix} atualizacao incremental: ${rows.length} baldes novos/atualizados`);

      await syncToDb();
    } catch (err) {
      console.error(`${logPrefix} erro na atualizacao incremental:`, err.message);
    }
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  async function start(settings) {
    stop();
    await rebuildFull(settings);
    const intervalMs = settings.updateIntervalMinutes * 60 * 1000;
    timer = setInterval(pollIncremental, intervalMs);
    console.log(`${logPrefix} polling incremental a cada ${settings.updateIntervalMinutes} minuto(s)`);
  }

  async function restart(settings) {
    await start(settings);
  }

  function getHistoryJson() {
    const columnNames = enabledColumnsCache.map((c) => c.name);
    return {
      generatedAt: new Date().toISOString(),
      historyHours: env.defaults.historyHours,
      groupIntervalMinutes: currentSettings ? currentSettings.groupIntervalMinutes : null,
      updateIntervalMinutes: currentSettings ? currentSettings.updateIntervalMinutes : null,
      columns: columnNames,
      series: cache.toSeries(columnNames)
    };
  }

  return { start, restart, stop, getHistoryJson, tableConfig };
}

module.exports = { createScheduler };
