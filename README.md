# Amonia Viewer

Sistema voltado para manter em cache uma resposta http com resulados de uma consulta em um banco SQL para evitar sobrecarga do banco e dados com multiplos usuarios realisando consutlas simultaneas. Suporta monitorar **multiplas tabelas simultaneamente** (mesmo servidor/banco SQL Server), cada uma com sua propria configuracao, cache e endpoints.

## Configuracao

1. Copie `.env.example` para `.env` e ajuste os dados de conexao com o banco:

   ```
   copy .env.example .env
   ```

   Principais variaveis:
   - `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD` - conexao SQL Server, compartilhada por todas as tabelas monitoradas
   - `DB_SCHEMA`, `DB_TABLE`, `DB_TIMESTAMP_COLUMN` - **legado**: usados somente na migracao automatica da primeira execucao apos esta atualizacao (ver "Multiplas tabelas" abaixo). Tabelas novas sao cadastradas pela tela inicial, nao pelo `.env`.
   - `RELIABLE_QUALITY_VALUE` - valor da coluna `*_Quality` considerado confiavel (padrao: `192`)
   - `MAX_SENSOR_VALUE` - leitura acima deste valor e tratada como erro de sensor, igual a valores
     negativos (padrao: `10000`)
   - `HTTP_PORT` - porta do servidor Node
   - `DEFAULT_GROUP_INTERVAL_MINUTES` - intervalo de agrupamento inicial (minutos)
   - `DEFAULT_UPDATE_INTERVAL_MINUTES` - intervalo de atualizacao incremental inicial (minutos)
   - `HISTORY_HOURS` - janela de historico mantida (padrao 24h)

   Esses dois ultimos intervalos (agrupamento e atualizacao) tambem podem ser alterados
   depois pela propria tela de configuracao de cada tabela, sem precisar reiniciar o servidor.

2. Instale as dependencias:

   ```
   npm install
   ```

3. Rode o servidor:

   ```
   npm start
   ```

4. Acesse `http://localhost:3000` para abrir a tela **"Tabelas monitoradas"**.

## Multiplas tabelas

- A pagina inicial (`/`) lista todas as tabelas monitoradas e permite cadastrar uma nova
  (schema + nome da tabela + coluna de timestamp + nome de exibicao opcional). Ao cadastrar,
  o sistema valida na hora que a tabela existe e tem colunas pareadas com `_Quality` antes de
  salvar - um nome digitado errado e rejeitado imediatamente, com mensagem clara.
- Cada tabela cadastrada tem sua propria configuracao de sensores (`table-config.html?table=<chave>`)
  e seu proprio painel (`dashboard.html?table=<chave>`), com cache em memoria e polling incremental
  totalmente independentes dos das outras tabelas.
- Remover uma tabela da lista para a coleta dela, mas mantem o arquivo de configuracao dela em
  disco (`config/tables/<chave>.settings.json`) - se a mesma tabela for cadastrada de novo depois,
  a configuracao anterior (sensores marcados, nomes de exibicao, setpoints) volta automaticamente.
- **Migracao automatica**: quem ja usava o sistema em versoes anteriores (tabela unica configurada
  via `DB_TABLE`/`DB_SCHEMA`/`DB_TIMESTAMP_COLUMN` no `.env`) tem essa tabela e a configuracao ja
  salva em `config/settings.json` migradas automaticamente para o novo formato multi-tabela na
  primeira execucao apos a atualizacao - nao e necessario recadastrar nada manualmente.

## Como funciona

- **Descoberta de colunas**: para cada tabela monitorada, o sistema le `INFORMATION_SCHEMA.COLUMNS`
  e pareia automaticamente cada coluna de sensor com sua coluna `_Quality` correspondente.
- **Tela de configuracao** (`table-config.html?table=<chave>`): lista todas as colunas encontradas
  na tabela com o ultimo valor lido, indicando se a leitura e confiavel
  (`*_Quality = RELIABLE_QUALITY_VALUE`), e permite marcar quais colunas devem ser expostas no
  endpoint de historico, alem dos intervalos de agrupamento e atualizacao. O botao "Marcar
  confiaveis" marca de uma vez todos os sensores cuja ultima leitura seja confiavel. Cada sensor
  tambem tem um campo de **nome de exibicao** (opcional - se vazio, usa o nome original da coluna)
  e dois **setpoints**, `Alarme` e `Vazamento` (padrao 10 e 20 - internamente ainda chamado de
  `evacuation` no JSON salvo, por compatibilidade), usados para classificar o estado do sensor. O
  botao "Salvar configuracao" persiste tudo em `config/tables/<chave>.settings.json` e reinicia o
  processo de coleta dessa tabela com os novos parametros (sem afetar as outras tabelas).
