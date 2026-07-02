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
const statRow = document.getElementById('statRow');
const searchInput = document.getElementById('searchInput');
const selectionHint = document.getElementById('selectionHint');
const cardSections = document.getElementById('cardSections');
const detailSections = document.getElementById('detailSections');
const heroTile = document.getElementById('heroTile');
const heroValue = document.getElementById('heroValue');
const heroKey = document.getElementById('heroKey');
const heroSensor = document.getElementById('heroSensor');
const heroTime = document.getElementById('heroTime');

let latestHistory = null;
let latestColumns = null;
let selectedNames = new Set();
let selectionInitialized = false;
let searchTerm = '';
let currentTop = null;
let currentFailures = { count: 0, total: 0, names: new Set() };

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

// Scans every enabled sensor's 24h series and returns the single highest
// reading found (the hero stat), or null if there is no data at all yet.
function computeTopReading(hist) {
  let top = null;
  for (const name of hist.columns) {
    const points = hist.series[name] || [];
    for (const pt of points) {
      if (pt.value === null || pt.value === undefined) continue;
      if (!top || pt.value > top.value) {
        top = { name, value: pt.value, timestamp: pt.timestamp };
      }
    }
  }
  return top;
}

// A sensor is considered in failure when its latest reading is negative
// (out-of-range for these sensors, regardless of the *_Quality flag).
function computeFailureSummary(hist) {
  const names = new Set();
  for (const name of hist.columns) {
    const points = hist.series[name] || [];
    const last = points.length ? points[points.length - 1] : null;
    if (last && typeof last.value === 'number' && last.value < 0) {
      names.add(name);
    }
  }
  return { count: names.size, total: hist.columns.length, names };
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

  headerSubtitle.textContent = `Dados atualizados as ${formatDateTime(hist.generatedAt)} (cache do servidor).`;

  currentTop = computeTopReading(hist);
  renderHero(currentTop);
  currentFailures = computeFailureSummary(hist);

  if (hist.columns.length === 0) {
    renderStatTiles(hist, currentFailures);
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

  renderStatTiles(hist, currentFailures);
  setHint(defaultHintText());
  renderCards(hist, cols, currentTop, currentFailures);
  renderDetailSections(hist);
}

function renderHero(top) {
  if (!top) {
    heroValue.textContent = '—';
    heroKey.style.background = 'transparent';
    heroSensor.textContent = 'Sem leituras confiaveis nas ultimas 24h';
    heroTime.textContent = '';
    heroTile.disabled = true;
    return;
  }
  heroTile.disabled = false;
  heroValue.textContent = formatValue(top.value);
  heroKey.style.background = seriesColor(top.name);
  heroSensor.textContent = top.name;
  heroTime.textContent = `em ${formatDateTime(top.timestamp)}`;
}

function renderStatTiles(hist, failures) {
  const hasFailures = failures.count > 0;
  const tiles = [
    { label: 'Sensores habilitados', value: String(hist.columns.length) },
    {
      label: 'Sensores em falha',
      value: `${failures.count}/${failures.total}`,
      alert: hasFailures
    },
    { label: 'Selecionados p/ comparar', value: `${selectedNames.size}/${MAX_SELECTION}` },
    { label: 'Intervalo de agrupamento', value: `${hist.groupIntervalMinutes} min` },
    { label: 'Intervalo de atualizacao', value: `${hist.updateIntervalMinutes} min` }
  ];
  statRow.innerHTML = '';
  for (const tile of tiles) {
    const div = document.createElement('div');
    div.className = 'stat-tile' + (tile.alert ? ' is-alert' : '');
    const label = document.createElement('p');
    label.className = 'stat-label';
    label.textContent = tile.label;
    const value = document.createElement('p');
    value.className = 'stat-value';
    value.textContent = tile.value;
    div.appendChild(label);
    div.appendChild(value);
    statRow.appendChild(div);
  }
}

function renderCards(hist, cols, topReading, failures) {
  const colMetaMap = new Map((cols.columns || []).map((c) => [c.name, c]));
  const term = searchTerm.trim().toLowerCase();
  const names = hist.columns.filter((n) => n.toLowerCase().includes(term));

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
      const isFailure = failures.names.has(name);
      grid.appendChild(buildCard(name, points, colMetaMap.get(name), hist.groupIntervalMinutes, isTop, isFailure));
    }
    block.appendChild(grid);
    cardSections.appendChild(block);
  }
}

function buildCard(name, points, meta, groupIntervalMinutes, isTop, isFailure) {
  const card = document.createElement('div');
  card.className =
    'sensor-card' +
    (selectedNames.has(name) ? ' is-selected' : '') +
    (isTop ? ' is-top' : '') +
    (isFailure ? ' is-failure' : '');
  card.dataset.sensor = name;

  const top = document.createElement('div');
  top.className = 'card-top';

  const nameEl = document.createElement('span');
  nameEl.className = 'card-name';
  nameEl.title = name;
  nameEl.textContent = name;
  top.appendChild(nameEl);

  const badges = document.createElement('span');
  badges.className = 'card-badges';

  if (isFailure) {
    const failureBadge = document.createElement('span');
    failureBadge.className = 'badge critical';
    failureBadge.textContent = 'Em falha';
    badges.appendChild(failureBadge);
  }

  if (isTop) {
    const topBadge = document.createElement('span');
    topBadge.className = 'badge neutral';
    topBadge.textContent = 'Maior 24h';
    badges.appendChild(topBadge);
  }

  const reliable = meta ? meta.reliable : false;
  const badge = document.createElement('span');
  badge.className = 'badge ' + (reliable ? 'ok' : 'bad');
  badge.textContent = reliable ? 'Confiavel' : 'Nao confiavel';
  badges.appendChild(badge);

  top.appendChild(badges);
  card.appendChild(top);

  const valueEl = document.createElement('div');
  valueEl.className = 'card-value' + (isFailure ? ' is-critical' : '');
  const last = points.length ? points[points.length - 1] : null;
  valueEl.textContent = last ? formatValue(last.v) : '—';
  card.appendChild(valueEl);

  card.appendChild(buildSparkline(points, groupIntervalMinutes, isFailure));

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
  renderStatTiles(latestHistory, currentFailures);
  renderCards(latestHistory, latestColumns, currentTop, currentFailures);
  renderDetailSections(latestHistory);
}

function buildSparkline(points, groupIntervalMinutes, isFailure) {
  const color = isFailure ? 'var(--status-critical)' : 'var(--series-1)';
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

function renderDetailSections(hist) {
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
      nameEl.textContent = series.name;
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
    label.textContent = series.name;
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
    th.textContent = series.name;
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
  if (latestHistory) renderCards(latestHistory, latestColumns, currentTop, currentFailures);
});

heroTile.addEventListener('click', () => {
  if (!currentTop) return;
  const card = document.querySelector(`.sensor-card[data-sensor="${CSS.escape(currentTop.name)}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.remove('is-flash');
  void card.offsetWidth; // restart the flash animation even if it just ran
  card.classList.add('is-flash');
});

loadData();
setInterval(loadData, REFRESH_MS);
