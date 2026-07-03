const fs = require('fs');
const path = require('path');

const REGISTRY_PATH = path.join(__dirname, '..', '..', 'config', 'tables.json');

function ensureConfigDir() {
  const dir = path.dirname(REGISTRY_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tabela';
}

function generateUniqueKey(tableName, existingKeys) {
  const base = slugify(tableName);
  const taken = new Set(existingKeys);
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return { tables: [] };
  }
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return { tables: Array.isArray(parsed.tables) ? parsed.tables : [] };
  } catch (err) {
    console.error('[tableRegistry] falha ao ler tables.json, usando lista vazia:', err.message);
    return { tables: [] };
  }
}

function saveRegistry(registry) {
  ensureConfigDir();
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');
}

function listTables() {
  return loadRegistry().tables;
}

function getTable(key) {
  return loadRegistry().tables.find((t) => t.key === key);
}

function sanitizeTableInput(input) {
  const errors = [];
  const schema = (input && typeof input.schema === 'string' ? input.schema.trim() : '') || 'dbo';
  const table = input && typeof input.table === 'string' ? input.table.trim() : '';
  const timestampColumn =
    (input && typeof input.timestampColumn === 'string' ? input.timestampColumn.trim() : '') || 'E3TimeStamp';
  const displayNameRaw = input && typeof input.displayName === 'string' ? input.displayName.trim() : '';

  if (!table) errors.push('Nome da tabela e obrigatorio');

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      schema,
      table,
      timestampColumn,
      displayName: displayNameRaw || table
    }
  };
}

function addTable(input) {
  const sanitized = sanitizeTableInput(input);
  if (!sanitized.ok) return { ok: false, errors: sanitized.errors };

  const registry = loadRegistry();
  const duplicate = registry.tables.find(
    (t) => t.schema === sanitized.value.schema && t.table === sanitized.value.table
  );
  if (duplicate) {
    return { ok: false, errors: [`Tabela ${sanitized.value.schema}.${sanitized.value.table} ja esta cadastrada`] };
  }

  const key = generateUniqueKey(sanitized.value.table, registry.tables.map((t) => t.key));
  const entry = { key, ...sanitized.value, createdAt: new Date().toISOString() };
  registry.tables.push(entry);
  saveRegistry(registry);
  return { ok: true, value: entry };
}

function removeTable(key) {
  const registry = loadRegistry();
  const before = registry.tables.length;
  registry.tables = registry.tables.filter((t) => t.key !== key);
  if (registry.tables.length === before) return false;
  saveRegistry(registry);
  return true;
}

function updateTable(key, patch) {
  const registry = loadRegistry();
  const entry = registry.tables.find((t) => t.key === key);
  if (!entry) return null;
  if (patch && typeof patch.displayName === 'string' && patch.displayName.trim()) {
    entry.displayName = patch.displayName.trim();
  }
  saveRegistry(registry);
  return entry;
}

/**
 * Migra a configuracao legada de tabela unica (.env DB_TABLE/DB_SCHEMA/
 * DB_TIMESTAMP_COLUMN + config/settings.json) para o novo registro
 * multi-tabela, na primeira execucao apos esta atualizacao. Idempotente:
 * so roda quando tables.json ainda nao existe.
 *
 * Le process.env.DB_TABLE diretamente (nao env.db.table), porque env.js
 * aplica um valor padrao mesmo sem DB_TABLE configurado - usar env.db.table
 * aqui faria uma instalacao nova sempre "migrar" uma tabela fantasma.
 */
function migrateLegacyIfNeeded(settingsPathFor) {
  if (fs.existsSync(REGISTRY_PATH)) return;

  const legacyTable = process.env.DB_TABLE;
  if (!legacyTable) {
    saveRegistry({ tables: [] });
    return;
  }

  const schema = process.env.DB_SCHEMA || 'dbo';
  const timestampColumn = process.env.DB_TIMESTAMP_COLUMN || 'E3TimeStamp';
  const key = generateUniqueKey(legacyTable, []);
  const entry = {
    key,
    schema,
    table: legacyTable,
    timestampColumn,
    displayName: legacyTable,
    createdAt: new Date().toISOString()
  };
  saveRegistry({ tables: [entry] });

  const legacySettingsPath = path.join(__dirname, '..', '..', 'config', 'settings.json');
  const newSettingsPath = settingsPathFor(key);
  if (fs.existsSync(legacySettingsPath) && !fs.existsSync(newSettingsPath)) {
    fs.mkdirSync(path.dirname(newSettingsPath), { recursive: true });
    fs.renameSync(legacySettingsPath, newSettingsPath);
    console.log(`[migration] settings.json legado movido para ${newSettingsPath}`);
  }
  console.log(`[migration] tabela legada '${legacyTable}' registrada como '${key}'`);
}

module.exports = {
  slugify,
  generateUniqueKey,
  loadRegistry,
  saveRegistry,
  listTables,
  getTable,
  sanitizeTableInput,
  addTable,
  removeTable,
  updateTable,
  migrateLegacyIfNeeded,
  REGISTRY_PATH
};
