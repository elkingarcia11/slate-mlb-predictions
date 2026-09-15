const state = {
  dates: [],
  selectedDate: null,
  stats: [],
  selectedStat: null,
  currentData: null, // {columns, numericColumns, rows, label}
  tableSortCol: null,
  tableSortDir: "desc",
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------
// Dates
// ---------------------------------------------------------------
async function loadDates() {
  $("dateTiles").innerHTML = `<div class="empty-note">Loading dates…</div>`;
  try {
    const res = await fetch("/api/dates");
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.dates = data.dates || [];
    renderDateTiles();
    if (state.dates.length) {
      selectDate(state.dates[0]);
    } else {
      $("dateTiles").innerHTML =
        `<div class="empty-note">No date folders found under this prefix.</div>`;
    }
  } catch (err) {
    $("dateTiles").innerHTML =
      `<div class="empty-note">Couldn't load dates: ${escapeHtml(err.message)}</div>`;
  }
}

function renderDateTiles() {
  const wrap = $("dateTiles");
  wrap.innerHTML = "";
  state.dates.forEach((d) => {
    const btn = document.createElement("button");
    btn.className = "date-tile" + (d === state.selectedDate ? " active" : "");
    btn.textContent = d;
    btn.addEventListener("click", () => selectDate(d));
    wrap.appendChild(btn);
  });
}

async function selectDate(date) {
  state.selectedDate = date;
  renderDateTiles();
  if (state.selectedStat) await loadPredictionTable(state.selectedStat);
}

async function loadCategories() {
  try {
    const data = await fetchJson("/api/stats/predictions");
    state.stats = (data.categories || []).map((entry) => ({
      file: entry.category,
      label: friendlyLabel(entry.category),
    }));
    renderStatRail();
    if (state.stats.length) await selectStat(state.stats[0].file);
    else setStatus("No prediction stats are available yet.");
  } catch (err) {
    setStatus(err.message, true);
  }
}

function renderStatRail() {
  const rail = $("statRail");
  rail.innerHTML = "";
  state.stats.forEach((s) => {
    const btn = document.createElement("button");
    btn.className =
      "stat-btn" + (s.file === state.selectedStat ? " active" : "");
    btn.textContent = s.label;
    btn.addEventListener("click", () => selectStat(s.file));
    rail.appendChild(btn);
  });
}

// ---------------------------------------------------------------
// Stat data
// ---------------------------------------------------------------
async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "Unable to load data.");
  return data;
}

async function selectStat(file) {
  state.selectedStat = file;
  renderStatRail();
  $("statTitle").textContent = friendlyLabel(file);
  $("statMeta").textContent = "";
  $("scorecard").hidden = true;
  setStatus("Loading stats…");
  await Promise.all([loadPublishedStats(file), loadPredictionTable(file)]);
}

let tableRequest = 0;
async function loadPredictionTable(file) {
  const request = ++tableRequest;
  const date = state.selectedDate;
  state.currentData = null;
  $("tableCard").hidden = true;
  $("predictionStatus").textContent = date ? "Loading predictions…" : "Select a date to view predictions.";
  if (!date) return;
  try {
    const data = await fetchJson(`/api/data/${encodeURIComponent(date)}/${encodeURIComponent(file)}`);
    if (request !== tableRequest) return;
    state.currentData = data;
    state.tableSortCol = data.columns.find((c) => c === "prediction_proba") ||
      data.columns.find((c) => /prediction/i.test(c)) || data.columns[0];
    state.tableSortDir = "desc";
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    $("predictionStatus").textContent = date === today ? "Today’s predictions" : `Predictions · ${date}`;
    renderTable();
  } catch (err) {
    if (request === tableRequest) $("predictionStatus").textContent = `Predictions unavailable for ${date}: ${err.message}`;
  }
}

// ---------------------------------------------------------------
// Table
// ---------------------------------------------------------------
// Flexible matchers for the 4 columns we want to show (in order)
const TABLE_COL_PATTERNS = [
  /game.?date/i,
  /team.?abbr/i,
  /player.?name/i,
];

function visibleColumns(columns) {
  const predCol =
    columns.find((c) => c === "prediction_proba") ||
    columns.find((c) => /prediction/i.test(c));
  const matched = TABLE_COL_PATTERNS.map((pat) =>
    columns.find((c) => pat.test(c)),
  ).filter(Boolean);
  if (predCol) matched.push(predCol);
  // deduplicate while preserving order
  return matched.length ? [...new Set(matched)] : columns;
}

