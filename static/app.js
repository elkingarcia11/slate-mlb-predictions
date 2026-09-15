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
    $("predictionStatus").textContent = `Predictions · ${date}`;
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
  yesterday: "Yesterday", all_time: "All time", last_7_days: "Last 7 days",
  last_30_days: "Last 30 days", by_weekday: "By weekday",
  by_home_away: "Home / away", daily: "Daily",
};
let statsRequest = 0;
let publishedStats = null;
let selectedPeriod = "yesterday";

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
    $("statMeta").textContent = `As of ${data.as_of || "—"} · Evaluated through ${data.evaluated_through || "—"}`;
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
  const value = publishedStats[selectedPeriod];
  let rows;
  if (selectedPeriod === "daily") rows = [...(value || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  else if (["by_weekday", "by_home_away"].includes(selectedPeriod)) {
    rows = Object.entries(value || {}).map(([group, metrics]) => ({ group: friendlyLabel(group), ...metrics }));
  } else rows = value ? [value] : [];
  const content = $("statsContent");
  content.replaceChildren();
  if (!rows.length) content.textContent = "No settled results for this period yet.";
  else {
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    columns.forEach((key) => {
      const th = document.createElement("th");
      th.textContent = friendlyLabel(key);
      th.title = publishedStats.definitions?.[key] || "";
      head.appendChild(th);
    });
    const body = table.createTBody();
    rows.forEach((row) => {
      const tr = body.insertRow();
      columns.forEach((key) => { tr.insertCell().textContent = formatMetric(key, row[key]); });
    });
    content.appendChild(table);
  }
  const definitions = $("statsDefinitions");
  definitions.replaceChildren();
  Object.entries(publishedStats.definitions || {}).forEach(([key, value]) => {
    const p = document.createElement("p");
    p.textContent = `${friendlyLabel(key)}: ${value}`;
    definitions.appendChild(p);
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
