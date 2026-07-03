const { getPool, sql } = require('./pool');
const { quoteIdent } = require('./schema');

/**
 * Consulta o historico agrupado em baldes de N minutos, trazendo o valor
 * MAXIMO de cada sensor selecionado, considerando apenas leituras cuja
 * coluna de qualidade seja igual ao valor confiavel configurado.
 *
 * @param {{schema: string, table: string, timestampColumn: string}} tableConfig
 * @param {Array<{name: string, qualityColumn: string}>} columns
 * @param {number} groupIntervalMinutes
 * @param {Date} since - busca somente registros com timestamp >= since
 * @param {number} reliableQualityValue
 */
async function queryGroupedHistory(tableConfig, columns, groupIntervalMinutes, since, reliableQualityValue) {
  if (columns.length === 0) return [];

  const pool = await getPool();
  const tsCol = quoteIdent(tableConfig.timestampColumn);
  const tableRef = `${quoteIdent(tableConfig.schema)}.${quoteIdent(tableConfig.table)}`;

  const bucketExpr = `DATEADD(MINUTE, (DATEDIFF(MINUTE, 0, ${tsCol}) / @groupMinutes) * @groupMinutes, 0)`;

  const selectClauses = columns
    .map(({ name, qualityColumn }) => {
      const col = quoteIdent(name);
      const qcol = quoteIdent(qualityColumn);
      return `MAX(CASE WHEN ${qcol} = @reliable THEN ${col} END) AS ${col}`;
    })
    .join(',\n      ');

  const query = `
    SELECT
      ${bucketExpr} AS Bucket,
      ${selectClauses}
    FROM ${tableRef} WITH (NOLOCK)
    WHERE ${tsCol} >= @since
    GROUP BY ${bucketExpr}
    ORDER BY Bucket
  `;

  const request = pool
    .request()
    .input('groupMinutes', sql.Int, groupIntervalMinutes)
    .input('reliable', sql.Int, reliableQualityValue)
    .input('since', sql.DateTime, since);

  const result = await request.query(query);
  return result.recordset;
}

/**
 * Retorna o maior timestamp existente na tabela a partir de `since`
 * (usado para saber ate onde o cache incremental ja avancou).
 *
 * @param {{schema: string, table: string, timestampColumn: string}} tableConfig
 * @param {Date} since
 */
async function queryMaxTimestamp(tableConfig, since) {
  const pool = await getPool();
  const tsCol = quoteIdent(tableConfig.timestampColumn);
  const tableRef = `${quoteIdent(tableConfig.schema)}.${quoteIdent(tableConfig.table)}`;

  const result = await pool
    .request()
    .input('since', sql.DateTime, since)
    .query(`
      SELECT MAX(${tsCol}) AS MaxTs
      FROM ${tableRef} WITH (NOLOCK)
      WHERE ${tsCol} >= @since
    `);

  return result.recordset[0] ? result.recordset[0].MaxTs : null;
}

module.exports = { queryGroupedHistory, queryMaxTimestamp };
