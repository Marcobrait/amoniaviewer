# Amonia Viewer

Sistema voltado para manter em cache uma resposta http com resulados de uma consulta em um banco SQL para evitar sobrecarga do banco e dados com multiplos usuarios realisando consutlas simultaneas.
 

## Configuracao

1. Copie `.env.example` para `.env` e ajuste os dados de conexao com o banco:

   ```
   copy .env.example .env
   ```

   Principais variaveis:
   - `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD` - conexao SQL Server
   - `DB_SCHEMA`, `DB_TABLE` - tabela consultada (padrao: `dbo.nome_tabela`)
   - `DB_TIMESTAMP_COLUMN` - coluna de data/hora (padrao: `TIMESTAMP`)
   - `RELIABLE_QUALITY_VALUE` - valor da coluna `*_Quality` considerado confiavel (padrao: `192`)
   - `HTTP_PORT` - porta do servidor Node
   - `DEFAULT_GROUP_INTERVAL_MINUTES` - intervalo de agrupamento inicial (minutos)
   - `DEFAULT_UPDATE_INTERVAL_MINUTES` - intervalo de atualizacao incremental inicial (minutos)
   - `HISTORY_HOURS` - janela de historico mantida (padrao 24h)

   Esses dois ultimos intervalos (agrupamento e atualizacao) tambem podem ser alterados
   depois pela propria tela de configuracao, sem precisar reiniciar o servidor.

2. Instale as dependencias:

   ```
   npm install
   ```

3. Rode o servidor:

   ```
   npm start
   ```

4. Acesse `http://localhost:3000` para abrir a tela de configuracao.

## Como funciona

- **Descoberta de colunas**: o sistema le `INFORMATION_SCHEMA.COLUMNS` da tabela configurada
  e pareia automaticamente cada coluna de sensor com sua coluna `_Quality` correspondente.
- **Tela de configuracao** (`/`): lista todas as colunas encontradas com o ultimo valor lido,
  indicando se a leitura e confiavel (`*_Quality = RELIABLE_QUALITY_VALUE`), e permite marcar
  quais colunas devem ser expostas no endpoint de historico, alem dos intervalos de
  agrupamento e atualizacao. O botao "Marcar confiaveis" marca de uma vez todos os sensores
  cuja ultima leitura seja confiavel. Cada sensor tambem tem um campo de **nome de exibicao**
  (opcional - se vazio, usa o nome original da coluna) e dois **setpoints**, `Alarme` e
  `Evacuacao` (padrao 10 e 20), usados para classificar o estado do sensor. O botao
  "Salvar configuracao" persiste tudo em `config/settings.json` e reinicia o processo de
  coleta com os novos parametros.
- **Estado do sensor**: a partir da ultima leitura de cada sensor habilitado, o dashboard e o
  painel do Grafana calculam um dos quatro estados (mutuamente exclusivos): `falha` (leitura
  negativa), `evacuacao` (acima do setpoint de evacuacao), `alarme` (acima do setpoint de
  alarme) ou normal. Os totais de sensores em cada estado aparecem nos indicadores no topo de
  ambas as telas.
- **Coleta incremental**: ao salvar (ou ao iniciar o servidor), o sistema carrega o historico
  completo das ultimas `HISTORY_HOURS` horas para as colunas habilitadas, agrupando por
  `groupIntervalMinutes` e trazendo o valor MAXIMO de cada sensor dentro do intervalo,
  desconsiderando leituras cuja coluna `*_Quality` nao seja confiavel. Depois disso, a cada
  `updateIntervalMinutes` minutos o sistema consulta **apenas os registros novos** (usando
  `WITH (NOLOCK)` e filtro por timestamp), atualiza os baldes correspondentes no cache em
  memoria e descarta os baldes que saíram da janela de 24 horas. Isso evita consultas pesadas
  repetidas no banco de producao.
- **Endpoint HTTP** (`GET /api/history`): retorna o JSON servido diretamente do cache em
  memoria (sem tocar no banco a cada requisicao), no formato:

  ```json
  {
    "generatedAt": "2026-07-02T12:00:00.000Z",
    "historyHours": 24,
    "groupIntervalMinutes": 10,
    "updateIntervalMinutes": 10,
    "columns": ["NOMECOLUNA1", "NOMECOLUNA2"],
    "series": {
      "NOMECOLUNA1": [{ "timestamp": "2026-07-01T12:00:00.000Z", "value": 12.3 }, ...],
      "NOMECOLUNA2": [...]
    }
  }
  ```

## Endpoints

| Metodo | Rota            | Descricao |
|--------|-----------------|-----------|
| GET    | `/api/columns`  | Lista colunas de sensor: ultimo valor/qualidade, estado habilitado, nome de exibicao e setpoints |
| GET    | `/api/config`   | Configuracao atualmente salva |
| POST   | `/api/config`   | Salva colunas habilitadas + intervalos e reinicia a coleta |
| GET    | `/api/history`  | Historico agrupado (24h) das colunas habilitadas, servido do cache |
| GET    | `/api/health`   | Healthcheck simples |

## Estrutura

```
src/
  config/     # env.js (leitura do .env) e settingsStore.js (config/settings.json)
  db/         # pool.js, schema.js (descoberta de colunas) e history.js (queries agrupadas)
  services/   # scheduler.js (cache em memoria + polling incremental)
  routes/     # rotas Express
  server.js   # bootstrap
public/       # tela de configuracao (HTML/CSS/JS puro)
config/       # settings.json gerado em runtime (git-ignored)
```