- **Estado do sensor**: a partir da ultima leitura de cada sensor habilitado, o dashboard e o
  painel do Grafana calculam um dos quatro estados (mutuamente exclusivos): `falha` (leitura
  negativa), `vazamento` (acima do setpoint de vazamento), `alarme` (acima do setpoint de
  alarme) ou normal. Os totais de sensores em cada estado aparecem nos indicadores no topo de
  ambas as telas.
- **Coleta incremental**: ao salvar (ou ao iniciar o servidor), o sistema carrega, para cada
  tabela monitorada, o historico completo das ultimas `HISTORY_HOURS` horas para as colunas
  habilitadas, agrupando por `groupIntervalMinutes` e trazendo o valor MAXIMO de cada sensor
  dentro do intervalo, desconsiderando leituras cuja coluna `*_Quality` nao seja confiavel. Depois
  disso, a cada `updateIntervalMinutes` minutos o sistema consulta **apenas os registros novos**
  daquela tabela (usando `WITH (NOLOCK)` e filtro por timestamp), atualiza os baldes
  correspondentes no cache em memoria dela e descarta os baldes que saíram da janela de 24 horas.
  Isso evita consultas pesadas repetidas no banco de producao. Cada tabela tem seu proprio timer
  de polling, independente das demais.
- **Salvar em tabela `_viewer`** (opcional, `SAVE_TO_DB_ENABLED=true`): a cada carga completa e a
  cada atualizacao incremental, o sistema replica o cache de cada tabela monitorada numa tabela
  `<tabela>_viewer` (ex.: `tab_monitor_sensores_amonia_BGE_viewer`), com a coluna de
  timestamp e um par de colunas `[Sensor]` / `[Sensor]_Quality` para cada sensor habilitado (mesmo
  padrao da tabela original). Como o cache so guarda o valor MAXIMO ja filtrado por leituras
  confiaveis, a coluna `_Quality` da tabela `_viewer` e sintetica: fica `RELIABLE_QUALITY_VALUE`
  quando ha valor no balde e `NULL` quando nao ha leitura confiavel naquele intervalo - ela nao
  reproduz o codigo de qualidade bruto do CLP. Util para consultar o historico agrupado direto via
  SQL, sem passar pela API. A tabela e criada automaticamente na primeira sincronizacao e ganha
  colunas novas conforme mais sensores sao habilitados - a tabela original nunca e alterada.
  `SAVE_TO_DB_HISTORY_MODE=false` (padrao) mantem a tabela `_viewer` espelhando exatamente a janela
  de `HISTORY_HOURS`, podando registros antigos a cada sincronizacao;
  `=true` faz a tabela so crescer, virando um historico permanente.
- **Endpoint HTTP** (`GET /api/tables/:tableKey/history`): retorna o JSON servido diretamente do
  cache em memoria daquela tabela (sem tocar no banco a cada requisicao), no formato:

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

| Metodo | Rota                              | Descricao |
|--------|------------------------------------|-----------|
| GET    | `/api/tables`                      | Lista as tabelas monitoradas |
| POST   | `/api/tables`                      | Cadastra uma nova tabela (valida contra o banco antes de salvar) |
| PATCH  | `/api/tables/:tableKey`             | Renomeia o nome de exibicao de uma tabela |
| DELETE | `/api/tables/:tableKey`             | Remove uma tabela da lista monitorada (mantem a config em disco) |
| GET    | `/api/tables/:tableKey/columns`     | Lista colunas de sensor da tabela: ultimo valor/qualidade, estado habilitado, nome de exibicao e setpoints |
| GET    | `/api/tables/:tableKey/config`      | Configuracao atualmente salva da tabela |
| POST   | `/api/tables/:tableKey/config`      | Salva colunas habilitadas + intervalos e reinicia a coleta dessa tabela |
| GET    | `/api/tables/:tableKey/history`     | Historico agrupado (24h) das colunas habilitadas dessa tabela, servido do cache |
| GET    | `/api/health`                       | Healthcheck simples |

## Estrutura

```
src/
  config/     # env.js (leitura do .env), tableRegistry.js (config/tables.json + migracao legada)
              # e settingsStore.js (config/tables/<chave>.settings.json)
  db/         # pool.js (pool compartilhado), schema.js (descoberta de colunas por tabela)
              # e history.js (queries agrupadas por tabela)
  services/   # scheduler.js (factory: cache em memoria + polling incremental por tabela),
              # tableManager.js (orquestra uma instancia de scheduler por tabela) e
              # dbWriter.js (tabela _viewer por tabela)
  routes/     # rotas Express: tables.js (gestao da lista), tableScope.js (middleware de
              # resolucao de :tableKey), columns.js/config.js/history.js (escopados por tabela)
  server.js   # bootstrap
public/       # tela inicial (index.html/landing.js), configuracao por tabela
              # (table-config.html/app.js) e dashboard (dashboard.html/dashboard.js)
config/       # tables.json (registro de tabelas) e tables/<chave>.settings.json - git-ignored
```
