const SVG_NS = 'http://www.w3.org/2000/svg';
const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)'
];
const MAX_SELECTION = 8;
const REFRESH_MS = 60000;

const headerSubtitle = document.getElementById('headerSubtitle');
const kpiRow = document.getElementById('kpiRow');
const donutWrap = document.getElementById('donutWrap');
const highlightWrap = document.getElementById('highlightWrap');
const highlightTitle = document.getElementById('highlightTitle');
const failureTimelineWrap = document.getElementById('failureTimelineWrap');
const searchInput = document.getElementById('searchInput');
const selectionHint = document.getElementById('selectionHint');
const cardSections = document.getElementById('cardSections');
const detailSections = document.getElementById('detailSections');

const ICON_SHAPES = {
  signal: [
    { tag: 'circle', attrs: { cx: 12, cy: 19, r: 1.3, fill: 'currentColor', stroke: 'none' } },
    { tag: 'path', attrs: { d: 'M8 16.5a5.6 5.6 0 0 1 8 0' } },
    { tag: 'path', attrs: { d: 'M4.5 13a10.5 10.5 0 0 1 15 0' } }
  ],
  'alert-triangle': [
    { tag: 'path', attrs: { d: 'M12 3.5 21.5 20 2.5 20 Z' } },
    { tag: 'line', attrs: { x1: 12, y1: 9.5, x2: 12, y2: 14.5 } },
    { tag: 'circle', attrs: { cx: 12, cy: 17.3, r: 0.9, fill: 'currentColor', stroke: 'none' } }
  ],
  bell: [
    { tag: 'path', attrs: { d: 'M12 4.5a5.5 5.5 0 0 0-5.5 5.5c0 5.5-2.3 7-2.3 7h15.6s-2.3-1.5-2.3-7A5.5 5.5 0 0 0 12 4.5Z' } },
    { tag: 'path', attrs: { d: 'M9.8 19.5a2.3 2.3 0 0 0 4.4 0' } }
  ],
  'alert-octagon': [
    { tag: 'path', attrs: { d: 'M8 2.5h8L21.5 8v8L16 21.5H8L2.5 16V8Z' } },
    { tag: 'line', attrs: { x1: 12, y1: 8.5, x2: 12, y2: 13 } },
    { tag: 'circle', attrs: { cx: 12, cy: 16, r: 0.9, fill: 'currentColor', stroke: 'none' } }
  ],
  'trending-up': [
    { tag: 'polyline', attrs: { points: '3,17 9.5,10.5 13.5,14.5 21,6' } },
    { tag: 'polyline', attrs: { points: '15,6 21,6 21,12' } }
  ]
};

function buildStatIcon(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  for (const shape of ICON_SHAPES[kind] || []) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    for (const key of Object.keys(shape.attrs)) el.setAttribute(key, shape.attrs[key]);
    svg.appendChild(el);
  }
  return svg;
}

let latestHistory = null;
let latestColumns = null;
let selectedNames = new Set();
let selectionInitialized = false;
let searchTerm = '';
let currentTop = null;
let currentColMeta = new Map();
let currentMaxSensorValue = undefined;
let currentStatus = { counts: { failure: 0, alarm: 0, evacuation: 0 }, total: 0, statusByName: new Map() };

// ---------- formatting helpers ----------

function formatValue(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toFixed(2);
}

