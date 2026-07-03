const { getPool, sql } = require('./pool');

function quoteIdent(name) {
  return `[${String(name).replace(/]/g, ']]')}]`;
}

/**
 * Descobre as colunas de sensor da tabela, pareando cada coluna com sua
 * respectiva coluna "<nome>_Quality". Ignora a coluna de timestamp e
 * colunas de qualidade orfas (sem par).
 *
 * @param {{schema: string, table: string, timestampColumn: string}} tableConfig
 */
async function getSensorColumns(tableConfig) {
  const pool = await getPool();
  const result = await pool
    .request()
    .input('schema', sql.NVarChar, tableConfig.schema)
    .input('table', sql.NVarChar, tableConfig.table).query(`
      SELECT COLUMN_NAME, ORDINAL_POSITION
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table
      ORDER BY ORDINAL_POSITION
    `);

  const allColumns = result.recordset.map((r) => r.COLUMN_NAME);
  const columnSet = new Set(allColumns);
  const timestampColumn = tableConfig.timestampColumn;

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
 *
 * @param {{schema: string, table: string, timestampColumn: string}} tableConfig
 */
async function getLatestRow(tableConfig) {
  const pool = await getPool();
  const tsCol = quoteIdent(tableConfig.timestampColumn);
  const tableRef = `${quoteIdent(tableConfig.schema)}.${quoteIdent(tableConfig.table)}`;
  const result = await pool.request().query(`
    SELECT TOP (1) *
    FROM ${tableRef} WITH (NOLOCK)
    ORDER BY ${tsCol} DESC
  `);
  return result.recordset[0] || null;
}

module.exports = { getSensorColumns, getLatestRow, quoteIdent };
