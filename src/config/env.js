require('dotenv').config();

function int(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

const env = {
  db: {
    server: process.env.DB_SERVER || 'localhost',
    port: int(process.env.DB_PORT, 1433),
    database: process.env.DB_DATABASE || 'db_automacao',
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    schema: process.env.DB_SCHEMA || 'dbo',
    table: process.env.DB_TABLE || 'tab_monitor_sensores_amonia_BGE',
    encrypt: bool(process.env.DB_ENCRYPT, false),
    trustServerCertificate: bool(process.env.DB_TRUST_SERVER_CERTIFICATE, true),
    timestampColumn: process.env.DB_TIMESTAMP_COLUMN || 'E3TimeStamp',
    // false = a coluna de timestamp guarda hora local (padrao para este projeto).
    // Mude para true somente se a coluna realmente guardar horario em UTC.
    useUTC: bool(process.env.DB_USE_UTC, false)
  },
  http: {
    port: int(process.env.HTTP_PORT, 3000)
  },
  defaults: {
    groupIntervalMinutes: int(process.env.DEFAULT_GROUP_INTERVAL_MINUTES, 10),
    updateIntervalMinutes: int(process.env.DEFAULT_UPDATE_INTERVAL_MINUTES, 10),
    historyHours: int(process.env.HISTORY_HOURS, 24),
    reliableQualityValue: int(process.env.RELIABLE_QUALITY_VALUE, 192)
  }
};

module.exports = env;
