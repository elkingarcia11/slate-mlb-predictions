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

- `stats/predictions/index.json` supplies the category navigation.
- `stats/predictions/{category}.json` supplies `yesterday`, `all_time`,
  `last_7_days`, `last_30_days`, `by_weekday`, `by_home_away`, and `daily`.
- `predictions/<date>/<category>.csv` supplies the sortable prediction table.

Stats appear after a successful GCS stats-only workflow run. Missing stats show
an unavailable message; there is no local calculation fallback. Summaries load
independently of prediction CSV availability and use the published `as_of` and
`evaluated_through` dates, regardless of the selected prediction-table date.
Rates are displayed as percentages; null metrics display as an em dash.
Published metric definitions are available below the summary table.

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
