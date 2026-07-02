const fs = require('fs');
const path = require('path');
const env = require('./env');

const SETTINGS_PATH = path.join(__dirname, '..', '..', 'config', 'settings.json');

function defaultSettings() {
  return {
    columns: {},
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

/**
 * Sanitiza a configuracao recebida via API, aceitando somente nomes de
 * coluna que realmente existem na tabela (evita entradas arbitrarias).
 */
function sanitizeSettings(input, validColumnNames) {
  const current = loadSettings();
  const validSet = new Set(validColumnNames);
  const columns = {};

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

  return {
    columns,
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

module.exports = { loadSettings, saveSettings, sanitizeSettings, SETTINGS_PATH };