function renderTable() {
  const data = state.currentData;
  const card = $("tableCard");
  if (!data || !data.rows.length) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const cols = visibleColumns(data.columns);
  const theadRow = document.querySelector("#dataTable thead tr");
  theadRow.innerHTML = "";
  cols.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col;
    if (col === state.tableSortCol) {
      th.classList.add(state.tableSortDir === "asc" ? "sorted-asc" : "sorted");
    }
    th.addEventListener("click", () => sortTableBy(col));
    theadRow.appendChild(th);
  });

  renderTableBody();
}

function sortTableBy(col) {
  if (state.tableSortCol === col) {
    state.tableSortDir = state.tableSortDir === "desc" ? "asc" : "desc";
  } else {
    state.tableSortCol = col;
    state.tableSortDir = state.currentData.numericColumns.includes(col)
      ? "desc"
      : "asc";
  }
  renderTable();
}

function renderTableBody() {
  const data = state.currentData;
  const tbody = document.querySelector("#dataTable tbody");
  tbody.innerHTML = "";

  let rows = [...data.rows];
  if (state.tableSortCol) {
    const col = state.tableSortCol;
    const numeric = data.numericColumns.includes(col);
    const dir = state.tableSortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = a[col],
        bv = b[col];
      if (numeric) return ((av ?? -Infinity) - (bv ?? -Infinity)) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }

  const cols = visibleColumns(data.columns);
  const frag = document.createDocumentFragment();
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    cols.forEach((col) => {
      const td = document.createElement("td");
      const val = row[col];
      td.textContent = val === null || val === undefined ? "" : val;
      if (data.numericColumns.includes(col)) td.classList.add("num");
      tr.appendChild(td);
    });
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

// Published summary metrics: formatting only, no local evaluation.
const PERIODS = {
  yesterday: "Yesterday", last_7_days: "7 days",
  last_30_days: "30 days", all_time: "All time",
};
let statsRequest = 0;
let publishedStats = null;
let selectedPeriod = "last_30_days";

function friendlyLabel(value) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMetric(key, value) {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number") return String(value);
  if (key.endsWith("_rate")) return `${(value * 100).toFixed(1)}%`;
  if (Number.isInteger(value)) return value.toLocaleString();
  return value.toFixed(3);
}

async function loadPublishedStats(file) {
  const request = ++statsRequest;
  publishedStats = null;
  try {
    const data = await fetchJson(`/api/stats/predictions/${encodeURIComponent(file)}`);
    if (request !== statsRequest) return;
    publishedStats = data;
    $("statMeta").textContent = "";
    setStatus("");
    renderPublishedStats();
  } catch (err) {
    if (request === statsRequest) setStatus(err.message, true);
  }
}

function renderPublishedStats() {
  if (!publishedStats) return;
  $("scorecard").hidden = false;
  const tabs = $("statsPeriods");
  tabs.replaceChildren();
  Object.entries(PERIODS).forEach(([key, label]) => {
    const button = document.createElement("button");
    button.className = "date-tile" + (selectedPeriod === key ? " active" : "");
    button.textContent = label;
    button.setAttribute("aria-pressed", String(selectedPeriod === key));
    button.onclick = () => { selectedPeriod = key; renderPublishedStats(); };
    tabs.appendChild(button);
  });
  const metrics = publishedStats[selectedPeriod];
  const content = $("statsContent");
  content.replaceChildren();
  if (!metrics || !metrics.sample_size) {
    content.textContent = "No settled results for this period yet.";
  } else {
    const grid = document.createElement("dl");
    grid.className = "performance-metrics";
    summaryMetrics().forEach(([key, label]) => {
      const metric = document.createElement("div");
      const title = document.createElement("dt");
      title.textContent = label;
      title.title = publishedStats.definitions?.[key] || METRIC_DEFINITIONS[key] || "";
      const value = document.createElement("dd");
      value.textContent = summaryValue(key, metrics[key]);
      metric.appendChild(title);
      metric.appendChild(value);
      grid.appendChild(metric);
    });
    content.appendChild(grid);
  }
  const through = metrics?.date || publishedStats.evaluated_through;
  $("statsSample").textContent = `${metrics ? `Based on ${formatMetric("sample_size", metrics.sample_size)} predictions` : "Sample size unavailable"} · Through ${formatReportDate(through)}`;
  if (publishedStats.category === "team_win" && metrics?.probability_sample_size != null) {
    $("statsSample").textContent += ` · Brier score based on ${formatMetric("sample_size", metrics.probability_sample_size)} probabilities`;
  }
  renderTrends();
  const definitions = $("statsDefinitions");
  definitions.replaceChildren();
  Object.entries(publishedStats.definitions || {}).forEach(([key, value]) => {
    const p = document.createElement("p");
    p.textContent = `${friendlyLabel(key)}: ${value}`;
    definitions.appendChild(p);
  });
}

const METRIC_DEFINITIONS = {
  mean_absolute_error: "Average absolute prediction error; lower is better.",
  brier_score: "Mean squared error of predicted win probabilities; lower is better.",
  sample_size: "Number of evaluated predictions.",
};

function summaryMetrics() {
  return publishedStats.category === "team_win"
    ? [["hit_rate", "Winner accuracy"], ["brier_score", "Brier score"], ["sample_size", "Sample size"]]
    : [["hit_rate", "Exact accuracy"], ["within_1_rate", "Within ±1"], ["mean_absolute_error", "Avg. absolute error"]];
}

function summaryValue(key, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  if (key === "mean_absolute_error") {
    const units = { pitcher_strikeouts: "strikeouts", player_strikeouts: "strikeouts", player_hits: "hits", player_home_runs: "home runs", team_total_runs: "runs", team_run_diff: "runs" };
    return `${value.toFixed(1)} ${units[publishedStats.category] || ""}`.trim();
  }
  if (key === "brier_score") return value.toFixed(3);
  return formatMetric(key, value);
}

function formatReportDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function periodDailyRows() {
  const rows = [...(publishedStats.daily || [])];
  if (selectedPeriod === "all_time") return rows.sort((a, b) => b.date.localeCompare(a.date));
  const end = new Date(`${publishedStats.as_of}T00:00:00Z`);
  const days = { yesterday: 1, last_7_days: 7, last_30_days: 30 }[selectedPeriod];
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return rows.filter((row) => {
    const date = new Date(`${row.date}T00:00:00Z`);
    return date >= start && date < end;
  }).sort((a, b) => b.date.localeCompare(a.date));
}

function renderTrends() {
  const container = $("statsBreakdowns");
  container.replaceChildren();
  const groups = [
    [`Daily results · ${PERIODS[selectedPeriod]}`, periodDailyRows(), "date"],
    ["By weekday · All time", Object.entries(publishedStats.by_weekday || {}).map(([group, metrics]) => ({ ...metrics, group: friendlyLabel(group) })), "group"],
    ["Home / away · All time", Object.entries(publishedStats.by_home_away || {}).map(([group, metrics]) => ({ ...metrics, group: friendlyLabel(group) })), "group"],
  ];
  groups.forEach(([label, rows, groupKey]) => {
    const heading = document.createElement("h3");
    heading.textContent = label;
    container.appendChild(heading);
    const wrap = document.createElement("div");
    wrap.className = "table-scroll stats-content";
    container.appendChild(wrap);
    if (!rows.length) { wrap.textContent = "No settled results available."; return; }
    const columns = [[groupKey, groupKey === "date" ? "Date" : "Group"], ...summaryMetrics()];
    if (publishedStats.category !== "team_win") columns.push(["sample_size", "Sample size"]);
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    columns.forEach(([, label]) => {
      const th = document.createElement("th");
      th.textContent = label;
      th.setAttribute("scope", "col");
      head.appendChild(th);
    });
    const body = table.createTBody();
    rows.forEach((row) => {
      const tr = body.insertRow();
      columns.forEach(([key]) => {
        tr.insertCell().textContent = key === groupKey ? row[key] : summaryValue(key, row[key]);
      });
    });
    wrap.appendChild(table);
  });
}

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------
function setStatus(msg, isError = false) {
  const area = $("statusArea");
  if (!msg) {
    area.innerHTML = "";
    return;
  }
  area.innerHTML = `<div class="status-msg${isError ? " error" : ""}">${escapeHtml(msg)}</div>`;
}

function escapeHtml(s) {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ---------------------------------------------------------------
// Boot
// ---------------------------------------------------------------
(async function init() {
  await Promise.all([loadDates(), loadCategories()]);
})();
