const state = {
  dates: [],
  selectedDate: null,
  stats: [],
  selectedStat: null,
  currentData: null, // {columns, numericColumns, rows, label}
  sortCol: null,
  sortDir: "desc",
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
  $("statRail").innerHTML =
    `<div class="empty-note">Loading stat sheets…</div>`;
  clearBoard();
  try {
    const res = await fetch(`/api/dates/${encodeURIComponent(date)}/stats`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.stats = data.stats || [];
    renderStatRail();
    if (state.stats.length) {
      const keep = state.stats.find((s) => s.file === state.selectedStat);
      selectStat(keep ? keep.file : state.stats[0].file);
    } else {
      $("statRail").innerHTML =
        `<div class="empty-note">No CSV files in this date folder.</div>`;
    }
  } catch (err) {
    $("statRail").innerHTML =
      `<div class="empty-note">Couldn't load stat sheets: ${escapeHtml(err.message)}</div>`;
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
async function selectStat(file) {
  state.selectedStat = file;
  renderStatRail();
  setStatus("Loading…");
  clearBoard();
  try {
    const res = await fetch(
      `/api/data/${encodeURIComponent(state.selectedDate)}/${encodeURIComponent(file)}`,
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    state.currentData = data;
    const predCol =
      data.columns.find((c) => c === "prediction_proba") ||
      data.columns.find((c) => /prediction/i.test(c));
    state.tableSortCol =
      predCol || data.numericColumns[0] || data.columns[0] || null;
    state.tableSortDir = "desc";
    _scSort = "pred";
    _scDataCache = {};
    setStatus("");
    $("statTitle").textContent = data.label;
    $("statMeta").textContent = "";
    renderScorecard();
    renderControls();
    renderTable();
  } catch (err) {
    setStatus(`Couldn't load this stat sheet: ${err.message}`, true);
  }
}

function renderControls() {
  $("boardControls").hidden = true;
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

// ---------------------------------------------------------------
// Scorecard — horizontal prediction strip
// ---------------------------------------------------------------

function _fmt(v, decimals = 1) {
  if (v === undefined || v === null || isNaN(v)) return "—";
  return Number.isInteger(v) ? String(v) : v.toFixed(decimals);
}

function _isOverHit(pred, actual) {
  return +actual >= +pred;
}

function _dayBefore(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - 1);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Sort mode: "pred" | "actual" | "diff"
let _scSort = "pred";
let _scDataCache = {}; // date+file -> data

async function renderScorecard() {
  const el = $("scorecard");

  const targetDate = state.selectedDate ? _dayBefore(state.selectedDate) : null;
  const file = state.selectedStat;
  if (!targetDate || !file) {
    el.hidden = true;
    return;
  }

  const cacheKey = `${targetDate}|${file}`;
  let data = _scDataCache[cacheKey];
  if (!data) {
    try {
      const res = await fetch(
        `/api/scorecard/${encodeURIComponent(targetDate)}/${encodeURIComponent(file)}`,
      );
      data = await res.json();
      if (data.error || !data.rows?.length) {
        el.hidden = true;
        return;
      }
      _scDataCache[cacheKey] = data;
    } catch {
      el.hidden = true;
      return;
    }
  }

  const { rows, nameCol, predCol, actualCol } = data;
  if (!rows.length) {
    el.hidden = true;
    return;
  }

  el.hidden = false;
  const labelCol = nameCol || "player_name";

  $("scorecardLabel").textContent =
    `${data.label.toUpperCase()} · ${targetDate}`;

  let sorted = [...rows].filter(
    (r) =>
      r[predCol] !== null && r[predCol] !== undefined && !isNaN(+r[predCol]),
  );

  if (_scSort === "actual" && actualCol) {
    sorted = sorted.filter(
      (r) =>
        r[actualCol] !== null &&
        r[actualCol] !== undefined &&
        !isNaN(+r[actualCol]),
    );
    sorted.sort(
      (a, b) => (+b[actualCol] ?? -Infinity) - (+a[actualCol] ?? -Infinity),
    );
  } else if (_scSort === "diff" && actualCol) {
    sorted = sorted.filter(
      (r) =>
        r[actualCol] !== null &&
        r[actualCol] !== undefined &&
        !isNaN(+r[actualCol]),
    );
    sorted.sort(
      (a, b) =>
        Math.abs(+b[actualCol] - +b[predCol]) -
        Math.abs(+a[actualCol] - +a[predCol]),
    );
  } else {
    sorted.sort(
      (a, b) => (+b[predCol] ?? -Infinity) - (+a[predCol] ?? -Infinity),
    );
  }

  const kpisEl = $("scKpis");
  kpisEl.innerHTML = "";
  if (actualCol) {
    const valid = sorted.filter(
      (r) =>
        r[actualCol] !== null &&
        r[actualCol] !== undefined &&
        !isNaN(r[actualCol]),
    );
    if (valid.length) {
      const hits = valid.filter((r) => _isOverHit(r[predCol], r[actualCol]));
      const hitRate = ((hits.length / valid.length) * 100).toFixed(0);
      const cls = hitRate >= 60 ? "good" : hitRate >= 40 ? "warn" : "bad";
      const avgDiff =
        valid.reduce((s, r) => s + (+r[actualCol] - +r[predCol]), 0) /
        valid.length;
      const signed = `${avgDiff > 0 ? "+" : ""}${avgDiff.toFixed(2)}`;
      const diffCls = avgDiff >= 0 ? "good" : "bad";
      kpisEl.innerHTML = `
        <span class="sc-kpi" style="color:var(--ink-text);background:transparent;border:none;padding-left:0">PREV DAY</span>
        <span class="sc-kpi ${cls}"><span>HIT RATE</span>${hitRate}%</span>
        <span class="sc-kpi ${diffCls}"><span>AVG DIFF</span>${signed}</span>
      `;
    }
  } else {
    kpisEl.innerHTML = `
      <span class="sc-kpi" style="color:var(--ink-text);background:transparent;border:none;padding-left:0">PREV DAY</span>
    `;
  }

  const strip = $("scStrip");
  strip.innerHTML = "";

  if (!sorted.length) {
    strip.innerHTML = `<span class="sc-empty">No results yet for this date.</span>`;
    return;
  }

  sorted.forEach((row) => {
    const name = String(row[labelCol] ?? "—");
    const pred = row[predCol];
    const actual = actualCol ? row[actualCol] : null;
    const hasActual = actual !== null && actual !== undefined && !isNaN(actual);

    const diff = hasActual ? actual - pred : null;
    const isHit = hasActual && _isOverHit(pred, actual);

    const cardClass = hasActual ? (isHit ? "hit" : "miss") : "pred-only";

    let diffHTML = "";
    if (diff !== null) {
      const sign = diff > 0 ? "+" : "";
      const cls = isHit ? "pos" : diff > 0 ? "pos" : "neg";
      diffHTML = `<div class="sc-foot"><span class="sc-diff ${cls}"><span>DIFF</span>${sign}${_fmt(diff, 2)}</span></div>`;
    }

    const card = document.createElement("div");
    card.className = `sc-card ${cardClass}`;
    card.innerHTML = `
      <div class="sc-card-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="sc-cols">
        <div class="sc-col">
          <span class="sc-col-lbl">PRED</span>
          <span class="sc-col-val">${_fmt(pred, 2)}</span>
        </div>
        ${
          hasActual
            ? `
        <div class="sc-col-divider"></div>
        <div class="sc-col">
          <span class="sc-col-lbl">ACT</span>
          <span class="sc-col-val ${isHit ? "pa-hit" : "pa-miss"}">${_fmt(actual, 2)}</span>
        </div>`
            : ""
        }
      </div>
      ${diffHTML}
    `;
    strip.appendChild(card);
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

function clearBoard() {
  $("boardControls").hidden = true;
  $("tableCard").hidden = true;
  $("scorecard").hidden = true;
}

function resetSelection() {
  state.selectedDate = null;
  state.selectedStat = null;
  state.currentData = null;
  $("statTitle").textContent = "Select a stat sheet";
  $("statMeta").textContent = "";
  clearBoard();
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
  await loadDates();
})();
