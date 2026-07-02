const { getPool, sql } = require('./pool');
const { quoteIdent } = require('./schema');
const env = require('../config/env');

/**
 * Consulta o historico agrupado em baldes de N minutos, trazendo o valor
 * MAXIMO de cada sensor selecionado, considerando apenas leituras cuja
 * coluna de qualidade seja igual ao valor confiavel configurado.
 *
 * @param {Array<{name: string, qualityColumn: string}>} columns
 * @param {number} groupIntervalMinutes
 * @param {Date} since - busca somente registros com timestamp >= since
 */
async function queryGroupedHistory(columns, groupIntervalMinutes, since) {
  if (columns.length === 0) return [];

  const pool = await getPool();
  const tsCol = quoteIdent(env.db.timestampColumn);
  const tableRef = `${quoteIdent(env.db.schema)}.${quoteIdent(env.db.table)}`;

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
    .input('reliable', sql.Int, env.defaults.reliableQualityValue)
    .input('since', sql.DateTime, since);

  const result = await request.query(query);
  return result.recordset;
}

/**
 * Retorna o maior timestamp existente na tabela a partir de `since`
 * (usado para saber ate onde o cache incremental ja avancou).
 */
async function queryMaxTimestamp(since) {
  const pool = await getPool();
  const tsCol = quoteIdent(env.db.timestampColumn);
  const tableRef = `${quoteIdent(env.db.schema)}.${quoteIdent(env.db.table)}`;

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
