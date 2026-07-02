const sql = require('mssql');
const env = require('../config/env');

let poolPromise = null;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool({
      server: env.db.server,
      port: env.db.port,
      database: env.db.database,
      user: env.db.user,
      password: env.db.password,
      options: {
        encrypt: env.db.encrypt,
        trustServerCertificate: env.db.trustServerCertificate,
        // A coluna de timestamp guarda hora local (sem timezone). Por padrao o
        // tedious le/grava DATETIME assumindo UTC, o que desloca o horario
        // exibido pelo offset local (ex.: 13:20 no banco vira 10:20 no app).
        useUTC: env.db.useUTC
      },
      pool: {
        max: 5,
        min: 0,
        idleTimeoutMillis: 30000
      }
    })
      .connect()
      .then((pool) => {
        console.log(`[db] conectado em ${env.db.server}:${env.db.port}/${env.db.database}`);
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        throw err;
      });
  }
  return poolPromise;
}

module.exports = { getPool, sql };
