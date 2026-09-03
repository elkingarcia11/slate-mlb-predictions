"""
Slate — MLB Predictions
-----------------------
Flask backend that lists date folders and CSV stat files from a GCS bucket
and serves them as JSON for the frontend to render as tables/charts.

Credentials: uses gcs-sa.json locally; on Cloud Run, uses ADC automatically.
"""

import csv
import io
import os

from flask import Flask, jsonify, send_from_directory
from google.cloud import storage
from google.oauth2 import service_account

app = Flask(__name__, static_folder="static", static_url_path="")

# ----------------------------------------------------------------------
# Fixed configuration — not exposed to the frontend
# ----------------------------------------------------------------------
BUCKET_NAME = "mlb-analysis-toolkit"
PREDICTIONS_PREFIX = "predictions/"
PANELS_PREFIX = "panels/"
_LOCAL_SA_FILE = "gcs-sa.json"

# target CSV stem -> panel file, label column, join keys
TARGET_META: dict[str, dict] = {
    "team_win": {
        "panel": "team_game.csv",
        "label": "label_win",
        "keys": ("gamePk", "team_id"),
        "task": "classification",
        "pred_col": "prediction_proba",
        "name": "team_abbr",
    },
    "team_total_runs": {
        "panel": "team_game.csv",
        "label": "label_total_runs",
        "keys": ("gamePk", "team_id"),
        "task": "regression",
        "name": "team_abbr",
    },
    "team_run_diff": {
        "panel": "team_game.csv",
        "label": "label_run_diff",
        "keys": ("gamePk", "team_id"),
        "task": "regression",
        "name": "team_abbr",
    },
    "player_hits": {
        "panel": "player_game.csv",
        "label": "label_hits",
        "keys": ("gamePk", "player_id"),
        "task": "regression",
        "name": "player_name",
    },
    "player_home_runs": {
        "panel": "player_game.csv",
        "label": "label_home_runs",
        "keys": ("gamePk", "player_id"),
        "task": "regression",
        "name": "player_name",
    },
    "player_strikeouts": {
        "panel": "player_game.csv",
        "label": "label_strikeouts",
        "keys": ("gamePk", "player_id"),
        "task": "regression",
        "name": "player_name",
    },
    "pitcher_strikeouts": {
        "panel": "player_game.csv",
        "label": "label_pitcher_strikeouts",
        "keys": ("gamePk", "player_id"),
        "task": "regression",
        "name": "player_name",
    },
}

_gcs_client: storage.Client | None = None


def _get_client() -> storage.Client:
    global _gcs_client
    if _gcs_client is not None:
        return _gcs_client
    if os.path.isfile(_LOCAL_SA_FILE):
        creds = service_account.Credentials.from_service_account_file(_LOCAL_SA_FILE)
        _gcs_client = storage.Client(credentials=creds, project=creds.project_id)
    else:
        # On Cloud Run / GCE the environment provides ADC automatically
        _gcs_client = storage.Client()
    return _gcs_client


def get_bucket():
    return _get_client().bucket(BUCKET_NAME)


def _friendly_label(filename: str) -> str:
    name = filename.rsplit(".", 1)[0]
    return name.replace("_", " ").title()


def _stat_stem(stat_file: str) -> str:
    name = stat_file.rsplit("/", 1)[-1]
    return name.rsplit(".", 1)[0] if name.lower().endswith(".csv") else name


def _load_csv_blob(bucket, blob_path: str) -> tuple[list[str], list[dict]] | None:
    blob = bucket.blob(blob_path)
    if not blob.exists():
        return None
    raw = blob.download_as_bytes().decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw))
    return list(reader.fieldnames or []), list(reader)


def _join_predictions_actuals(
    pred_rows: list[dict],
    panel_rows: list[dict],
    *,
    keys: tuple[str, ...],
    label_col: str,
    name_col: str,
) -> list[dict]:
    panel_index: dict[tuple[str, ...], dict] = {}
    for row in panel_rows:
        key = tuple(str(row.get(k) or "").strip() for k in keys)
        if any(not part for part in key):
            continue
        panel_index[key] = row

    merged: list[dict] = []
    for prow in pred_rows:
        key = tuple(str(prow.get(k) or "").strip() for k in keys)
        panel_row = panel_index.get(key)
        if not panel_row:
            continue
        actual_raw = str(panel_row.get(label_col) or "").strip()
        if not actual_raw or actual_raw.lower() == "nan":
            continue
        out = dict(prow)
        out["actual"] = actual_raw
        if name_col in panel_row and panel_row[name_col]:
            out[name_col] = panel_row[name_col]
        merged.append(out)
    return merged


# ----------------------------------------------------------------------
# API routes
# ----------------------------------------------------------------------

