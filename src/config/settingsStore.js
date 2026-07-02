const fs = require('fs');
const path = require('path');
const env = require('./env');

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'config', 'settings.json');

const DEFAULT_ALARM_SETPOINT = 10;
const DEFAULT_EVACUATION_SETPOINT = 20;

function defaultSettings() {
  return {
    columns: {},
    displayNames: {},
    setpoints: {},
    groupIntervalMinutes: env.defaults.groupIntervalMinutes,
    updateIntervalMinutes: env.defaults.updateIntervalMinutes
  };
}

function ensureConfigDir() {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadSettings() {
  if (!fs.existsSync(SETTINGS_PATH)) {
    const settings = defaultSettings();
    saveSettings(settings);
    return settings;
  }
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...defaultSettings(), ...parsed };
  } catch (err) {
    console.error('[config] falha ao ler settings.json, usando padrao:', err.message);
    return defaultSettings();
  }
}

function saveSettings(settings) {
  ensureConfigDir();
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Retorna o nome de exibicao de uma coluna, caindo para o nome original
 * da coluna quando nao houver apelido configurado.
 */
function displayNameFor(settings, columnName) {
  const custom = settings.displayNames && settings.displayNames[columnName];
  return custom && custom.trim() ? custom.trim() : columnName;
}

/**
 * Retorna os setpoints (alarme/evacuacao) de uma coluna, caindo para os
 * valores padrao quando ainda nao configurados.
 */
function setpointsFor(settings, columnName) {
  const custom = settings.setpoints && settings.setpoints[columnName];
  return {
    alarm: toFiniteNumber(custom && custom.alarm, DEFAULT_ALARM_SETPOINT),
    evacuation: toFiniteNumber(custom && custom.evacuation, DEFAULT_EVACUATION_SETPOINT)
  };
}

/**
 * Sanitiza a configuracao recebida via API, aceitando somente nomes de
 * coluna que realmente existem na tabela (evita entradas arbitrarias).
 */
function sanitizeSettings(input, validColumnNames) {
  const current = loadSettings();
  const validSet = new Set(validColumnNames);
  const columns = {};
  const displayNames = {};
  const setpoints = {};

  if (input.columns && typeof input.columns === 'object') {
    for (const [name, enabled] of Object.entries(input.columns)) {
      if (validSet.has(name)) {
        columns[name] = Boolean(enabled);
      }
    }
  }
  // Preenche colunas nao enviadas com false para manter o objeto completo
  for (const name of validSet) {
    if (!(name in columns)) columns[name] = false;
  }

  if (input.displayNames && typeof input.displayNames === 'object') {
    for (const [name, label] of Object.entries(input.displayNames)) {
      if (!validSet.has(name)) continue;
      const trimmed = typeof label === 'string' ? label.trim() : '';
      if (trimmed) displayNames[name] = trimmed;
    }
  }

  if (input.setpoints && typeof input.setpoints === 'object') {
    for (const [name, sp] of Object.entries(input.setpoints)) {
      if (!validSet.has(name) || !sp || typeof sp !== 'object') continue;
      const currentSp = setpointsFor(current, name);
      setpoints[name] = {
        alarm: toFiniteNumber(sp.alarm, currentSp.alarm),
        evacuation: toFiniteNumber(sp.evacuation, currentSp.evacuation)
      };
    }
  }

  return {
    columns,
    displayNames,
    setpoints,
    groupIntervalMinutes: clampInt(
      input.groupIntervalMinutes,
      1,
      1440,
      current.groupIntervalMinutes
    ),
    updateIntervalMinutes: clampInt(
      input.updateIntervalMinutes,
      1,
      1440,
      current.updateIntervalMinutes
    )
  };
}

module.exports = {
  loadSettings,
  saveSettings,
  sanitizeSettings,
  displayNameFor,
  setpointsFor,
  DEFAULT_ALARM_SETPOINT,
  DEFAULT_EVACUATION_SETPOINT,
  SETTINGS_PATH
};
