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

  // Chrome exige um cabeçalho extra (Private Network Access) quando uma
  // pagina publica em HTTPS (ex.: o Grafana) chama uma API num IP privado
  // como este. Sem isso, a preflight OPTIONS falha mesmo com CORS liberado.
  app.use((req, res, next) => {
    if (req.headers['access-control-request-private-network']) {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    next();
  });
  app.use(cors({ origin: env.cors.origin }));
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
