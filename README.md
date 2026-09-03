# MLB Game Day — Prediction Stats Dashboard

A small Flask app that reads your prediction CSVs straight out of GCS
(`predictions/<date>/<stat>.csv`) and shows each stat sheet as a sortable
table plus a bar chart, with the bucket path configurable from the UI.

## 1. Install dependencies

```bash
cd mlb-stats-app
python3 -m venv venv && source venv/bin/activate   # optional but recommended
pip install -r requirements.txt
```

## 2. Add your service account key

Drop your key file in the project root as `gcs-sa.json` (same folder as
`app.py`). The service account needs at least `roles/storage.objectViewer`
on the bucket.

```
mlb-stats-app/
├── app.py
├── gcs-sa.json     <-- add this (not committed, see .gitignore below)
└── static/...
```

If you'd rather keep the key elsewhere, set `GCS_CREDENTIALS_PATH` (see
below) or change it later from the gear/config panel in the UI.

## 3. Configure the bucket path (optional)

Defaults already match your layout (`mlb-analysis-toolkit` /
`predictions/`). To point elsewhere, copy `.env.example` to `.env` and
edit, or export the vars directly:

```bash
export GCS_BUCKET_NAME=mlb-analysis-toolkit
export GCS_PREDICTIONS_PREFIX=predictions/
export GCS_CREDENTIALS_PATH=gcs-sa.json
```

You can also change the bucket/prefix/credentials path at runtime from the
"gs://…" button in the top-right of the app — no restart needed.

## 4. Run it

```bash
python app.py
```

Then open **http://localhost:5050**.

## How it works

- `GET /api/dates` — lists the `YYYY-MM-DD/` folders under the prefix.
- `GET /api/dates/<date>/stats` — lists the `.csv` files in that folder
  (works for any file names, so `pitcher_strikeouts.csv`,
  `team_win.csv`, etc. all show up automatically).
- `GET /api/data/<date>/<file>` — downloads and parses one CSV, detects
  which columns are numeric, and returns JSON for the frontend.

The frontend lets you:
- Pick a date from the scoreboard-style date strip (newest first).
- Pick a stat sheet from the left rail.
- Sort the table by clicking any column header.
- Pick which numeric column drives the bar chart (top 15, high→low or
  low→high).

## Notes

- Add `gcs-sa.json` and `.env` to `.gitignore` before pushing this
  anywhere — don't commit credentials.
- The CSV parsing is schema-agnostic: any columns/row shape works, it
  just infers which columns are numeric for sorting/charting.
