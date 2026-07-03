const { getPool, sql } = require('../db/pool');
const { quoteIdent } = require('../db/schema');
const env = require('../config/env');

function viewerTableName(tableConfig) {
  return `${tableConfig.table}_viewer`;
}

function tableRef(tableConfig) {
  return `${quoteIdent(tableConfig.schema)}.${quoteIdent(viewerTableName(tableConfig))}`;
}

async function tableExists(pool, tableConfig) {
  const result = await pool
    .request()
    .input('schema', sql.NVarChar, tableConfig.schema)
    .input('table', sql.NVarChar, viewerTableName(tableConfig))
    .query(`
      SELECT COUNT(*) AS cnt
      FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
    `);
  return result.recordset[0].cnt > 0;
}

async function getExistingColumns(pool, tableConfig) {
  const result = await pool
    .request()
    .input('schema', sql.NVarChar, tableConfig.schema)
    .input('table', sql.NVarChar, viewerTableName(tableConfig))
    .query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
    `);
  return new Set(result.recordset.map((r) => r.COLUMN_NAME));
}

// Para cada sensor, gera a definicao das duas colunas (valor + qualidade),
// no mesmo padrao [Sensor] / [Sensor_Quality] da tabela original.
function buildColumnDefs(columnNames) {
  const defs = [];
  for (const name of columnNames) {
    defs.push({ name, type: 'FLOAT' });
    defs.push({ name: `${name}_Quality`, type: 'INT' });
  }
  return defs;
}

/**
 * Garante que a tabela "<table>_viewer" existe e tem as colunas de valor
 * e qualidade (`_Quality`) de cada sensor habilitado. Nunca remove colunas
 * nem mexe na tabela original - so cria a tabela na primeira vez e adiciona
 * colunas novas conforme mais sensores sao habilitados.
 *
 * @param {{schema: string, table: string, timestampColumn: string}} tableConfig
 */
async function ensureTable(tableConfig, columnNames) {
  const pool = await getPool();
  const tsCol = quoteIdent(tableConfig.timestampColumn);
  const ref = tableRef(tableConfig);
  const colDefs = buildColumnDefs(columnNames);

  const exists = await tableExists(pool, tableConfig);
  if (!exists) {
    const colsDef = colDefs.map((c) => `${quoteIdent(c.name)} ${c.type} NULL`).join(',\n        ');
    await pool.request().query(`
      CREATE TABLE ${ref} (
        ${tsCol} DATETIME NOT NULL PRIMARY KEY,
        ${colsDef}
      )
    `);
    console.log(`[dbWriter] tabela ${viewerTableName(tableConfig)} criada com ${columnNames.length} sensor(es) (valor + qualidade)`);
    return;
  }

  const existingCols = await getExistingColumns(pool, tableConfig);
  const missing = colDefs.filter((c) => !existingCols.has(c.name));
  if (missing.length > 0) {
    const addClauses = missing.map((c) => `${quoteIdent(c.name)} ${c.type} NULL`).join(', ');
    await pool.request().query(`ALTER TABLE ${ref} ADD ${addClauses}`);
    console.log(`[dbWriter] coluna(s) adicionada(s) em ${viewerTableName(tableConfig)}: ${missing.map((c) => c.name).join(', ')}`);
  }
}

/**
 * Sincroniza o cache atual (buckets agrupados) com a tabela _viewer.
 *
 * Sempre substitui os baldes dentro do intervalo [minTs, maxTs] recebido
 * (DELETE + bulk INSERT) para refletir valores que ainda podem mudar
 * enquanto o balde estiver na janela ativa.
 *
 * Se `historyMode` for falso, tambem apaga da tabela qualquer registro mais
 * antigo que `minTs`, mantendo a tabela identica a janela atual do cache/JSON.
 * Se verdadeiro, registros antigos nunca sao apagados (historico permanente).
 *
 * @param {{schema: string, table: string, timestampColumn: string}} tableConfig
 * @param {string[]} columnNames - colunas de sensor habilitadas
 * @param {Map<string, Record<string, number>>} buckets - bucketIso -> {coluna: valor}
 * @param {boolean} historyMode
 */
async function sync(tableConfig, columnNames, buckets, historyMode) {
  if (!env.dbWriter.enabled) return;
  if (columnNames.length === 0 || buckets.size === 0) return;

  await ensureTable(tableConfig, columnNames);

  const pool = await getPool();
  const tsCol = tableConfig.timestampColumn;
  const tsColQuoted = quoteIdent(tsCol);
  const ref = tableRef(tableConfig);

  const entries = [...buckets.entries()];
  const timestamps = entries.map(([iso]) => new Date(iso));
  const minTs = new Date(Math.min(...timestamps.map((d) => d.getTime())));
  const maxTs = new Date(Math.max(...timestamps.map((d) => d.getTime())));

  // Refaz os baldes do intervalo sincronizado agora (podem ter mudado
  // enquanto estavam na janela ativa) antes de reinserir os valores atuais.
  await pool
    .request()
    .input('minTs', sql.DateTime, minTs)
    .input('maxTs', sql.DateTime, maxTs)
    .query(`DELETE FROM ${ref} WHERE ${tsColQuoted} BETWEEN @minTs AND @maxTs`);

  // O cache so guarda o valor MAXIMO ja filtrado por leituras confiaveis
  // (a query agrupada descarta quem nao tem *_Quality = RELIABLE_QUALITY_VALUE
  // antes do MAX). Entao aqui a qualidade e sintetica: RELIABLE_QUALITY_VALUE
  // quando ha valor no balde, e NULL quando nao ha (sem leitura confiavel).
  const reliableValue = env.defaults.reliableQualityValue;

  const bulkTable = new sql.Table(viewerTableName(tableConfig));
  bulkTable.schema = tableConfig.schema;
  bulkTable.create = false;
  bulkTable.columns.add(tsCol, sql.DateTime, { nullable: false });
  for (const col of columnNames) {
    bulkTable.columns.add(col, sql.Float, { nullable: true });
    bulkTable.columns.add(`${col}_Quality`, sql.Int, { nullable: true });
  }
  for (const [iso, values] of entries) {
    const row = [new Date(iso)];
    for (const col of columnNames) {
      const v = values[col];
      const hasValue = v !== undefined && v !== null;
      row.push(hasValue ? v : null);
      row.push(hasValue ? reliableValue : null);
    }
    bulkTable.rows.add(...row);
  }

  const bulkRequest = pool.request();
  await bulkRequest.bulk(bulkTable);

  if (!historyMode) {
    await pool
      .request()
      .input('minTs', sql.DateTime, minTs)
      .query(`DELETE FROM ${ref} WHERE ${tsColQuoted} < @minTs`);
  }

  console.log(
    `[dbWriter] sincronizado: ${entries.length} balde(s) em ${viewerTableName(tableConfig)}` +
      (historyMode ? ' (modo historico)' : ' (espelhando janela atual)')
  );
}

module.exports = { sync, viewerTableName };
