const env = require('../config/env');
const { getSensorColumns } = require('../db/schema');
const { queryGroupedHistory, queryMaxTimestamp } = require('../db/history');

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

let cache = new HistoryCache();
let currentSettings = null;
let lastTimestamp = null;
let timer = null;
let enabledColumnsCache = [];

function historySinceDate() {
  return new Date(Date.now() - env.defaults.historyHours * 60 * 60 * 1000);
}

async function resolveEnabledColumns(settings) {
  const allColumns = await getSensorColumns();
  return allColumns.filter((c) => settings.columns[c.name]);
}

async function rebuildFull(settings) {
  currentSettings = settings;
  enabledColumnsCache = await resolveEnabledColumns(settings);
  cache = new HistoryCache();
  lastTimestamp = null;

  if (enabledColumnsCache.length === 0) {
    console.log('[scheduler] nenhuma coluna habilitada, cache vazio');
    return;
  }

  const since = historySinceDate();
  const columnNames = enabledColumnsCache.map((c) => c.name);

  console.log(
    `[scheduler] carregando historico completo (${env.defaults.historyHours}h) para ${columnNames.length} colunas`
  );

  const rows = await queryGroupedHistory(enabledColumnsCache, settings.groupIntervalMinutes, since);
  cache.mergeRows(rows, columnNames);

  const maxTs = await queryMaxTimestamp(since);
  lastTimestamp = maxTs ? new Date(maxTs) : since;

  cache.evictOlderThan(since);
  console.log(`[scheduler] historico inicial carregado: ${cache.buckets.size} baldes`);
}

async function pollIncremental() {
  if (!currentSettings || enabledColumnsCache.length === 0) return;

  const since = lastTimestamp || historySinceDate();
  const columnNames = enabledColumnsCache.map((c) => c.name);

  try {
    const rows = await queryGroupedHistory(enabledColumnsCache, currentSettings.groupIntervalMinutes, since);
    if (rows.length > 0) {
      cache.mergeRows(rows, columnNames);
    }

    const maxTs = await queryMaxTimestamp(since);
    if (maxTs) {
      lastTimestamp = new Date(maxTs);
    }

    cache.evictOlderThan(historySinceDate());
    console.log(`[scheduler] atualizacao incremental: ${rows.length} baldes novos/atualizados`);
  } catch (err) {
    console.error('[scheduler] erro na atualizacao incremental:', err.message);
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
  console.log(`[scheduler] polling incremental a cada ${settings.updateIntervalMinutes} minuto(s)`);
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

module.exports = { start, restart, stop, getHistoryJson };
