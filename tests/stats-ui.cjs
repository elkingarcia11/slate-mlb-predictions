const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor() {
    this.children = [];
    this.hidden = true;
    this.textContent = '';
    this.className = '';
    this.title = '';
  }
  replaceChildren() { this.children = []; this.textContent = ''; }
  appendChild(child) { this.children.push(child); return child; }
  createTHead() { return this.appendChild(new Element()); }
  createTBody() { return this.appendChild(new Element()); }
  insertRow() { return this.appendChild(new Element()); }
  insertCell() { return this.appendChild(new Element()); }
  setAttribute() {}
}
const elements = new Map();
const pending = new Map();
const chartCalls = [];
class ChartStub {
  constructor(canvas, config) {
    this.canvas = canvas;
    this.config = config;
    chartCalls.push(this);
  }
  destroy() {}
}
const context = vm.createContext({
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
  },
  fetch: (url) => new Promise((resolve) => pending.set(url, resolve)),
  Chart: ChartStub,
});
const source = fs.readFileSync('static/app.js', 'utf8').split('(async function init()')[0];
vm.runInContext(source, context);
const run = (code) => vm.runInContext(code, context);
const payload = {
  category: 'team_win', as_of: '2026-09-15', evaluated_through: '2026-09-14',
  yesterday: { sample_size: 0, hit_rate: null, average_difference: -0.25 },
  all_time: { hit_rate: 0.5 }, last_7_days: {}, last_30_days: { sample_size: 240, hit_rate: 0.55, brier_score: 0.2346, probability_sample_size: 230 },
  by_weekday: { monday: { hit_rate: 0 } }, by_home_away: { home: { hit_rate: 1 } },
  daily: [{ date: '2026-09-14', hit_rate: 0.4 }],
  definitions: { hit_rate: 'Published definition' },
};
const v2Payload = {
  ...payload,
  schema_version: 2,
  display: {
    title: 'Team win',
    metrics: {
      hit_rate: { label: 'Winner accuracy', format: 'percent', description: 'Exact winner match rate.' },
      brier_score: { label: 'Brier score', format: 'number', description: 'Probability calibration.' },
      sample_size: { label: 'Sample size', format: 'integer', description: 'Evaluated predictions.' },
    },
    chart_ids: [
      'window_hit_rate', 'hit_rate_trend', 'prediction_vs_actual_trend',
      'weekday_hit_rate', 'over_under_split',
    ],
  },
  charts: {
    window_hit_rate: {
      id: 'window_hit_rate', type: 'bar', title: 'Window hit rate',
      x: { key: 'window', label: 'Window', format: 'label' },
      y: { label: 'Hit rate', format: 'percent', min: 0, max: 1 },
      series: [{ key: 'hit_rate', label: 'Hit rate', color_hint: 'primary', points: [
        { x: '7d', y: 0.5, sample_size: 70 },
        { x: '30d', y: null, sample_size: 0 },
        { x: 'all', y: 0.55, sample_size: 240 },
      ] }],
    },
    hit_rate_trend: {
      id: 'hit_rate_trend', type: 'line', title: 'Daily hit rate',
      x: { key: 'date', label: 'Date', format: 'date' },
      y: { label: 'Hit rate', format: 'percent', min: 0, max: 1 },
      series: [{ key: 'hit_rate', label: 'Hit rate', color_hint: 'primary', points: [
        { x: '2026-09-13', y: 0.4, sample_size: 20 },
        { x: '2026-09-14', y: null, sample_size: 0 },
        { x: '2026-09-15', y: 0.6, sample_size: 22 },
      ] }],
    },
    prediction_vs_actual_trend: {
      id: 'prediction_vs_actual_trend', type: 'line', title: 'Prediction vs actual',
      x: { key: 'date', label: 'Date', format: 'date' },
      y: { label: 'Average', format: 'number' },
      series: [
        { key: 'prediction', label: 'Prediction', color_hint: 'primary', points: [{ x: '2026-09-14', y: 0.5 }] },
        { key: 'actual', label: 'Actual', color_hint: 'secondary', points: [{ x: '2026-09-14', y: 0.4 }] },
      ],
    },
    weekday_hit_rate: {
      id: 'weekday_hit_rate', type: 'bar', title: 'Weekday hit rate',
      series: [{ key: 'hit_rate', points: [{ x: 'monday', y: 0.5 }] }],
    },
    over_under_split: {
      id: 'over_under_split', type: 'doughnut', title: 'Over / under',
      series: [{ key: 'split', points: [{ x: 'over', y: 0.48 }, { x: 'under', y: 0.52 }] }],
    },
  },
};
(async () => {
  assert.equal(run('formatMetric("hit_rate", null)'), '—');
  assert.equal(run('formatMetric("hit_rate", 0)'), '0.0%');
  assert.equal(run('formatMetric("hit_rate", 0.55)'), '55.0%');
  assert.equal(run('selectedPeriod'), 'last_30_days');
  const old = run('loadPublishedStats("player_hits")');
  const current = run('loadPublishedStats("team_win")');
  pending.get('/api/stats/predictions/team_win')({ ok: true, json: async () => payload });
  await current;
  assert.equal(run('selectedPeriod'), 'last_30_days');
  assert.equal(elements.get('statsContent').children[0].children[0].children[0].textContent, 'Winner accuracy');
  assert.equal(elements.get('statsContent').children[0].children[1].children[1].textContent, '0.235');
  assert.match(elements.get('statsSample').textContent, /240 predictions/);
  assert.match(elements.get('statsSample').textContent, /230 probabilities/);
  for (const period of Object.keys(payload).filter((key) => run(`Object.hasOwn(PERIODS, '${key}')`))) {
    run(`selectedPeriod = '${period}'; renderPublishedStats()`);
    assert.equal(elements.get('statsPeriods').children.length, 4);
    assert.equal(elements.get('statsBreakdowns').children.length, 6);
  }
  pending.get('/api/stats/predictions/player_hits')({ ok: true, json: async () => ({ as_of: 'stale' }) });
  await old;
  assert.equal(run('publishedStats.as_of'), '2026-09-15');
  assert.equal(elements.get('scorecard').hidden, false);
  run('selectedPeriod = "last_7_days"');
  const next = run('loadPublishedStats("pitcher_strikeouts")');
  pending.get('/api/stats/predictions/pitcher_strikeouts')({ ok: true, json: async () => ({ ...payload, category: 'pitcher_strikeouts', last_7_days: { sample_size: 10, hit_rate: 0, within_1_rate: 0.7, mean_absolute_error: 1.23 } }) });
  await next;
  assert.equal(run('selectedPeriod'), 'last_7_days');
  const metrics = elements.get('statsContent').children[0].children;
  assert.equal(metrics.length, 3);
  assert.equal(metrics[0].children[1].textContent, '0.0%');
  assert.equal(metrics[2].children[1].textContent, '1.2 strikeouts');
  assert.equal(run('periodDailyRows().length'), 1);
  run('publishedStats.daily.push({date: "2026-08-01"}, {date: "2026-09-15"})');
  assert.equal(run('periodDailyRows().length'), 1);
  run('selectedPeriod = "yesterday"; renderPublishedStats()');
  assert.equal(elements.get('statsContent').textContent, 'No settled results for this period yet.');
  assert.match(elements.get('statsSample').textContent, /0 predictions/);

  const mapped = JSON.parse(run(`JSON.stringify(pointsToChartJs(${JSON.stringify(v2Payload.charts.hit_rate_trend.series)}, "line", ${JSON.stringify(v2Payload.charts.hit_rate_trend)}))`));
  assert.deepEqual(mapped.datasets[0].data, [0.4, 0.6]);
  assert.equal(mapped.empty, false);
  assert.equal(run('formatAxisValue("percent", 0.55)'), '55.0%');
  assert.equal(run('formatAxisValue("percent", null)'), '—');

  chartCalls.length = 0;
  run('selectedPeriod = "last_30_days"');
  const v2 = run('loadPublishedStats("team_win")');
  pending.get('/api/stats/predictions/team_win')({ ok: true, json: async () => v2Payload });
  await v2;
  assert.equal(elements.get('statsContent').children[0].children[0].children[0].textContent, 'Winner accuracy');
  assert.equal(elements.get('statsCharts').children.length, 3);
  assert.equal(elements.get('statsCharts').children[0].children[0].textContent, 'Window hit rate');
  assert.equal(elements.get('statsCharts').children[1].children[0].textContent, 'Daily hit rate');
  assert.equal(elements.get('statsCharts').children[2].children[0].textContent, 'Prediction vs actual');
  assert.equal(elements.get('statsTrendsSummary').textContent, 'More charts');
  assert.equal(elements.get('statsBreakdowns').children.length, 1);
  assert.equal(elements.get('statsBreakdowns').children[0].children.length, 2);
  assert.equal(elements.get('statsBreakdowns').children[0].children[0].children[0].textContent, 'Weekday hit rate');
  assert.equal(elements.get('statsBreakdowns').children[0].children[1].children[0].textContent, 'Over / under');
  assert.ok(chartCalls.length >= 3);
  const windowMapped = JSON.parse(run(`JSON.stringify(pointsToChartJs(${JSON.stringify(v2Payload.charts.window_hit_rate.series)}, "bar", ${JSON.stringify(v2Payload.charts.window_hit_rate)}))`));
  assert.deepEqual(windowMapped.datasets[0].data, [0.5, 0.55]);

  console.log('Stats rendering, null/zero formatting, stale response, and schema v2 chart checks passed.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