@app.route("/api/dates", methods=["GET"])
def list_dates():
    """List date folders directly under the predictions prefix."""
    try:
        bucket = get_bucket()
        it = bucket.client.list_blobs(
            bucket, prefix=PREDICTIONS_PREFIX, delimiter="/"
        )
        # Must exhaust the iterator before .prefixes is populated
        list(it)
        dates = sorted(
            (p[len(PREDICTIONS_PREFIX):].strip("/") for p in it.prefixes),
            reverse=True,
        )
        return jsonify({"dates": dates})
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 500


@app.route("/api/dates/<date>/stats", methods=["GET"])
def list_stats(date):
    """List CSV stat files inside a given date folder."""
    try:
        bucket = get_bucket()
        folder_prefix = f"{PREDICTIONS_PREFIX}{date}/"
        blobs = bucket.client.list_blobs(bucket, prefix=folder_prefix)
        stats = []
        for blob in blobs:
            name = blob.name[len(folder_prefix):]
            if not name or "/" in name or not name.lower().endswith(".csv"):
                continue
            stats.append({
                "file": name,
                "label": _friendly_label(name),
                "updated": blob.updated.isoformat() if blob.updated else None,
                "sizeBytes": blob.size,
            })
        stats.sort(key=lambda s: s["label"])
        return jsonify({"date": date, "stats": stats})
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 500


@app.route("/api/data/<date>/<stat_file>", methods=["GET"])
def get_stat_data(date, stat_file):
    """Fetch a single CSV and return parsed rows + column metadata."""
    if not stat_file.lower().endswith(".csv"):
        stat_file = f"{stat_file}.csv"
    try:
        bucket = get_bucket()
        blob_path = f"{PREDICTIONS_PREFIX}{date}/{stat_file}"
        blob = bucket.blob(blob_path)
        if not blob.exists():
            return jsonify({"error": f"Not found: {blob_path}"}), 404

        raw = blob.download_as_bytes().decode("utf-8-sig")
        reader = csv.DictReader(io.StringIO(raw))
        fieldnames = reader.fieldnames or []
        rows = list(reader)

        # Detect numeric columns so the frontend knows what's chartable/sortable
        numeric_cols = []
        for col in fieldnames:
            sample = [r[col] for r in rows[:50] if r.get(col) not in (None, "")]
            if sample and all(_is_number(v) for v in sample):
                numeric_cols.append(col)

        # Coerce numeric fields for cleaner JSON (numbers instead of strings)
        for r in rows:
            for col in numeric_cols:
                v = r.get(col)
                if v not in (None, ""):
                    try:
                        r[col] = float(v) if "." in v else int(v)
                    except ValueError:
                        pass

        return jsonify({
            "date": date,
            "stat": stat_file,
            "label": _friendly_label(stat_file),
            "columns": fieldnames,
            "numericColumns": numeric_cols,
            "rows": rows,
            "rowCount": len(rows),
        })
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 500


@app.route("/api/scorecard/<date>/<stat_file>", methods=["GET"])
def get_scorecard(date, stat_file):
    """Join predictions with panel labels for pred vs actual scorecard."""
    if not stat_file.lower().endswith(".csv"):
        stat_file = f"{stat_file}.csv"
    stem = _stat_stem(stat_file)
    meta = TARGET_META.get(stem)
    if not meta:
        return jsonify({"error": f"Unknown target: {stem}"}), 400
    try:
        bucket = get_bucket()
        pred_path = f"{PREDICTIONS_PREFIX}{date}/{stat_file}"
        panel_path = f"{PANELS_PREFIX}{date}/{meta['panel']}"

        pred_loaded = _load_csv_blob(bucket, pred_path)
        if pred_loaded is None:
            return jsonify({"error": f"Not found: {pred_path}"}), 404
        _, pred_rows = pred_loaded

        panel_loaded = _load_csv_blob(bucket, panel_path)
        if panel_loaded is None:
            return jsonify({"error": f"Not found: {panel_path}"}), 404
        _, panel_rows = panel_loaded

        rows = _join_predictions_actuals(
            pred_rows,
            panel_rows,
            keys=meta["keys"],
            label_col=meta["label"],
            name_col=meta["name"],
        )

        for r in rows:
            for col in ("prediction", "actual", "prediction_proba"):
                v = r.get(col)
                if v in (None, ""):
                    continue
                try:
                    r[col] = float(v) if "." in str(v) else int(v)
                except ValueError:
                    pass

        return jsonify({
            "date": date,
            "stat": stat_file,
            "label": _friendly_label(stat_file),
            "task": meta["task"],
            "predCol": meta.get("pred_col", "prediction"),
            "actualCol": "actual",
            "nameCol": meta["name"],
            "rows": rows,
            "rowCount": len(rows),
        })
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 500


def _is_number(v: str) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


# ----------------------------------------------------------------------
# Static frontend
# ----------------------------------------------------------------------

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5050))
    app.run(host="0.0.0.0", port=port, debug=True)