function formatTimeShort(t) {
  return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(t) {
  return new Date(t).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function familyOf(name) {
  const m = name.match(/^(.*?)(\d+)$/);
  return m ? m[1] : name;
}

function prettyFamily(family) {
  return family.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim();
}

// Stable color per sensor identity (derived from its numeric suffix), so a
// series keeps the same hue regardless of which other sensors are selected.
function seriesColor(name) {
  const m = name.match(/(\d+)$/);
  const n = m ? parseInt(m[1], 10) : 0;
  const idx = ((n - 1) % SERIES_COLORS.length + SERIES_COLORS.length) % SERIES_COLORS.length;
  return SERIES_COLORS[idx];
}

function displayNameOf(meta, name) {
  return meta && meta.displayName ? meta.displayName : name;
}

// Scans every enabled sensor's 24h series and returns the single highest
// VALID reading found (ignora leituras acima do limite maximo, tratadas
// como erro de sensor), ou null se nao houver nenhum dado valido ainda.
function computeTopReading(hist, colMetaMap, maxSensorValue) {
  let top = null;
  for (const name of hist.columns) {
    const points = hist.series[name] || [];
    for (const pt of points) {
      if (pt.value === null || pt.value === undefined) continue;
      if (typeof maxSensorValue === 'number' && pt.value > maxSensorValue) continue;
      if (!top || pt.value > top.value) {
        top = { name, displayName: displayNameOf(colMetaMap.get(name), name), value: pt.value, timestamp: pt.timestamp };
      }
    }
  }
  return top;
}

// Estado de um sensor a partir da sua ultima leitura:
//  - failure: leitura negativa OU acima do limite maximo (fora de faixa / falha do sensor)
//  - evacuation: acima do setpoint de evacuacao
//  - alarm: acima do setpoint de alarme (e abaixo do de evacuacao)
//  - normal: dentro da faixa esperada
// Mutuamente exclusivos - nunca mais de um se aplica ao mesmo tempo.
function sensorStatus(value, meta, maxSensorValue) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'unknown';
  if (value < 0) return 'failure';
  if (typeof maxSensorValue === 'number' && value > maxSensorValue) return 'failure';
  const alarm = meta ? meta.alarmSetpoint : 10;
  const evacuation = meta ? meta.evacuationSetpoint : 20;
  if (typeof evacuation === 'number' && value > evacuation) return 'evacuation';
  if (typeof alarm === 'number' && value > alarm) return 'alarm';
  return 'normal';
}

function computeStatusSummary(hist, colMetaMap, maxSensorValue) {
  const counts = { failure: 0, alarm: 0, evacuation: 0 };
  const statusByName = new Map();
  for (const name of hist.columns) {
    const points = hist.series[name] || [];
    const last = points.length ? points[points.length - 1] : null;
    const status = sensorStatus(last ? last.value : null, colMetaMap.get(name), maxSensorValue);
    statusByName.set(name, status);
    if (status === 'failure' || status === 'alarm' || status === 'evacuation') counts[status]++;
  }
  return { counts, total: hist.columns.length, statusByName };
}

function defaultHintText() {
  return `Marque ate ${MAX_SELECTION} sensores ("Comparar") para ver o grafico comparativo. Selecionados: ${selectedNames.size}/${MAX_SELECTION}.`;
}

function setHint(text) {
  selectionHint.textContent = text;
}

// ---------- nice ticks ----------

function niceNum(range, round) {
  if (range === 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

function niceTicks(min, max, count) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const range = niceNum(max - min, false);
  const step = niceNum(range / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 1000; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

// ---------- gap-aware line segments ----------

function buildSegmentsByGap(points, expectedGapMs) {
  const segments = [];
  let current = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && points[i].t - points[i - 1].t > expectedGapMs * 1.5) {
      if (current.length) segments.push(current);
      current = [];
    }
    current.push(points[i]);
  }
  if (current.length) segments.push(current);
  return segments;
}

function pathFromSegment(seg, xScale, yScale) {
  return seg.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.t).toFixed(2)} ${yScale(p.v).toFixed(2)}`).join(' ');
}

function areaPathFromSegment(seg, xScale, yScale, baselineY) {
  if (seg.length < 2) return '';
  const line = pathFromSegment(seg, xScale, yScale);
  const lastX = xScale(seg[seg.length - 1].t);
  const firstX = xScale(seg[0].t);
  return `${line} L ${lastX.toFixed(2)} ${baselineY} L ${firstX.toFixed(2)} ${baselineY} Z`;
}

function nearestTimestamp(target, arr) {
  let lo = 0;
  let hi = arr.length - 1;
  if (target <= arr[0]) return arr[0];
  if (target >= arr[hi]) return arr[hi];
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] === target) return arr[mid];
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const a = arr[lo - 1];
  const b = arr[lo];
  if (a === undefined) return b;
  return target - a <= b - target ? a : b;
}

// ---------- data loading ----------

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

async function loadData() {
  try {
    const [hist, cols] = await Promise.all([fetchJson('/api/history'), fetchJson('/api/columns')]);
    latestHistory = hist;
    latestColumns = cols;
    render();
  } catch (err) {
    headerSubtitle.textContent = 'Erro ao atualizar dados: ' + err.message;
  }
}

// ---------- render ----------

function render() {
  const hist = latestHistory;
  const cols = latestColumns;

  headerSubtitle.textContent =
    `Dados atualizados as ${formatDateTime(hist.generatedAt)} (cache do servidor) — ` +
    `agrupado a cada ${hist.groupIntervalMinutes} min, atualizado a cada ${hist.updateIntervalMinutes} min.`;

  currentColMeta = new Map((cols.columns || []).map((c) => [c.name, c]));
  currentMaxSensorValue = cols.maxSensorValue;
  currentTop = computeTopReading(hist, currentColMeta, currentMaxSensorValue);
  currentStatus = computeStatusSummary(hist, currentColMeta, currentMaxSensorValue);

  renderKpiRow(hist, currentColMeta, currentTop, currentStatus);
  renderDonut(currentStatus);
  renderTrendChart(hist, currentColMeta, currentMaxSensorValue);
  renderFailureTimeline(hist, currentColMeta, currentMaxSensorValue);

  if (hist.columns.length === 0) {
    cardSections.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.append('Nenhum sensor habilitado. Va em ');
    const a = document.createElement('a');
    a.href = 'index.html';
    a.textContent = 'Configuracao';
    p.appendChild(a);
    p.append(' para selecionar os sensores.');
    cardSections.appendChild(p);
    detailSections.innerHTML = '';
    setHint('');
    return;
  }

  if (!selectionInitialized) {
    hist.columns.slice(0, 4).forEach((n) => selectedNames.add(n));
    selectionInitialized = true;
  } else {
    for (const n of [...selectedNames]) {
      if (!hist.columns.includes(n)) selectedNames.delete(n);
    }
  }

  setHint(defaultHintText());
  renderCards(hist, currentColMeta, currentTop, currentStatus);
  renderDetailSections(hist, currentColMeta);
}

function buildKpiTile(opts) {
  const tile = document.createElement(opts.onClick ? 'button' : 'div');
  tile.className = 'kpi-tile kpi-tile--' + opts.kind;
  if (opts.onClick) {
    tile.type = 'button';
    tile.addEventListener('click', opts.onClick);
  }

  const text = document.createElement('div');
  text.className = 'kpi-tile-text';

  const label = document.createElement('p');
  label.className = 'kpi-tile-label';
  label.textContent = opts.label;
  text.appendChild(label);

  const value = document.createElement('p');
  value.className = 'kpi-tile-value';
  value.textContent = opts.value;
  text.appendChild(value);

  if (opts.subPill) {
    const sub = document.createElement('span');
    sub.className = 'kpi-tile-sub pill';
    sub.textContent = opts.subPill;
    text.appendChild(sub);
  } else if (opts.sub) {
    const sub = document.createElement('p');
    sub.className = 'kpi-tile-sub';
    sub.textContent = opts.sub;
    text.appendChild(sub);
  }

  tile.appendChild(text);

  const iconWrap = document.createElement('div');
  iconWrap.className = 'kpi-tile-icon';
  iconWrap.appendChild(buildStatIcon(opts.icon));
  tile.appendChild(iconWrap);

  return tile;
}

function renderKpiRow(hist, colMetaMap, top, status) {
  kpiRow.innerHTML = '';

  // "Online" = sinal confiavel (*_Quality = 192) E sem falha (valor nao negativo).
  const onlineCount = hist.columns.filter((n) => {
    const meta = colMetaMap.get(n);
    const reliable = Boolean(meta && meta.reliable);
    const isFailure = status.statusByName.get(n) === 'failure';
    return reliable && !isFailure;
  }).length;
  const onlinePct = hist.columns.length ? Math.round((onlineCount / hist.columns.length) * 100) : 0;
  const pct = (n) => (status.total ? Math.round((n / status.total) * 100) : 0);

  kpiRow.appendChild(
    buildKpiTile({
      kind: 'good',
      icon: 'signal',
      label: 'Total de sensores',
      value: String(hist.columns.length),
      subPill: `${onlineCount} online (${onlinePct}%)`
    })
  );

  kpiRow.appendChild(
    buildKpiTile({
      kind: 'serious',
      icon: 'alert-triangle',
      label: 'Sensor em falha',
      value: String(status.counts.failure),
      sub: `${pct(status.counts.failure)}% do total`
    })
  );

  kpiRow.appendChild(
    buildKpiTile({
      kind: 'warning',
      icon: 'bell',
      label: 'Alarmes ativos',
      value: String(status.counts.alarm),
      sub: `${pct(status.counts.alarm)}% do total`
    })
  );

  kpiRow.appendChild(
    buildKpiTile({
      kind: 'critical',
      icon: 'alert-octagon',
      label: 'Em evacuacao',
      value: String(status.counts.evacuation),
      sub: `${pct(status.counts.evacuation)}% do total`
    })
  );

  kpiRow.appendChild(
    buildKpiTile({
      kind: 'info',
      icon: 'trending-up',
      label: 'Concentracao maxima',
      value: top ? formatValue(top.value) : '—',
      sub: top ? top.displayName : 'Sem leituras confiaveis',
      onClick: top
        ? () => {
            const card = document.querySelector(`.sensor-card[data-sensor="${CSS.escape(top.name)}"]`);
            if (!card) return;
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.remove('is-flash');
            void card.offsetWidth;
            card.classList.add('is-flash');
          }
        : undefined
    })
  );
}

function buildDonutChart(status) {
  const wrap = document.createElement('div');
  wrap.className = 'donut-wrap';

  const total = status.total;
  const normal = Math.max(0, total - status.counts.alarm - status.counts.evacuation - status.counts.failure);
  const segments = [
    { label: 'Normal', count: normal, color: 'var(--status-good)' },
    { label: 'Alarme', count: status.counts.alarm, color: 'var(--status-warning)' },
    { label: 'Evacuacao', count: status.counts.evacuation, color: 'var(--status-critical)' },
    { label: 'Falha', count: status.counts.failure, color: 'var(--status-serious)' }
  ];

  const size = 160;
  const r = 60;
  const cx = 80;
  const cy = 80;
  const strokeWidth = 20;
  const circumference = 2 * Math.PI * r;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'donut-svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);

  const track = document.createElementNS(SVG_NS, 'circle');
  track.setAttribute('cx', String(cx));
  track.setAttribute('cy', String(cy));
  track.setAttribute('r', String(r));
  track.setAttribute('fill', 'none');
  track.setAttribute('stroke', 'var(--gridline)');
  track.setAttribute('stroke-width', String(strokeWidth));
  svg.appendChild(track);

  let offset = 0;
  for (const seg of segments) {
    if (seg.count <= 0 || total <= 0) continue;
    const len = (seg.count / total) * circumference;
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', String(cx));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(r));
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', seg.color);
    circle.setAttribute('stroke-width', String(strokeWidth));
    circle.setAttribute('stroke-dasharray', `${len.toFixed(2)} ${(circumference - len).toFixed(2)}`);
    circle.setAttribute('stroke-dashoffset', String(-offset));
    circle.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    svg.appendChild(circle);
    offset += len;
  }

  const totalText = document.createElementNS(SVG_NS, 'text');
  totalText.setAttribute('x', String(cx));
  totalText.setAttribute('y', String(cy - 2));
  totalText.setAttribute('text-anchor', 'middle');
  totalText.setAttribute('class', 'donut-total');
  totalText.textContent = String(total);
  svg.appendChild(totalText);

  const totalLabel = document.createElementNS(SVG_NS, 'text');
  totalLabel.setAttribute('x', String(cx));
  totalLabel.setAttribute('y', String(cy + 16));
  totalLabel.setAttribute('text-anchor', 'middle');
  totalLabel.setAttribute('class', 'donut-total-label');
  totalLabel.textContent = 'Total';
  svg.appendChild(totalLabel);

  wrap.appendChild(svg);

  const legend = document.createElement('div');
  legend.className = 'donut-legend';
  for (const seg of segments) {
    const item = document.createElement('div');
    item.className = 'donut-legend-item';
    const dot = document.createElement('span');
    dot.className = 'donut-legend-dot';
    dot.style.background = seg.color;
    const label = document.createElement('span');
    label.textContent = seg.label;
    const count = document.createElement('span');
    count.className = 'donut-legend-count';
    count.textContent = `(${seg.count})`;
    item.appendChild(dot);
    item.appendChild(label);
    item.appendChild(count);
    legend.appendChild(item);
  }
  wrap.appendChild(legend);

  return wrap;
}

function renderDonut(status) {
  donutWrap.innerHTML = '';
  donutWrap.appendChild(buildDonutChart(status));
}

// Um ponto e valido para o grafico de tendencia quando esta entre 0 (exclusivo)
// e o limite maximo configurado (MAX_SENSOR_VALUE) - leituras acima do limite
// sao tratadas como erro de sensor, iguais a leituras negativas.
function isValidTrendPoint(value, maxSensorValue) {
  return typeof value === 'number' && value > 0 && (typeof maxSensorValue !== 'number' || value <= maxSensorValue);
}

// Sensores que tiveram pelo menos uma leitura valida (>0 e <= limite maximo)
// nas ultimas 24h (exclui sensores sem dados/nao confiaveis, sensores em
// falha permanente e sensores que nunca saem do estouro do limite maximo).
function qualifyingTrendSensors(hist, maxSensorValue) {
  return hist.columns.filter((name) => {
    const points = hist.series[name] || [];
    return points.some((p) => isValidTrendPoint(p.value, maxSensorValue));
  });
}

function renderTrendChart(hist, colMetaMap, maxSensorValue) {
  highlightWrap.innerHTML = '';

  const names = qualifyingTrendSensors(hist, maxSensorValue);
  if (names.length === 0) {
    highlightTitle.textContent = 'Concentracao';
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Nenhum sensor com leitura acima de 0 nas ultimas 24h.';
    highlightWrap.appendChild(p);
    return;
  }

  highlightTitle.textContent = `Concentracao — sensores ativos (${names.length})`;

  // Pontos negativos ou acima do limite maximo viram lacunas no grafico
  // (nao sao plotados), igual as leituras marcadas nao confiaveis pelo *_Quality.
  const seriesList = names.map((name) => ({
    name,
    displayName: displayNameOf(colMetaMap.get(name), name),
    points: (hist.series[name] || [])
      .filter((pt) => isValidTrendPoint(pt.value, maxSensorValue))
      .map((pt) => ({ t: new Date(pt.timestamp).getTime(), v: pt.value }))
  }));
  const allPoints = seriesList.flatMap((s) => s.points);

  const width = 760;
  const height = 260;
  const margin = { top: 12, right: 16, bottom: 30, left: 50 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const minT = Math.min(...allPoints.map((p) => p.t));
  const maxT = Math.max(...allPoints.map((p) => p.t));
  const yTicks = niceTicks(Math.min(...allPoints.map((p) => p.v)), Math.max(...allPoints.map((p) => p.v)), 5);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const xScale = (t) => margin.left + (maxT === minT ? 0 : ((t - minT) / (maxT - minT)) * plotWidth);
  const yScale = (v) => margin.top + plotHeight - (yMax === yMin ? 0 : ((v - yMin) / (yMax - yMin)) * plotHeight);

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  wrap.appendChild(svg);

  for (const tick of yTicks) {
    const y = yScale(tick);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'gridline');
    line.setAttribute('x1', String(margin.left));
    line.setAttribute('x2', String(width - margin.right));
    line.setAttribute('y1', y.toFixed(2));
    line.setAttribute('y2', y.toFixed(2));
    svg.appendChild(line);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'axis-label');
    label.setAttribute('x', String(margin.left - 8));
    label.setAttribute('y', (y + 3).toFixed(2));
    label.setAttribute('text-anchor', 'end');
    label.textContent = tick.toString();
    svg.appendChild(label);
  }

  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('class', 'baseline');
  baseline.setAttribute('x1', String(margin.left));
  baseline.setAttribute('x2', String(width - margin.right));
  baseline.setAttribute('y1', String(margin.top + plotHeight));
  baseline.setAttribute('y2', String(margin.top + plotHeight));
  svg.appendChild(baseline);

  const xTickCount = 6;
  for (let i = 0; i <= xTickCount; i++) {
    const t = minT + ((maxT - minT) * i) / xTickCount;
    const x = xScale(t);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'axis-label');
    label.setAttribute('x', x.toFixed(2));
    label.setAttribute('y', String(height - margin.bottom + 16));
    label.setAttribute('text-anchor', i === 0 ? 'start' : i === xTickCount ? 'end' : 'middle');
    label.textContent = formatTimeShort(t);
    svg.appendChild(label);
  }

  const expectedGapMs = hist.groupIntervalMinutes * 60 * 1000;
  const pointMaps = [];
  for (const series of seriesList) {
    const color = seriesColor(series.name);
    for (const seg of buildSegmentsByGap(series.points, expectedGapMs)) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'series-line');
      path.setAttribute('d', pathFromSegment(seg, xScale, yScale));
      path.setAttribute('stroke', color);
      path.style.strokeWidth = '1.3';
      path.style.strokeOpacity = '0.85';
      svg.appendChild(path);
    }
    if (series.points.length > 0) {
      const last = series.points[series.points.length - 1];
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'series-dot');
      dot.setAttribute('cx', xScale(last.t).toFixed(2));
      dot.setAttribute('cy', yScale(last.v).toFixed(2));
      dot.setAttribute('r', '2.5');
      dot.setAttribute('fill', color);
      svg.appendChild(dot);
    }
    pointMaps.push(new Map(series.points.map((p) => [p.t, p.v])));
  }

  const crosshair = document.createElementNS(SVG_NS, 'line');
  crosshair.setAttribute('class', 'crosshair');
  crosshair.setAttribute('y1', String(margin.top));
  crosshair.setAttribute('y2', String(margin.top + plotHeight));
  svg.appendChild(crosshair);

  const hoverRect = document.createElementNS(SVG_NS, 'rect');
  hoverRect.setAttribute('class', 'hover-rect');
  hoverRect.setAttribute('x', String(margin.left));
  hoverRect.setAttribute('y', String(margin.top));
  hoverRect.setAttribute('width', String(plotWidth));
  hoverRect.setAttribute('height', String(plotHeight));
  svg.appendChild(hoverRect);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  wrap.appendChild(tooltip);

  const masterTimestamps = [...new Set(allPoints.map((p) => p.t))].sort((a, b) => a - b);
  let lastShownT = null;

  function showTooltip(evt) {
    if (masterTimestamps.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((evt.clientX - rect.left) / rect.width) * width;
    const t = minT + ((svgX - margin.left) / plotWidth) * (maxT - minT);
    const nearestT = nearestTimestamp(t, masterTimestamps);

    crosshair.setAttribute('x1', xScale(nearestT).toFixed(2));
    crosshair.setAttribute('x2', xScale(nearestT).toFixed(2));
    crosshair.style.opacity = '1';

    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = `${evt.clientX - wrapRect.left}px`;
    tooltip.style.top = `${evt.clientY - wrapRect.top - 12}px`;
    tooltip.style.opacity = '1';

    // Reconstruir as linhas do tooltip so quando o balde de tempo muda -
    // evita recriar dezenas/centenas de nos de DOM a cada pixel do mouse.
    if (nearestT === lastShownT) return;
    lastShownT = nearestT;

    const rows = [];
    seriesList.forEach((series, idx) => {
      const v = pointMaps[idx].get(nearestT);
      if (v === undefined) return;
      rows.push({ name: series.displayName, value: v, color: seriesColor(series.name) });
    });
    rows.sort((a, b) => b.value - a.value);

    tooltip.innerHTML = '';
    const timeEl = document.createElement('div');
    timeEl.className = 'tooltip-time';
    timeEl.textContent = formatDateTime(nearestT);
    tooltip.appendChild(timeEl);

    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'tooltip-row';
      const key = document.createElement('span');
      key.className = 'tooltip-key';
      key.style.background = row.color;
      const nameEl = document.createElement('span');
      nameEl.textContent = row.name;
      const valueEl = document.createElement('span');
      valueEl.className = 'tooltip-value';
      valueEl.textContent = formatValue(row.value);
      rowEl.appendChild(key);
      rowEl.appendChild(nameEl);
      rowEl.appendChild(valueEl);
      tooltip.appendChild(rowEl);
    }
  }
  function hideTooltip() {
    crosshair.style.opacity = '0';
    tooltip.style.opacity = '0';
    lastShownT = null;
  }
  hoverRect.addEventListener('pointermove', showTooltip);
  hoverRect.addEventListener('pointerleave', hideTooltip);

  highlightWrap.appendChild(wrap);
}

// ---------- failure timeline (barras: sensores em falha por horario) ----------

// Para cada balde de tempo (mesma janela de agrupamento do resto do sistema),
// lista os sensores que estavam em falha (valor negativo ou acima do limite
// maximo) NAQUELE momento - nao so na ultima leitura.
function computeFailureTimeline(hist, maxSensorValue) {
  const namesByBucket = new Map(); // t -> [nome, ...]
  const allBuckets = new Set();
  for (const name of hist.columns) {
    for (const pt of hist.series[name] || []) {
      const t = new Date(pt.timestamp).getTime();
      allBuckets.add(t);
      const v = pt.value;
      const isFailure = typeof v === 'number' && (v < 0 || (typeof maxSensorValue === 'number' && v > maxSensorValue));
      if (!isFailure) continue;
      if (!namesByBucket.has(t)) namesByBucket.set(t, []);
      namesByBucket.get(t).push(name);
    }
  }
  const buckets = [...allBuckets].sort((a, b) => a - b);
  return { buckets, namesByBucket };
}

function renderFailureTimeline(hist, colMetaMap, maxSensorValue) {
  failureTimelineWrap.innerHTML = '';

  const { buckets, namesByBucket } = computeFailureTimeline(hist, maxSensorValue);
  if (buckets.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Sem dados nas ultimas 24h.';
    failureTimelineWrap.appendChild(p);
    return;
  }

  const counts = buckets.map((t) => (namesByBucket.get(t) || []).length);
  const width = 1200;
  const height = 170;
  const margin = { top: 12, right: 16, bottom: 30, left: 34 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const minT = buckets[0];
  const maxT = buckets[buckets.length - 1];
  const yTicks = niceTicks(0, Math.max(1, ...counts), 4);
  const yMax = yTicks[yTicks.length - 1] || 1;

  const slotWidth = plotWidth / buckets.length;
  const barWidth = Math.max(1, slotWidth * 0.7);
  const xForIndex = (i) => margin.left + slotWidth * i;
  const yScale = (v) => margin.top + plotHeight - (v / yMax) * plotHeight;

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chart-svg chart-svg--bars');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  wrap.appendChild(svg);

  for (const tick of yTicks) {
    const y = yScale(tick);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'gridline');
    line.setAttribute('x1', String(margin.left));
    line.setAttribute('x2', String(width - margin.right));
    line.setAttribute('y1', y.toFixed(2));
    line.setAttribute('y2', y.toFixed(2));
    svg.appendChild(line);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'axis-label');
    label.setAttribute('x', String(margin.left - 8));
    label.setAttribute('y', (y + 3).toFixed(2));
    label.setAttribute('text-anchor', 'end');
    label.textContent = tick.toString();
    svg.appendChild(label);
  }

  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('class', 'baseline');
  baseline.setAttribute('x1', String(margin.left));
  baseline.setAttribute('x2', String(width - margin.right));
  baseline.setAttribute('y1', String(margin.top + plotHeight));
  baseline.setAttribute('y2', String(margin.top + plotHeight));
  svg.appendChild(baseline);

  const xTickCount = 6;
  for (let i = 0; i <= xTickCount; i++) {
    const t = minT + ((maxT - minT) * i) / xTickCount;
    const x = margin.left + (plotWidth * i) / xTickCount;
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'axis-label');
    label.setAttribute('x', x.toFixed(2));
    label.setAttribute('y', String(height - margin.bottom + 16));
    label.setAttribute('text-anchor', i === 0 ? 'start' : i === xTickCount ? 'end' : 'middle');
    label.textContent = formatTimeShort(t);
    svg.appendChild(label);
  }

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  wrap.appendChild(tooltip);

  buckets.forEach((t, i) => {
    const count = counts[i];
    const x = xForIndex(i);
    const barHeight = (count / yMax) * plotHeight;
    const barY = margin.top + plotHeight - barHeight;

    if (count > 0) {
      const bar = document.createElementNS(SVG_NS, 'rect');
      bar.setAttribute('class', 'failure-bar');
      bar.setAttribute('x', x.toFixed(2));
      bar.setAttribute('y', barY.toFixed(2));
      bar.setAttribute('width', barWidth.toFixed(2));
      bar.setAttribute('height', Math.max(1, barHeight).toFixed(2));
      bar.setAttribute('rx', '1');
      svg.appendChild(bar);
    }

    // Alvo de hover maior que a barra visivel (facilita acertar com o mouse).
    const hit = document.createElementNS(SVG_NS, 'rect');
    hit.setAttribute('class', 'failure-bar-hit');
    hit.setAttribute('x', x.toFixed(2));
    hit.setAttribute('y', String(margin.top));
    hit.setAttribute('width', Math.max(barWidth, slotWidth).toFixed(2));
    hit.setAttribute('height', String(plotHeight));
    svg.appendChild(hit);

    hit.addEventListener('pointerenter', () => {
      const names = namesByBucket.get(t) || [];

      tooltip.innerHTML = '';
      const timeEl = document.createElement('div');
      timeEl.className = 'tooltip-time';
      timeEl.textContent = formatDateTime(t);
      tooltip.appendChild(timeEl);

      if (names.length === 0) {
        const row = document.createElement('div');
        row.className = 'tooltip-row';
        const span = document.createElement('span');
        span.textContent = 'Nenhum sensor em falha';
        row.appendChild(span);
        tooltip.appendChild(row);
      } else {
        for (const name of names) {
          const row = document.createElement('div');
          row.className = 'tooltip-row';
          const nameEl = document.createElement('span');
          nameEl.textContent = displayNameOf(colMetaMap.get(name), name);
          row.appendChild(nameEl);
          tooltip.appendChild(row);
        }
      }

      const svgRect = svg.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const scaleX = svgRect.width / width;
      const scaleY = svgRect.height / height;
      const originX = svgRect.left - wrapRect.left;
      const originY = svgRect.top - wrapRect.top;
      tooltip.style.left = `${originX + (x + barWidth / 2) * scaleX}px`;
      tooltip.style.top = `${originY + barY * scaleY - 8}px`;
      tooltip.style.opacity = '1';
    });
    hit.addEventListener('pointerleave', () => {
      tooltip.style.opacity = '0';
    });
  });

  failureTimelineWrap.appendChild(wrap);
}

function makeBadge(kind, text) {
  const el = document.createElement('span');
  el.className = 'badge ' + kind;
  el.textContent = text;
  return el;
}

function renderCards(hist, colMetaMap, topReading, status) {
  const term = searchTerm.trim().toLowerCase();
  const names = hist.columns.filter((n) => {
    const label = displayNameOf(colMetaMap.get(n), n).toLowerCase();
    return n.toLowerCase().includes(term) || label.includes(term);
  });

  cardSections.innerHTML = '';
  if (names.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Nenhum sensor encontrado para o filtro atual.';
    cardSections.appendChild(p);
    return;
  }

  const groups = new Map();
  for (const name of names) {
    const fam = familyOf(name);
    if (!groups.has(fam)) groups.set(fam, []);
    groups.get(fam).push(name);
  }

  for (const [fam, groupNames] of groups) {
    const block = document.createElement('div');
    block.className = 'family-block';

    const heading = document.createElement('h3');
    heading.className = 'family-heading';
    heading.textContent = prettyFamily(fam);
    const count = document.createElement('span');
    count.className = 'family-count';
    count.textContent = `(${groupNames.length})`;
    heading.appendChild(count);
    block.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'card-grid';
    for (const name of groupNames) {
      const points = (hist.series[name] || []).map((pt) => ({ t: new Date(pt.timestamp).getTime(), v: pt.value }));
      const isTop = Boolean(topReading && topReading.name === name);
      const sensorStat = status.statusByName.get(name) || 'normal';
      grid.appendChild(buildCard(name, points, colMetaMap.get(name), hist.groupIntervalMinutes, isTop, sensorStat));
    }
    block.appendChild(grid);
    cardSections.appendChild(block);
  }
}

function buildCard(name, points, meta, groupIntervalMinutes, isTop, status) {
  const card = document.createElement('div');
  const statusClass = status === 'alarm' || status === 'evacuation' || status === 'failure' ? ' status-' + status : '';
  card.className =
    'sensor-card' +
    (selectedNames.has(name) ? ' is-selected' : '') +
    (isTop ? ' is-top' : '') +
    statusClass;
  card.dataset.sensor = name;

  const top = document.createElement('div');
  top.className = 'card-top';

  const displayName = displayNameOf(meta, name);
  const nameEl = document.createElement('span');
  nameEl.className = 'card-name';
  nameEl.title = displayName !== name ? `${displayName} (${name})` : name;
  nameEl.textContent = displayName;
  top.appendChild(nameEl);

  const badges = document.createElement('span');
  badges.className = 'card-badges';

  if (status === 'evacuation') {
    badges.appendChild(makeBadge('critical', 'Evacuacao'));
  } else if (status === 'alarm') {
    badges.appendChild(makeBadge('warning', 'Alarme'));
  } else if (status === 'failure') {
    badges.appendChild(makeBadge('serious', 'Em falha'));
  }

  if (isTop) {
    badges.appendChild(makeBadge('neutral', 'Maior 24h'));
  }

  const reliable = meta ? meta.reliable : false;
  badges.appendChild(makeBadge(reliable ? 'ok' : 'bad', reliable ? 'Confiavel' : 'Nao confiavel'));

  top.appendChild(badges);
  card.appendChild(top);

  const valueTextClass =
    status === 'evacuation' ? ' text-critical' : status === 'alarm' ? ' text-warning' : status === 'failure' ? ' text-serious' : '';
  const valueEl = document.createElement('div');
  valueEl.className = 'card-value' + valueTextClass;
  const last = points.length ? points[points.length - 1] : null;
  valueEl.textContent = last ? formatValue(last.v) : '—';
  card.appendChild(valueEl);

  card.appendChild(buildSparkline(points, groupIntervalMinutes, status));

  const label = document.createElement('label');
  label.className = 'card-select';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = selectedNames.has(name);
  checkbox.addEventListener('change', () => toggleSelection(name, checkbox));
  label.appendChild(checkbox);
  label.appendChild(document.createTextNode('Comparar'));
  card.appendChild(label);

  return card;
}

function toggleSelection(name, checkbox) {
  if (checkbox.checked) {
    if (selectedNames.size >= MAX_SELECTION) {
      checkbox.checked = false;
      setHint(`Maximo de ${MAX_SELECTION} sensores selecionados. Desmarque um antes de adicionar outro.`);
      return;
    }
    selectedNames.add(name);
  } else {
    selectedNames.delete(name);
  }
  setHint(defaultHintText());
  renderCards(latestHistory, currentColMeta, currentTop, currentStatus);
  renderDetailSections(latestHistory, currentColMeta);
}

function buildSparkline(points, groupIntervalMinutes, status) {
  const color =
    status === 'evacuation'
      ? 'var(--status-critical)'
      : status === 'alarm'
        ? 'var(--status-warning)'
        : status === 'failure'
          ? 'var(--status-serious)'
          : 'var(--series-1)';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'sparkline');
  svg.setAttribute('viewBox', '0 0 240 56');
  svg.setAttribute('preserveAspectRatio', 'none');

  if (points.length === 0) {
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', 8);
    text.setAttribute('y', 30);
    text.setAttribute('class', 'spark-empty');
    text.textContent = 'Sem leituras confiaveis nas ultimas 24h';
    svg.appendChild(text);
    return svg;
  }

  const ts = points.map((p) => p.t);
  const vs = points.map((p) => p.v);
  const minT = Math.min(...ts);
  const maxT = Math.max(...ts);
  let minV = Math.min(...vs);
  let maxV = Math.max(...vs);
  if (minV === maxV) {
    minV -= 1;
    maxV += 1;
  }

  const padX = 4;
  const padTop = 6;
  const padBottom = 6;
  const xScale = (t) => padX + (maxT === minT ? 0 : ((t - minT) / (maxT - minT)) * (240 - padX * 2));
  const yScale = (v) => 56 - padBottom - ((v - minV) / (maxV - minV)) * (56 - padTop - padBottom);
  const baselineY = 56 - padBottom;

  const expectedGapMs = groupIntervalMinutes * 60 * 1000;
  for (const seg of buildSegmentsByGap(points, expectedGapMs)) {
    const area = document.createElementNS(SVG_NS, 'path');
    area.setAttribute('d', areaPathFromSegment(seg, xScale, yScale, baselineY));
    area.setAttribute('fill', color);
    area.setAttribute('fill-opacity', '0.1');
    area.setAttribute('stroke', 'none');
    svg.appendChild(area);

    const line = document.createElementNS(SVG_NS, 'path');
    line.setAttribute('d', pathFromSegment(seg, xScale, yScale));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);
  }

  const last = points[points.length - 1];
  const dot = document.createElementNS(SVG_NS, 'circle');
  dot.setAttribute('cx', xScale(last.t).toFixed(2));
  dot.setAttribute('cy', yScale(last.v).toFixed(2));
  dot.setAttribute('r', 3);
  dot.setAttribute('fill', color);
  svg.appendChild(dot);

  return svg;
}

// ---------- detail comparison charts ----------

function renderDetailSections(hist, colMetaMap) {
  detailSections.innerHTML = '';
  if (!hist) return;

  const names = [...selectedNames].filter((n) => hist.columns.includes(n));
  if (names.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Nenhum sensor selecionado. Marque sensores no grid acima para comparar.';
    detailSections.appendChild(p);
    return;
  }

  const groups = new Map();
  for (const n of names) {
    const fam = familyOf(n);
    if (!groups.has(fam)) groups.set(fam, []);
    groups.get(fam).push(n);
  }

  for (const [fam, groupNames] of groups) {
    const seriesList = groupNames.map((n) => ({
      name: n,
      displayName: displayNameOf(colMetaMap.get(n), n),
      points: (hist.series[n] || []).map((pt) => ({ t: new Date(pt.timestamp).getTime(), v: pt.value }))
    }));
    detailSections.appendChild(buildDetailPanel(fam, seriesList, hist.groupIntervalMinutes));
  }
}

function buildDetailPanel(family, seriesList, groupIntervalMinutes) {
  const panel = document.createElement('section');
  panel.className = 'panel detail-panel';

  const header = document.createElement('div');
  header.className = 'panel-header';
  const h2 = document.createElement('h2');
  h2.textContent = `${prettyFamily(family)} — comparativo (24h)`;
  header.appendChild(h2);
  panel.appendChild(header);

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  panel.appendChild(wrap);

  const allPoints = seriesList.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'Sem leituras confiaveis nas ultimas 24h para os sensores selecionados.';
    wrap.appendChild(p);
    return panel;
  }

  const width = 800;
  const height = 300;
  const margin = { top: 12, right: 16, bottom: 30, left: 50 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;

  const minT = Math.min(...allPoints.map((p) => p.t));
  const maxT = Math.max(...allPoints.map((p) => p.t));
  const yTicks = niceTicks(Math.min(...allPoints.map((p) => p.v)), Math.max(...allPoints.map((p) => p.v)), 5);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const xScale = (t) => margin.left + (maxT === minT ? 0 : ((t - minT) / (maxT - minT)) * plotWidth);
  const yScale = (v) => margin.top + plotHeight - (yMax === yMin ? 0 : ((v - yMin) / (yMax - yMin)) * plotHeight);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'chart-svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  wrap.appendChild(svg);

  // gridlines + y labels
  for (const tick of yTicks) {
    const y = yScale(tick);
    const line = document.createElementNS(SVG_NS, 'line');
    line.setAttribute('class', 'gridline');
    line.setAttribute('x1', margin.left);
    line.setAttribute('x2', width - margin.right);
    line.setAttribute('y1', y.toFixed(2));
    line.setAttribute('y2', y.toFixed(2));
    svg.appendChild(line);

    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'axis-label');
    label.setAttribute('x', margin.left - 8);
    label.setAttribute('y', (y + 3).toFixed(2));
    label.setAttribute('text-anchor', 'end');
    label.textContent = tick.toString();
    svg.appendChild(label);
  }

  // baseline
  const baseline = document.createElementNS(SVG_NS, 'line');
  baseline.setAttribute('class', 'baseline');
  baseline.setAttribute('x1', margin.left);
  baseline.setAttribute('x2', width - margin.right);
  baseline.setAttribute('y1', margin.top + plotHeight);
  baseline.setAttribute('y2', margin.top + plotHeight);
  svg.appendChild(baseline);

  // x labels (6 evenly spaced ticks)
  const xTickCount = 6;
  for (let i = 0; i <= xTickCount; i++) {
    const t = minT + ((maxT - minT) * i) / xTickCount;
    const x = xScale(t);
    const label = document.createElementNS(SVG_NS, 'text');
    label.setAttribute('class', 'axis-label');
    label.setAttribute('x', x.toFixed(2));
    label.setAttribute('y', height - margin.bottom + 16);
    label.setAttribute('text-anchor', i === 0 ? 'start' : i === xTickCount ? 'end' : 'middle');
    label.textContent = formatTimeShort(t);
    svg.appendChild(label);
  }

  const expectedGapMs = groupIntervalMinutes * 60 * 1000;
  const seriesGroups = [];
  const pointMaps = [];

  seriesList.forEach((series, idx) => {
    const color = seriesColor(series.name);
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('data-series-index', String(idx));

    for (const seg of buildSegmentsByGap(series.points, expectedGapMs)) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'series-line');
      path.setAttribute('d', pathFromSegment(seg, xScale, yScale));
      path.setAttribute('stroke', color);
      g.appendChild(path);
    }

    if (series.points.length > 0) {
      const last = series.points[series.points.length - 1];
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'series-dot');
      dot.setAttribute('cx', xScale(last.t).toFixed(2));
      dot.setAttribute('cy', yScale(last.v).toFixed(2));
      dot.setAttribute('r', 4);
      dot.setAttribute('fill', color);
      g.appendChild(dot);
    }

    svg.appendChild(g);
    seriesGroups.push(g);
    pointMaps.push(new Map(series.points.map((p) => [p.t, p.v])));
  });

  // crosshair
  const crosshair = document.createElementNS(SVG_NS, 'line');
  crosshair.setAttribute('class', 'crosshair');
  crosshair.setAttribute('y1', margin.top);
  crosshair.setAttribute('y2', margin.top + plotHeight);
  svg.appendChild(crosshair);

  const hoverRect = document.createElementNS(SVG_NS, 'rect');
  hoverRect.setAttribute('class', 'hover-rect');
  hoverRect.setAttribute('x', margin.left);
  hoverRect.setAttribute('y', margin.top);
  hoverRect.setAttribute('width', plotWidth);
  hoverRect.setAttribute('height', plotHeight);
  svg.appendChild(hoverRect);

  const tooltip = document.createElement('div');
  tooltip.className = 'chart-tooltip';
  wrap.appendChild(tooltip);

  const masterTimestamps = [...new Set(allPoints.map((p) => p.t))].sort((a, b) => a - b);

  function showTooltip(evt) {
    const rect = svg.getBoundingClientRect();
    const svgX = ((evt.clientX - rect.left) / rect.width) * width;
    const t = minT + ((svgX - margin.left) / plotWidth) * (maxT - minT);
    const nearestT = nearestTimestamp(t, masterTimestamps);

    crosshair.setAttribute('x1', xScale(nearestT).toFixed(2));
    crosshair.setAttribute('x2', xScale(nearestT).toFixed(2));
    crosshair.style.opacity = '1';

    tooltip.innerHTML = '';
    const timeEl = document.createElement('div');
    timeEl.className = 'tooltip-time';
    timeEl.textContent = formatDateTime(nearestT);
    tooltip.appendChild(timeEl);

    seriesList.forEach((series, idx) => {
      const row = document.createElement('div');
      row.className = 'tooltip-row';
      const key = document.createElement('span');
      key.className = 'tooltip-key';
      key.style.background = seriesColor(series.name);
      const nameEl = document.createElement('span');
      nameEl.textContent = series.displayName;
      const valueEl = document.createElement('span');
      valueEl.className = 'tooltip-value';
      const v = pointMaps[idx].get(nearestT);
      valueEl.textContent = formatValue(v);
      row.appendChild(key);
      row.appendChild(nameEl);
      row.appendChild(valueEl);
      tooltip.appendChild(row);
    });

    const wrapRect = wrap.getBoundingClientRect();
    tooltip.style.left = `${evt.clientX - wrapRect.left}px`;
    tooltip.style.top = `${evt.clientY - wrapRect.top - 12}px`;
    tooltip.style.opacity = '1';
  }

  function hideTooltip() {
    crosshair.style.opacity = '0';
    tooltip.style.opacity = '0';
  }

  hoverRect.addEventListener('pointermove', showTooltip);
  hoverRect.addEventListener('pointerleave', hideTooltip);

  // legend (toggle-to-isolate)
  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  seriesList.forEach((series, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'legend-item';
    const key = document.createElement('span');
    key.className = 'legend-key';
    key.style.background = seriesColor(series.name);
    const label = document.createElement('span');
    label.textContent = series.displayName;
    btn.appendChild(key);
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      const hidden = btn.classList.toggle('is-off');
      seriesGroups[idx].style.display = hidden ? 'none' : '';
    });
    legend.appendChild(btn);
  });
  panel.appendChild(legend);

  // table view toggle (accessibility twin)
  const toggleRow = document.createElement('div');
  toggleRow.className = 'table-toggle-row';
  const tableBtn = document.createElement('button');
  tableBtn.type = 'button';
  tableBtn.className = 'btn secondary';
  tableBtn.textContent = 'Ver como tabela';
  toggleRow.appendChild(tableBtn);
  panel.appendChild(toggleRow);

  const tableWrap = document.createElement('div');
  tableWrap.className = 'detail-table-wrap';
  tableWrap.appendChild(buildDetailTable(seriesList, masterTimestamps, pointMaps));
  panel.appendChild(tableWrap);

  tableBtn.addEventListener('click', () => {
    const open = tableWrap.classList.toggle('is-open');
    tableBtn.textContent = open ? 'Ocultar tabela' : 'Ver como tabela';
  });

  return panel;
}

function buildDetailTable(seriesList, masterTimestamps, pointMaps) {
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const thTime = document.createElement('th');
  thTime.textContent = 'Horario';
  headRow.appendChild(thTime);
  for (const series of seriesList) {
    const th = document.createElement('th');
    th.textContent = series.displayName;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const t of masterTimestamps) {
    const tr = document.createElement('tr');
    const tdTime = document.createElement('td');
    tdTime.textContent = formatDateTime(t);
    tr.appendChild(tdTime);
    seriesList.forEach((series, idx) => {
      const td = document.createElement('td');
      td.textContent = formatValue(pointMaps[idx].get(t));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

// ---------- wiring ----------

searchInput.addEventListener('input', () => {
  searchTerm = searchInput.value;
  if (latestHistory) renderCards(latestHistory, currentColMeta, currentTop, currentStatus);
});

loadData();
setInterval(loadData, REFRESH_MS);
