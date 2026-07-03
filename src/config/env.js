require('dotenv').config();

function int(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value, fallback) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function float(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  cors: {
    // '*' libera qualquer origem (padrao). Para restringir, defina uma ou
    // mais origens separadas por virgula, ex.: https://grafana.minhaempresa.com
    origin: (function () {
      var raw = (process.env.CORS_ORIGIN || '*').trim();
      if (raw === '*' || raw === '') return '*';
      var list = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      return list.length > 1 ? list : list[0];
    })()
  },
  defaults: {
    groupIntervalMinutes: int(process.env.DEFAULT_GROUP_INTERVAL_MINUTES, 10),
    updateIntervalMinutes: int(process.env.DEFAULT_UPDATE_INTERVAL_MINUTES, 10),
    historyHours: int(process.env.HISTORY_HOURS, 24),
    reliableQualityValue: int(process.env.RELIABLE_QUALITY_VALUE, 192),
    // Leitura acima deste valor e tratada como erro de sensor (mesmo status
    // de "falha" usado para valores negativos), tanto no dashboard quanto no
    // painel do Grafana.
    maxSensorValue: float(process.env.MAX_SENSOR_VALUE, 10000)
  },
  dbWriter: {
    // Salva uma copia das leituras (colunas habilitadas, sem *_Quality) numa
    // tabela "<DB_TABLE>_viewer", criada/atualizada automaticamente. A tabela
    // original nunca e alterada.
    enabled: bool(process.env.SAVE_TO_DB_ENABLED, false),
    // true = a tabela _viewer so recebe INSERT/UPDATE, nunca apaga linhas
    // antigas (vira um historico permanente que cresce sem limite).
    // false = a tabela _viewer e podada a cada sincronizacao para conter
    // exatamente a mesma janela de HISTORY_HOURS que esta no cache/JSON.
    historyMode: bool(process.env.SAVE_TO_DB_HISTORY_MODE, false)
  }
};

module.exports = env;
