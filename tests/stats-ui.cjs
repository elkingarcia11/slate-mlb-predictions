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
  as_of: '2026-09-15', evaluated_through: '2026-09-14',
  yesterday: { sample_size: 0, hit_rate: null, average_difference: -0.25 },
  all_time: { hit_rate: 0.5 }, last_7_days: {}, last_30_days: {},
  by_weekday: { monday: { hit_rate: 0 } }, by_home_away: { home: { hit_rate: 1 } },
  daily: [{ date: '2026-09-14', hit_rate: 0.4 }],
  definitions: { hit_rate: 'Published definition' },
};
(async () => {
  assert.equal(run('formatMetric("hit_rate", null)'), '—');
  assert.equal(run('formatMetric("hit_rate", 0)'), '0.0%');
  assert.equal(run('formatMetric("hit_rate", 0.55)'), '55.0%');
  const old = run('loadPublishedStats("player_hits")');
  const current = run('loadPublishedStats("team_win")');
  pending.get('/api/stats/predictions/team_win')({ ok: true, json: async () => payload });
  await current;
  for (const period of Object.keys(payload).filter((key) => run(`Object.hasOwn(PERIODS, '${key}')`))) {
    run(`selectedPeriod = '${period}'; renderPublishedStats()`);
    assert.equal(elements.get('statsPeriods').children.length, 7);
    assert.equal(elements.get('statsContent').children.length, 1);
  }
  pending.get('/api/stats/predictions/player_hits')({ ok: true, json: async () => ({ as_of: 'stale' }) });
  await old;
  assert.equal(run('publishedStats.as_of'), '2026-09-15');
  assert.equal(elements.get('scorecard').hidden, false);
  console.log('Stats rendering, null/zero formatting, and stale response checks passed.');
})().catch((err) => { console.error(err); process.exitCode = 1; });
