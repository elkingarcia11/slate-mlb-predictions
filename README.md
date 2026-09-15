# Slate — MLB Predictions

Flask serves prediction tables and precomputed performance stats from the
`mlb-analysis-toolkit` GCS bucket. The UI does not calculate performance metrics
or join predictions with panels.

## Run locally

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open **http://localhost:5050**. The default port can be changed with `PORT`.

Place a service account key at `gcs-sa.json` in the project root for local use.
Otherwise, the backend uses Application Default Credentials (including the
attached service account on Cloud Run). The account needs
`roles/storage.objectViewer` on the bucket. Credentials stay on the backend;
do not commit the key file.

## Data sources

- `stats/predictions/index.json` supplies category navigation. Schema v2 entries
  may include `title`, `short_title`, `entity`, `task`, `sample_size`, and
  `chart_ids` so the UI can build the rail without opening every category file.
- `stats/predictions/{category}.json` supplies period metric blocks
  (`yesterday`, `all_time`, `last_7_days`, `last_30_days`) plus legacy
  `by_weekday`, `by_home_away`, and `daily` tables. Schema v2 also adds
  `display` (human titles, `metrics` catalog, ordered `chart_ids`) and a
  top-level `charts` object of ready-to-plot series.
- `predictions/<date>/<category>.csv` supplies the sortable prediction table.

When `charts` is present, the UI prefers those series for visuals (first
viewport: `window_hit_rate`, `hit_rate_trend`, `prediction_vs_actual_trend`).
Period KPI tiles still read the existing metric blocks so older consumers keep
working. Chart `format: "percent"` values stay in **0–1** and are multiplied by
100 only for display; `y: null` means no eligible samples and is never coerced
to zero. Pre-v2 payloads fall back to the previous trend tables.

Stats appear after a successful GCS stats-only workflow run. Missing stats show
an unavailable message; there is no local calculation fallback. Summaries load
independently of prediction CSV availability and use the published `as_of` and
`evaluated_through` dates, regardless of the selected prediction-table date.
Rates are displayed as percentages; null metrics display as an em dash.
Each category shows a compact **Category performance** section above predictions.
The default period is **30 days**; the selection is retained across categories.
Count categories show exact accuracy, within ±1, and average absolute error in
category units. Team win shows winner accuracy, Brier score, and sample size.
With schema v2 charts, **More charts** expands the remaining published series;
otherwise **View trends** expands daily / weekday / home-away tables and metric
definitions.

## API

- `GET /api/stats/predictions` — published category index, unchanged.
- `GET /api/stats/predictions/<category>` — published category JSON, unchanged.
  Supports `pitcher_strikeouts`, `player_hits`, `player_home_runs`,
  `player_strikeouts`, `team_win`, `team_total_runs`, and `team_run_diff`.
- `GET /api/dates` — prediction date folders, newest first.
- `GET /api/dates/<date>/stats` — available prediction CSV files.
- `GET /api/data/<date>/<file>` — prediction CSV as rows and column metadata.

Stats endpoints support gzip payloads and return 404 for unpublished objects,
400 for unknown categories, and 502 for unreadable files or storage failures.
The old locally joined `/api/scorecard` endpoint has been removed.

## Checks

```bash
venv/bin/python -m unittest discover -s tests
node --check static/app.js
node tests/stats-ui.cjs
```
