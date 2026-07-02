const path = require('path');
const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const { loadSettings } = require('./config/settingsStore');
const { getPool } = require('./db/pool');
const scheduler = require('./services/scheduler');

const columnsRouter = require('./routes/columns');
const configRouter = require('./routes/config');
const historyRouter = require('./routes/history');

async function main() {
  await getPool();

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api/columns', columnsRouter);
  app.use('/api/config', configRouter);
  app.use('/api/history', historyRouter);

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  const settings = loadSettings();
  await scheduler.start(settings);

  app.listen(env.http.port, () => {
    console.log(`[http] servidor rodando em http://localhost:${env.http.port}`);
  });
}

main().catch((err) => {
  console.error('[fatal] falha ao iniciar aplicacao:', err);
  process.exit(1);
});
