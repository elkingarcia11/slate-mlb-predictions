const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
  constructor() { this.children = []; this.hidden = true; }
  replaceChildren() { this.children = []; }
  appendChild(child) { this.children.push(child); return child; }
  createTHead() { return this.appendChild(new Element()); }
  createTBody() { return this.appendChild(new Element()); }
  insertRow() { return this.appendChild(new Element()); }
  insertCell() { return this.appendChild(new Element()); }
  setAttribute() {}
}
const elements = new Map();
const pending = new Map();
const context = vm.createContext({
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    },
    createElement: () => new Element(),
  },
  fetch: (url) => new Promise((resolve) => pending.set(url, resolve)),
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
  console.log('Stats rendering, null/zero formatting, and stale response checks passed.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
