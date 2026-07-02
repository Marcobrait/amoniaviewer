const { getPool, sql } = require('./pool');
const env = require('../config/env');

function quoteIdent(name) {
  return `[${String(name).replace(/]/g, ']]')}]`;
}

/**
 * Descobre as colunas de sensor da tabela, pareando cada coluna com sua
 * respectiva coluna "<nome>_Quality". Ignora a coluna de timestamp e
 * colunas de qualidade orfas (sem par).
 */
async function getSensorColumns() {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('schema', sql.NVarChar, env.db.schema)
    .input('table', sql.NVarChar, env.db.table).query(`
      SELECT COLUMN_NAME, ORDINAL_POSITION
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `);

  const allColumns = result.recordset.map((r) => r.COLUMN_NAME);
  const columnSet = new Set(allColumns);
  const timestampColumn = env.db.timestampColumn;

  const sensors = [];
  for (const name of allColumns) {
    if (name === timestampColumn) continue;
    if (name.endsWith('_Quality')) continue;
    const qualityColumn = `${name}_Quality`;
    if (!columnSet.has(qualityColumn)) continue;
    sensors.push({ name, qualityColumn });
  }

  return sensors;
}

/**
 * Retorna a ultima linha da tabela (maior timestamp).
 */
async function getLatestRow() {
  const pool = await getPool();
  const tsCol = quoteIdent(env.db.timestampColumn);
  const tableRef = `${quoteIdent(env.db.schema)}.${quoteIdent(env.db.table)}`;
  const result = await pool.request().query(`
    SELECT TOP (1) *
    FROM ${tableRef} WITH (NOLOCK)
    ORDER BY ${tsCol} DESC
  `);
  return result.recordset[0] || null;
}

module.exports = { getSensorColumns, getLatestRow, quoteIdent };
