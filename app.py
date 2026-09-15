"""
Slate — MLB Predictions
-----------------------
Flask backend serving published prediction stats JSON and daily prediction
CSVs from GCS. Performance metrics are calculated by the upstream workflow.

Credentials: uses gcs-sa.json locally; on Cloud Run, uses ADC automatically.
"""

import csv
import gzip
import io
import json
import os

from flask import Flask, jsonify, send_from_directory
from google.api_core.exceptions import NotFound
from google.cloud import storage
from google.oauth2 import service_account

app = Flask(__name__, static_folder="static", static_url_path="")

# ----------------------------------------------------------------------
# Fixed configuration — not exposed to the frontend
# ----------------------------------------------------------------------
BUCKET_NAME = "mlb-analysis-toolkit"
PREDICTIONS_PREFIX = "predictions/"
STATS_PREFIX = "stats/predictions/"
_LOCAL_SA_FILE = "gcs-sa.json"
_GZIP_MAGIC = b"\x1f\x8b"
CATEGORIES = frozenset({
    "pitcher_strikeouts", "player_hits", "player_home_runs",
    "player_strikeouts", "team_win", "team_total_runs", "team_run_diff",
})

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


def _maybe_gunzip(blob, data: bytes) -> bytes:
    """Gunzip payload when GCS stores CSV/JSON as gzip (same object name)."""
    if not data:
        return data
    encoding = str(getattr(blob, "content_encoding", "") or "").lower()
    if encoding == "gzip" or data.startswith(_GZIP_MAGIC):
        try:
            return gzip.decompress(data)
        except gzip.BadGzipFile:
            pass
    return data


def _download_blob_text(blob) -> str:
    """Raw-download a blob and decode UTF-8, gunzipping when needed."""
    # raw_download avoids relying on the client to honor Content-Encoding;
    # toolkit uploads keep .csv names but store gzip bytes.
    data = blob.download_as_bytes(raw_download=True)
    return _maybe_gunzip(blob, data).decode("utf-8-sig")


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

        raw = _download_blob_text(blob)
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


def _serve_prediction_stats(filename):
    """Serve published stats unchanged; never join panels or calculate metrics."""
    try:
        blob = get_bucket().blob(f"{STATS_PREFIX}{filename}.json")
        data = json.loads(_download_blob_text(blob))
        response = jsonify(data)
        response.headers["Cache-Control"] = "no-store"
        return response
    except NotFound:
        return jsonify({"error": "Prediction stats are not available yet. They appear after a successful stats-only workflow run."}), 404
    except (ValueError, UnicodeError, EOFError):
        app.logger.exception("Invalid published prediction stats")
        return jsonify({"error": "Published prediction stats could not be read."}), 502
    except Exception:
        app.logger.exception("Unable to fetch prediction stats")
        return jsonify({"error": "Unable to load prediction stats from storage."}), 502


@app.route("/api/stats/predictions", methods=["GET"])
def prediction_stats_index():
    return _serve_prediction_stats("index")


@app.route("/api/stats/predictions/<category>", methods=["GET"])
def prediction_stats_category(category):
    if category not in CATEGORIES:
        return jsonify({"error": "Unknown prediction category."}), 400
    return _serve_prediction_stats(category)


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
